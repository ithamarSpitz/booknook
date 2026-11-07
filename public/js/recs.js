import { FUNCTIONS, SHELF_KINDS } from "./contract.js";
import { promptRating, shouldPromptRating } from "./my-rating.js";
import {
  fetchSimaniaPayload,
  matchHebrewBook,
  searchBooks,
  searchByAuthor,
  similarity,
  simaniaIdOf,
} from "./simania.js";
import {
  authorAgrees,
  mainTitle,
  nameHits,
  soundAgrees,
  titleMatch,
} from "./hebrew-fallback.js";
import { notifyShelvesChanged } from "./events.js";

export const LIBRARY_MOVE_LABEL = "העבר למדף";
export const LIBRARY_REMOVE_LABEL = "הסר מהספרייה";
export const RECS_MOVE_LABEL = "הוסף למדף";
export const RECS_REMOVE_LABEL = "לא מעניין אותי";
export const RECS_SHELF_PLACEHOLDER = "בחרו מדף";
export const ENGLISH_ONLY_NOTE = "אין מהדורה עברית זמינה לספר זה.";

/**
 * @param {string[]} becauseTitles
 * @param {string[]} sharedTags
 * @returns {string}
 */
export function buildReasonLine(becauseTitles, sharedTags) {
  const titles = (becauseTitles ?? []).map((t) => String(t ?? "").trim()).filter(Boolean);
  // Seeds can be rated books not yet read, so the line says "similar to", not "because you read".
  if (titles.length === 1) {
    return `דומה ל־${titles[0]}`;
  }
  if (titles.length >= 2) {
    if (titles.length === 2) {
      return `דומה ל־${titles[0]} ו־${titles[1]}`;
    }
    const rest = titles.slice(0, -1).join(", ");
    const last = titles[titles.length - 1];
    return `דומה ל־${rest} ו־${last}`;
  }
  const tags = (sharedTags ?? []).filter((t) => String(t ?? "").trim());
  if (tags.length) return tags.join(", ");
  return "";
}

/** @param {import('./contract.js').RecommendationCard[]} items */
export function sortRecommendations(items) {
  return [...items].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.work_id).localeCompare(String(b.work_id));
  });
}

/** @param {import('./contract.js').RecommendationCard[]} items */
export function visibleRecommendations(items) {
  return items.filter((r) => !r.dismissed);
}

/**
 * @param {import('./contract.js').RecommendationCard[]} items
 * @param {string} workId
 */
export function removeRecommendationByWorkId(items, workId) {
  return items.filter((r) => r.work_id !== workId);
}

/**
 * Drop dismissed rows and work IDs the user added or dismissed while a refresh
 * was in flight, so a stale function response cannot put them back on screen.
 * @param {import('./contract.js').RecommendationCard[]} incoming
 * @param {Iterable<string> | null | undefined} excludedWorkIds
 */
export function applyRecommendationRefresh(incoming, excludedWorkIds) {
  const excluded = excludedWorkIds instanceof Set
    ? excludedWorkIds
    : new Set(excludedWorkIds ?? []);
  return sortRecommendations(
    visibleRecommendations(incoming).filter((row) => !excluded.has(row.work_id)),
  );
}

/**
 * Empty state means "no read/reading seeds", not "library was never fetched".
 * @param {import('./data.js').LibraryState | null | undefined} libraryState
 * @param {boolean} libraryChecked
 */
export function shouldShowRecsEmptyState(libraryState, libraryChecked) {
  return Boolean(libraryChecked && libraryState && !hasRecommendationSeeds(libraryState));
}

/**
 * @param {Array<{ id: string, name: string }>} shelves
 */
export function shelfChoicesForAdd(shelves) {
  return [
    { id: "", name: RECS_SHELF_PLACEHOLDER },
    ...(shelves ?? []).map((s) => ({ id: s.id, name: s.name })),
  ];
}

/**
 * @param {import('./data.js').LibraryState | null | undefined} libraryState
 * @returns {boolean}
 */
export function hasRecommendationSeeds(libraryState) {
  if (!libraryState?.shelves?.length) return false;
  for (const shelf of libraryState.shelves) {
    if (shelf.kind !== SHELF_KINDS.READING && shelf.kind !== SHELF_KINDS.READ) continue;
    for (const book of shelf.books) {
      if (book.work_id) return true;
    }
  }
  return false;
}

/**
 * @param {Record<string, unknown>} row
 * @param {Map<number, string>} titleBySimaniaId
 * @returns {import('./contract.js').RecommendationCard}
 */
export function mapStoredRecommendationRow(row, titleBySimaniaId) {
  const rawEdition = row.editions ?? row.edition ?? null;
  const edition = Array.isArray(rawEdition) ? (rawEdition[0] ?? null) : rawEdition;
  const rawWork = row.works ?? row.work ?? null;
  const work = Array.isArray(rawWork) ? (rawWork[0] ?? null) : rawWork;
  const simaniaId = row.simania_id != null ? Number(row.simania_id) : null;
  const englishOnly = simaniaId == null;
  const because = Array.isArray(row.because) ? row.because.map((id) => Number(id)) : [];
  const becauseTitles = because.map((id) => titleBySimaniaId.get(id) ?? "").filter(Boolean);

  let title = "";
  let author = null;
  let coverUrl = null;
  if (englishOnly && work) {
    title = String(work.original_title ?? "");
    const authors = Array.isArray(work.original_authors) ? work.original_authors : [];
    author = authors.length ? authors.join(", ") : null;
    coverUrl = work.hardcover_cover_url ?? null;
  } else if (edition) {
    title = String(edition.title ?? "");
    author = edition.author ?? null;
    coverUrl = edition.cover_url ?? null;
  }

  return {
    work_id: String(row.work_id),
    hardcover_id: work?.hardcover_id != null ? Number(work.hardcover_id) : null,
    simania_id: simaniaId,
    title,
    author,
    cover_url: coverUrl,
    score: Number(row.score),
    because,
    because_titles: becauseTitles,
    shared_tags: Array.isArray(row.shared_tags) ? row.shared_tags.map(String) : [],
    dismissed: Boolean(row.dismissed),
    generated_at: String(row.generated_at ?? ""),
    english_only: englishOnly,
    can_add: true,
  };
}

/** @param {unknown} card */
export function recommendationFromApiCard(card) {
  const c = card && typeof card === "object" ? card : {};
  const simaniaId = c.simania_id != null ? Number(c.simania_id) : null;
  return {
    work_id: String(c.work_id ?? ""),
    hardcover_id: c.hardcover_id != null ? Number(c.hardcover_id) : null,
    simania_id: simaniaId,
    title: String(c.title ?? ""),
    author: c.author != null ? String(c.author) : null,
    cover_url: c.cover_url != null ? String(c.cover_url) : null,
    score: Number(c.score),
    because: Array.isArray(c.because) ? c.because.map((id) => Number(id)) : [],
    because_titles: Array.isArray(c.because_titles) ? c.because_titles.map(String) : [],
    shared_tags: Array.isArray(c.shared_tags) ? c.shared_tags.map(String) : [],
    dismissed: Boolean(c.dismissed),
    generated_at: String(c.generated_at ?? ""),
    english_only: simaniaId == null,
    can_add: true,
    hebrew_hint: simaniaId == null && c.hebrew_hint && typeof c.hebrew_hint === "object"
      ? {
        source: c.hebrew_hint.source === "nli" ? "nli" : "wikidata",
        title: String(c.hebrew_hint.title ?? ""),
        author: c.hebrew_hint.author != null ? String(c.hebrew_hint.author) : null,
      }
      : null,
    hebrew_author: simaniaId == null && c.hebrew_author != null ? String(c.hebrew_author) : null,
  };
}

/** @param {string | null | undefined} resolveStatus */
function linkSourceFromAuthorMatch(resolveStatus) {
  if (resolveStatus === "fuzzy") return "nli";
  if (resolveStatus === "wikidata" || resolveStatus === "nli") return resolveStatus;
  return null;
}

/**
 * Decide the single clear Simania winner from the catalog fallback. Linking is
 * deliberately left to localizeRecommendations so every path uses the same
 * payload and onLinked flow.
 * @param {import('./contract.js').RecommendationCard} rec
 * @param {{
 *   callFunction: (name: string, body: Record<string, unknown>) => Promise<unknown>,
 *   isCurrent: () => boolean,
 *   searchBooks?: typeof searchBooks,
 *   fetchPayload?: typeof fetchSimaniaPayload,
 *   fetchSimaniaPayload?: typeof fetchSimaniaPayload,
 *   payloadById?: Map<number, unknown>,
 * }} deps
 * @returns {Promise<number|null>}
 */
export async function localizeFallback(rec, deps) {
  if (!rec?.english_only || rec.simania_id != null || !deps.isCurrent()) return null;

  let response;
  try {
    response = await deps.callFunction(FUNCTIONS.HEBREW_CANDIDATES, {
      work_id: rec.work_id,
    });
  } catch {
    return null;
  }
  if (!deps.isCurrent() || !response || typeof response !== "object") return null;

  const candidates = Array.isArray(response.candidates)
    ? response.candidates.filter((candidate) => candidate && typeof candidate === "object")
    : [];
  if (!candidates.length) return null;

  const search = deps.searchBooks ?? searchBooks;
  const fetchPayload = deps.fetchPayload ?? deps.fetchSimaniaPayload ?? fetchSimaniaPayload;
  const englishAuthor = String(rec.author ?? "");
  let searchCount = 0;
  let detailCount = 0;
  let searchExhausted = false;

  async function findEdition(candidate, needSound = false) {
    const title = String(candidate.title ?? "");
    const author = String(candidate.author ?? "");
    const shortTitle = mainTitle(title);
    if (!shortTitle) return null;
    const queries = [`${shortTitle} ${author}`.trim(), shortTitle];
    for (const query of queries) {
      if (searchCount >= 12 || !deps.isCurrent()) {
        if (searchCount >= 12) searchExhausted = true;
        return null;
      }
      searchCount++;
      let books;
      try {
        books = await search(query, 10);
      } catch {
        books = [];
      }
      if (!deps.isCurrent()) return null;
      for (const book of Array.isArray(books) ? books : []) {
        const id = simaniaIdOf(book);
        if (id == null || !titleMatch(title, String(book?.title ?? ""))) continue;
        const agrees = needSound
          ? soundAgrees(String(book?.author ?? ""), englishAuthor)
          : authorAgrees(author, String(book?.author ?? ""), englishAuthor);
        if (agrees) return { id, book };
      }
    }
    return null;
  }

  for (const rule of ["A", "B", "D", "C"]) {
    if (!deps.isCurrent()) return null;
    const ids = new Set();
    for (const candidate of candidates.filter((item) => item.rule === rule)) {
      const found = await findEdition(candidate);
      if (!deps.isCurrent()) return null;
      if (found) ids.add(found.id);
    }
    if (searchExhausted) return null;
    if (ids.size > 1) return null;
    if (ids.size === 1) return ids.values().next().value;
  }

  for (const rule of ["E", "F"]) {
    if (!deps.isCurrent()) return null;
    const ids = new Set();
    for (const candidate of candidates.filter((item) => item.rule === rule)) {
      const found = await findEdition(candidate, true);
      if (!deps.isCurrent()) return null;
      if (found) ids.add(found.id);
    }
    if (searchExhausted) return null;
    if (ids.size > 1) return null;
    if (ids.size === 1) return ids.values().next().value;
  }

  if (!deps.isCurrent()) return null;
  const englishNames = Array.isArray(response.english_names)
    ? response.english_names.map(String)
    : [];
  const scoredById = new Map();
  for (const candidate of candidates.filter((item) => item.rule === "G").slice(0, 6)) {
    const found = await findEdition(candidate);
    if (!deps.isCurrent()) return null;
    if (searchExhausted) return null;
    if (!found || scoredById.has(found.id) || detailCount >= 6) continue;
    detailCount++;
    let payload;
    try {
      payload = await fetchPayload(found.id);
    } catch {
      continue;
    }
    if (!deps.isCurrent()) return null;
    if (deps.payloadById instanceof Map) deps.payloadById.set(found.id, payload);
    const description = String(payload?.details?.description ?? "");
    scoredById.set(found.id, nameHits(englishNames, description).length);
  }
  const scored = [...scoredById].sort((left, right) => right[1] - left[1]);
  if (!scored[0] || scored[0][1] < 2) return null;
  if (scored[1] && scored[0][1] === scored[1][1]) return null;
  return scored[0][0];
}

/**
 * @param {{
 *   work_id: string,
 *   hebrew_author?: string|null,
 *   hebrew_hint?: { source?: string }|null,
 * }} rec
 * @param {{ id?: number|string, bookId?: number|string, title: string, author?: string }} book
 * @param {{
 *   callFunction: (name: string, body: Record<string, unknown>) => Promise<unknown>,
 *   similarity?: typeof similarity,
 * }} deps
 * @returns {Promise<{ simania_id: number, resolve_status: "wikidata" | "nli" } | null>}
 */
export async function verifyTitleMatch(rec, book, deps) {
  const sim = deps.similarity ?? similarity;
  const simaniaId = simaniaIdOf(book);
  if (simaniaId == null) return null;

  const hebrewAuthor = rec.hebrew_author;
  if (hebrewAuthor && sim(hebrewAuthor, book.author ?? "") >= 0.6) {
    const resolve_status = rec.hebrew_hint?.source === "nli" ? "nli" : "wikidata";
    return { simania_id: simaniaId, resolve_status };
  }

  try {
    const matched = await deps.callFunction(FUNCTIONS.MATCH_BY_AUTHOR, {
      work_id: rec.work_id,
      candidates: [{
        simania_id: simaniaId,
        title: book.title,
        author: book.author ?? null,
      }],
    });
    if (!matched || typeof matched !== "object") return null;
    const resolvedId = Number(matched.simania_id);
    const linkSource = linkSourceFromAuthorMatch(String(matched.resolve_status ?? ""));
    if (!Number.isSafeInteger(resolvedId) || resolvedId <= 0 || !linkSource) return null;
    return { simania_id: resolvedId, resolve_status: linkSource };
  } catch {
    return null;
  }
}

/**
 * Localizes English-only cards in the browser: the server found a Hebrew title
 * (hebrew_hint) but cannot reach Simania, so match it here and ask link-edition
 * to store and link the edition. A miss or failure leaves the card English-only.
 * @param {import('./contract.js').RecommendationCard[]} items
 * @param {{
 *   callFunction: (name: string, body: Record<string, unknown>) => Promise<unknown>,
 *   onLinked: (workId: string, patch: { simania_id: number, title: string, author: string | null, cover_url: string | null }) => void,
 *   isCurrent: () => boolean,
 *   match?: typeof matchHebrewBook,
 *   searchByAuthor?: typeof searchByAuthor,
 *   searchBooks?: typeof searchBooks,
 *   fetchPayload?: typeof fetchSimaniaPayload,
 *   fetchSimaniaPayload?: typeof fetchSimaniaPayload,
 *   concurrency?: number,
 * }} deps
 */
export async function localizeRecommendations(items, deps) {
  const match = deps.match ?? matchHebrewBook;
  const searchByAuthorFn = deps.searchByAuthor ?? searchByAuthor;
  const fetchPayload = deps.fetchPayload ?? deps.fetchSimaniaPayload ?? fetchSimaniaPayload;
  const queue = items.filter((rec) => rec.english_only && rec.simania_id == null);
  async function one(rec) {
    const payloadById = new Map();
    const hint = rec.hebrew_hint;
    let simaniaId = null;
    /** @type {"wikidata"|"nli"|"nli_author"|null} */
    let source = null;
    if (hint?.title) {
      const book = await match(hint.title, hint.author ?? "");
      if (book && deps.isCurrent()) {
        const verified = await verifyTitleMatch(rec, book, deps);
        if (verified) {
          simaniaId = verified.simania_id;
          source = verified.resolve_status;
        }
      }
    }
    if (simaniaId == null && rec.hebrew_author) {
      const candidates = await searchByAuthorFn(rec.hebrew_author);
      if (candidates.length && deps.isCurrent()) {
        const matched = await deps.callFunction(FUNCTIONS.MATCH_BY_AUTHOR, {
          work_id: rec.work_id,
          candidates,
        });
        const resolvedId = matched && typeof matched === "object"
          ? Number(matched.simania_id)
          : null;
        const linkSource = matched && typeof matched === "object"
          ? linkSourceFromAuthorMatch(String(matched.resolve_status ?? ""))
          : null;
        if (Number.isSafeInteger(resolvedId) && resolvedId > 0 && linkSource) {
          simaniaId = resolvedId;
          source = linkSource;
        }
      }
    }
    // Recommendation/genre view models always carry this field (null when no
    // author bridge exists). Treat older partial callers that omit it as not
    // eligible, while still queuing every current English-only card.
    if (simaniaId == null && Object.hasOwn(rec, "hebrew_author") && deps.isCurrent()) {
      simaniaId = await localizeFallback(rec, {
        ...deps,
        fetchPayload,
        payloadById,
      });
      if (simaniaId != null) source = "nli_author";
    }
    if (simaniaId == null || source == null || !deps.isCurrent()) return;
    const simania = payloadById.has(simaniaId)
      ? payloadById.get(simaniaId)
      : await fetchPayload(simaniaId);
    if (!deps.isCurrent()) return;
    const res = await deps.callFunction(FUNCTIONS.LINK_EDITION, {
      work_id: rec.work_id,
      simania_id: simaniaId,
      source,
      simania,
    });
    if (res && typeof res === "object" && Number(res.simania_id) === simaniaId && deps.isCurrent()) {
      deps.onLinked(rec.work_id, {
        simania_id: simaniaId,
        title: String(res.title ?? rec.title),
        author: res.author != null ? String(res.author) : null,
        cover_url: res.cover_url != null ? String(res.cover_url) : null,
      });
    }
  }
  const workers = Array.from({ length: Math.min(deps.concurrency ?? 3, queue.length) }, async () => {
    while (queue.length && deps.isCurrent()) {
      const rec = queue.shift();
      try {
        await one(rec);
      } catch (err) {
        console.warn(`Could not localize ${rec.title}:`, err);
      }
    }
  });
  await Promise.all(workers);
}

/** Applies a link-edition result to the matching card. */
export function applyLocalizedRecommendation(items, workId, patch) {
  return items.map((rec) =>
    rec.work_id === workId
      ? { ...rec, ...patch, english_only: false, can_add: true, hebrew_hint: null }
      : rec
  );
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @returns {Promise<import('./contract.js').RecommendationCard[]>}
 */
export async function loadStoredRecommendations(client) {
  const { data, error } = await client
    .from("recommendations")
    .select(
      `work_id, simania_id, score, because, shared_tags, dismissed, generated_at,
      editions (
        title, author, cover_url
      ),
      works (
        hardcover_id, original_title, original_authors, hardcover_cover_url
      )`,
    )
    .eq("dismissed", false)
    .order("score", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  const becauseIds = new Set();
  for (const row of rows) {
    for (const id of row.because ?? []) becauseIds.add(Number(id));
  }
  let titleBySimaniaId = new Map();
  if (becauseIds.size) {
    const { data: editions, error: edErr } = await client
      .from("editions")
      .select("simania_id, title")
      .in("simania_id", [...becauseIds]);
    if (edErr) throw edErr;
    titleBySimaniaId = new Map((editions ?? []).map((e) => [e.simania_id, e.title]));
  }
  return sortRecommendations(rows.map((row) => mapStoredRecommendationRow(row, titleBySimaniaId)));
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

const TEXT_NODE = typeof Node !== "undefined" ? Node.TEXT_NODE : 3;

/** @param {ParentNode | null | undefined} el */
export function firstSignificantTextNode(el) {
  if (!el?.childNodes) return null;
  for (const node of el.childNodes) {
    if (node.nodeType === TEXT_NODE && String(node.textContent ?? "").trim()) return node;
  }
  return null;
}

function hostDocument(node) {
  return node?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
}

/**
 * Insert a blank selected option so choosing the first real shelf emits `change`.
 * Does not replace the select node `card.js` holds.
 * @param {HTMLSelectElement} select
 * @param {string} [label]
 */
export function ensureShelfPlaceholder(select, label = RECS_SHELF_PLACEHOLDER) {
  if (!select) return null;
  const doc = hostDocument(select);
  if (!doc?.createElement) return null;
  const option = doc.createElement("option");
  option.value = "";
  option.textContent = label;
  option.setAttribute("data-recs-placeholder", "true");
  select.insertBefore(option, select.firstChild ?? null);
  option.selected = true;
  select.value = "";
  return option;
}

/**
 * After a failed add, put the select back on the placeholder so the same shelf
 * emits `change` again. A failed write must remain retryable.
 * @param {HTMLSelectElement | null | undefined} select
 */
export function revertFailedShelfPick(select) {
  if (!select) return;
  select.disabled = false;
  select.value = "";
  const opts = select.options ?? select.children ?? [];
  for (const opt of opts) {
    if (opt && typeof opt === "object" && "selected" in opt) {
      opt.selected = opt.value === "";
    }
  }
}

/**
 * Ignore an in-flight add/dismiss once this overlay session is gone or a later
 * rec card has replaced it.
 * @param {ReturnType<typeof applyRecsCardChrome> | null | undefined} session
 * @param {boolean} isCurrent
 */
export function canCompleteRecsWrite(session, isCurrent) {
  return Boolean(session && !session.restored && isCurrent);
}

/**
 * Restyle the shared overlay in place. Never clone or replace `.bk-move select` / `.bk-remove`.
 * @param {HTMLElement} overlay
 * @param {import('./contract.js').RecommendationCard} rec
 */
export function applyRecsCardChrome(overlay, rec, options = {}) {
  const allowDismiss = options.allowDismiss !== false;
  const moveLabel = overlay.querySelector(".bk-move");
  const moveSelect = overlay.querySelector(".bk-move select");
  const removeBtn = overlay.querySelector(".bk-remove");
  const session = {
    overlay,
    moveLabel,
    moveSelect,
    removeBtn,
    placeholder: null,
    note: null,
    reason: null,
    onChange: null,
    onClick: null,
    restored: false,
    allowDismiss,
  };

  if (moveLabel) {
    const tn = firstSignificantTextNode(moveLabel);
    if (tn) tn.textContent = ` ${RECS_MOVE_LABEL} `;
    moveLabel.hidden = false;
  }

  if (removeBtn) {
    removeBtn.textContent = RECS_REMOVE_LABEL;
    removeBtn.disabled = false;
    removeBtn.hidden = !allowDismiss;
  }

  if (moveSelect) {
    moveSelect.disabled = false;
    session.placeholder = ensureShelfPlaceholder(moveSelect);
  }

  // The grid clamps the reason to a few lines; the card always shows all of it.
  const reasonText = buildReasonLine(rec.because_titles, rec.shared_tags);
  if (reasonText && removeBtn?.parentElement) {
    const reason = hostDocument(overlay)?.createElement("p");
    if (reason) {
      reason.className = "bk-rec-reason";
      reason.textContent = reasonText;
      removeBtn.parentElement.insertBefore(reason, removeBtn.parentElement.firstChild);
      session.reason = reason;
    }
  }

  if (rec.english_only && removeBtn) {
    const doc = hostDocument(overlay);
    const note = doc?.createElement("p");
    if (note) {
      note.className = "bk-rec-note";
      note.textContent = ENGLISH_ONLY_NOTE;
      removeBtn.parentElement?.insertBefore(note, removeBtn);
      session.note = note;
    }
  }

  return session;
}

/** @param {ReturnType<typeof applyRecsCardChrome> | null | undefined} session */
export function restoreRecsCardChrome(session) {
  if (!session || session.restored) return;
  session.restored = true;
  if (session.onChange) {
    session.overlay?.removeEventListener("change", session.onChange, true);
  }
  if (session.onClick) {
    session.overlay?.removeEventListener("click", session.onClick, true);
  }
  session.placeholder?.remove?.();
  if (session.moveLabel) {
    session.moveLabel.hidden = false;
    const tn = firstSignificantTextNode(session.moveLabel);
    if (tn) tn.textContent = ` ${LIBRARY_MOVE_LABEL} `;
  }
  if (session.removeBtn) {
    session.removeBtn.textContent = LIBRARY_REMOVE_LABEL;
    session.removeBtn.disabled = false;
    session.removeBtn.hidden = false;
  }
  if (session.moveSelect) session.moveSelect.disabled = false;
  session.note?.remove?.();
  session.reason?.remove?.();
}

/**
 * Capture-phase intercepts so `card.js` move/remove handlers do not run.
 * @param {ReturnType<typeof applyRecsCardChrome>} session
 * @param {import('./contract.js').RecommendationCard} rec
 * @param {{ onPickShelf: (shelfId: string) => void, onDismiss: () => void }} handlers
 */
export function bindRecsCardActions(session, rec, handlers) {
  session.onChange = (event) => {
    if (event.target !== session.moveSelect) return;
    event.stopImmediatePropagation();
    if (rec.simania_id == null && rec.hardcover_id == null) return;
    const shelfId = session.moveSelect?.value;
    if (!shelfId) return;
    handlers.onPickShelf(shelfId);
  };
  session.onClick = (event) => {
    const btn = session.removeBtn;
    if (!btn || session.allowDismiss === false) return;
    const t = event.target;
    if (t !== btn && !btn.contains?.(t)) return;
    event.stopImmediatePropagation();
    event.preventDefault?.();
    handlers.onDismiss();
  };
  session.overlay.addEventListener("change", session.onChange, true);
  session.overlay.addEventListener("click", session.onClick, true);
}

/**
 * @param {import('./contract.js').RecommendationCard} rec
 * @param {string} shelfId
 */
export function addBookRequestForRecommendation(rec, shelfId) {
  if (rec.simania_id != null) {
    return { simania_id: rec.simania_id, shelf_id: shelfId };
  }
  return { hardcover_id: rec.hardcover_id, shelf_id: shelfId };
}

/**
 * Card-opening path shared by the recommendations screen and the library's
 * genre shelves. `rec` needs `work_id`, `hardcover_id`, `simania_id`, `title`,
 * `author`, `cover_url`, `english_only` (and `can_add`).
 * Options: `allowDismiss` (default true) shows "לא מעניין אותי";
 * `englishDetails` loads an English-only book through `book-details` with
 * `simania_id = -hardcover_id`, falling back to the item's own fields.
 * @param {HTMLElement} overlay
 * @param {import('./contract.js').RecommendationCard} rec
 * @param {{
 *   api: { callFunction: (name: string, body: Record<string, unknown>) => Promise<unknown>, getClient: () => import('@supabase/supabase-js').SupabaseClient },
 *   getLibrary: () => import('./data.js').LibraryState | null,
 *   showToast: (msg: string) => void,
 *   card: { open: (book: import('./contract.js').BookCard, shelves: unknown[]) => void, close: () => void },
 *   onDismissed: (workId: string) => void,
 *   onAdded: (workId: string, shelfId: string, book: import('./contract.js').BookCard | import('./contract.js').RecommendationCard) => Promise<void>,
 *   restorePrevious: () => void,
 *   beginSession: (session: ReturnType<typeof applyRecsCardChrome>) => void,
 *   isCurrent: () => boolean,
 *   fetchPayload?: typeof fetchSimaniaPayload,
 * }} deps
 */
export async function openRecommendationCard(overlay, rec, deps, options = {}) {
  const allowDismiss = options.allowDismiss !== false;
  let book;
  if (rec.can_add && rec.simania_id != null) {
    try {
      const res = await deps.api.callFunction(FUNCTIONS.BOOK_DETAILS, { simania_id: rec.simania_id });
      book = res && typeof res === "object" && res.book ? res.book : null;
    } catch (err) {
      if (deps.isCurrent()) {
        deps.showToast(err instanceof Error ? err.message : "לא הצלחנו לטעון פרטי הספר");
      }
      return;
    }
    if (!deps.isCurrent()) return;
    if (
      Number(rec.simania_id) > 0
      && book?.cover_url === null
      && book.description === null
      && book.simania_rating === null
    ) {
      try {
        const simania = await (deps.fetchPayload ?? fetchSimaniaPayload)(rec.simania_id);
        if (!deps.isCurrent()) return;
        if (simania) {
          const res = await deps.api.callFunction(FUNCTIONS.BOOK_DETAILS, {
            simania_id: rec.simania_id,
            simania,
          });
          if (!deps.isCurrent()) return;
          if (res && typeof res === "object" && res.book) book = res.book;
        }
      } catch {
        // Keep the first response when browser-side Simania enrichment fails.
      }
    }
  } else {
    if (options.englishDetails && rec.english_only && rec.hardcover_id != null) {
      try {
        const res = await deps.api.callFunction(FUNCTIONS.BOOK_DETAILS, { simania_id: -rec.hardcover_id });
        book = res && typeof res === "object" && res.book ? res.book : undefined;
      } catch {
        book = undefined;
      }
      if (!deps.isCurrent()) return;
    }
  }
  if (book === undefined) {
    book = {
      simania_id: rec.simania_id,
      work_id: rec.work_id,
      resolve_status: "not_found",
      title: rec.title,
      author: rec.author,
      translator: null,
      publisher: null,
      series: null,
      category: null,
      year: null,
      pages: null,
      description: null,
      cover_url: rec.cover_url,
      simania_rating: null,
      simania_rating_count: null,
      shelf_id: null,
      shelf_name: null,
      shelf_kind: null,
      position: null,
      added_at: null,
      finished_at: null,
      rating: null,
      english_edition: rec.english_only,
    };
  }
  if (!book || !deps.isCurrent()) return;

  const lib = deps.getLibrary();
  const shelves = lib?.shelves ?? [];
  deps.restorePrevious();
  deps.card.open(book, shelves);

  const session = applyRecsCardChrome(overlay, rec, { allowDismiss });
  deps.beginSession(session);

  bindRecsCardActions(session, rec, {
    onPickShelf: (shelfId) => {
      if ((rec.simania_id == null && rec.hardcover_id == null) || session.moveSelect?.disabled) return;
      session.moveSelect.disabled = true;
      void (async () => {
        try {
          const result = await deps.api.callFunction(
            FUNCTIONS.ADD_BOOK,
            addBookRequestForRecommendation(rec, shelfId),
          );
          const addedBook = result && typeof result === "object" && result.book
            ? result.book
            : rec;
          notifyShelvesChanged();
          if (canCompleteRecsWrite(session, deps.isCurrent())) {
            deps.card.close();
          }
          await deps.onAdded(rec.work_id, shelfId, addedBook);
        } catch (err) {
          if (canCompleteRecsWrite(session, deps.isCurrent())) {
            revertFailedShelfPick(session.moveSelect);
          }
          if (deps.isCurrent()) {
            deps.showToast(err instanceof Error ? err.message : "לא הצלחנו להוסיף את הספר");
          }
        }
      })();
    },
    onDismiss: () => {
      if (!allowDismiss || session.removeBtn?.disabled) return;
      if (session.removeBtn) session.removeBtn.disabled = true;
      void (async () => {
        const client = deps.api.getClient();
        try {
          const { error } = await client
            .from("recommendations")
            .update({ dismissed: true })
            .eq("work_id", rec.work_id);
          if (error) throw error;
          if (canCompleteRecsWrite(session, deps.isCurrent())) {
            deps.card.close();
          }
          deps.onDismissed(rec.work_id);
        } catch (err) {
          if (canCompleteRecsWrite(session, deps.isCurrent())) {
            if (session.removeBtn) session.removeBtn.disabled = false;
          }
          if (deps.isCurrent()) {
            deps.showToast(err instanceof Error ? err.message : "לא הצלחנו לעדכן");
          }
        }
      })();
    },
  });
}

/**
 * @param {HTMLElement} root
 * @param {{
 *   api: { callFunction: (name: string, body: Record<string, unknown>) => Promise<unknown>, getClient: () => import('@supabase/supabase-js').SupabaseClient },
 *   data?: { loadLibrary: (client: unknown) => Promise<import('./data.js').LibraryState> },
 *   getLibrary: () => import('./data.js').LibraryState | null,
 *   setLibrary?: (s: import('./data.js').LibraryState) => void,
 *   showToast: (msg: string) => void,
 *   card: { open: (book: import('./contract.js').BookCard, shelves: unknown[]) => void, close: () => void },
 *   reloadLibrary?: () => Promise<void>,
 *   recsRefresh?: { busy: () => boolean, request: () => void, subscribe: (fn: (busy: boolean) => void) => () => void },
 * }} ctx
 */
export async function mount(root, ctx) {
  const inner = root.querySelector(".screen-inner") ?? root;
  /** @type {import('./contract.js').RecommendationCard[]} */
  let items = [];
  let loading = false;
  // Recommendations regenerate in the background after shelf changes
  // (recs-refresh.js); this screen shows the stored list until that finishes.
  let refreshing = ctx.recsRefresh?.busy() ?? false;
  let alive = true;
  let libraryChecked = Boolean(ctx.getLibrary());
  let loadedLibrary = ctx.getLibrary();
  let refreshGeneration = 0;
  let cardGeneration = 0;
  const excludedWorkIds = new Set();
  const overlay = typeof document !== "undefined" ? document.getElementById("bk") : null;
  /** @type {ReturnType<typeof applyRecsCardChrome> | null} */
  let cardSession = null;

  function restoreActiveCard() {
    restoreRecsCardChrome(cardSession);
    cardSession = null;
  }

  function currentLibrary() {
    return ctx.getLibrary() ?? loadedLibrary;
  }

  function excludeWork(workId) {
    excludedWorkIds.add(workId);
    items = removeRecommendationByWorkId(items, workId);
    if (alive) render();
  }

  function render() {
    if (!alive) return;

    if (!libraryChecked) {
      inner.innerHTML = `
        <header class="recs-head">
          <h1>המלצות בשבילי</h1>
        </header>
        <p class="recs-loading" role="status">טוען…</p>`;
      return;
    }

    if (shouldShowRecsEmptyState(currentLibrary(), true)) {
      inner.innerHTML = `
        <header class="recs-head">
          <h1>המלצות בשבילי</h1>
        </header>
        <p class="empty" role="status">כדי לקבל המלצות, סמן בספרייה ספרים שאתה קורא או שכבר קראת.</p>
        <p class="recs-to-library"><a href="#library">לספרייה שלי</a></p>`;
      return;
    }

    const visible = visibleRecommendations(items).filter((r) => !excludedWorkIds.has(r.work_id));
    const listHtml = visible.length
      ? `<ul class="recs-grid" role="list">
          ${visible
            .map((rec) => {
              const reason = escapeHtml(buildReasonLine(rec.because_titles, rec.shared_tags));
              const title = escapeHtml(rec.title);
              const cover = rec.cover_url
                ? `<img class="cover" src="${escapeHtml(rec.cover_url)}" alt="${title}" loading="lazy" referrerpolicy="no-referrer">`
                : `<span class="cover" aria-hidden="true"></span>`;
              const note = rec.english_only
                ? `<span class="recs-en">אין מהדורה עברית</span>`
                : "";
              return `<li>
                <button type="button" class="rec-item" data-work-id="${escapeHtml(rec.work_id)}">
                  ${cover}
                  <span class="t"><b dir="auto">${title}</b>${note ? `<small>${note}</small>` : ""}<small class="recs-reason">${reason}</small></span>
                </button>
              </li>`;
            })
            .join("")}
        </ul>`
      : refreshing || loading
        ? ""
        : `<p class="empty" role="status">עדיין לא מצאנו המלצות. הוסיפו עוד ספרים שקראתם ונמשיך לחפש.</p>`;

    const status = loading
      ? `<p class="recs-loading" role="status">טוען…</p>`
      : refreshing
        ? `<p class="recs-updating" role="status"><span class="recs-spinner" aria-hidden="true"></span>מחפש המלצות חדשות…</p>`
        : "";
    inner.innerHTML = `
      <header class="recs-head">
        <h1>המלצות בשבילי</h1>
      </header>
      ${status}
      ${listHtml}`;

    inner.querySelectorAll(".rec-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const workId = btn.getAttribute("data-work-id");
        const rec = visible.find((r) => r.work_id === workId);
        if (!rec || !overlay || !ctx.card) return;
        const token = ++cardGeneration;
        void openRecommendationCard(overlay, rec, {
          api: ctx.api,
          getLibrary: ctx.getLibrary,
          showToast: ctx.showToast,
          card: ctx.card,
          restorePrevious: restoreActiveCard,
          beginSession: (session) => {
            cardSession = session;
          },
          isCurrent: () => alive && token === cardGeneration,
          onDismissed: (id) => {
            excludeWork(id);
          },
          onAdded: async (id, shelfId, added) => {
            excludeWork(id);
            if (ctx.reloadLibrary) await ctx.reloadLibrary();
            const kind = ctx.getLibrary?.()?.shelves.find((s) => s.id === shelfId)?.kind;
            if (added?.simania_id && shouldPromptRating(kind, null)) {
              promptRating(ctx, { simania_id: added.simania_id, title: added.title });
            }
          },
        });
      });
    });
  }

  async function reloadStored() {
    const generation = ++refreshGeneration;
    try {
      const list = await loadStoredRecommendations(ctx.api.getClient());
      if (!alive || generation !== refreshGeneration) return;
      items = applyRecommendationRefresh(list, excludedWorkIds);
    } catch (err) {
      console.warn("Could not reload recommendations:", err);
    }
    if (alive && generation === refreshGeneration) render();
  }

  const unsubscribe = ctx.recsRefresh?.subscribe((busy) => {
    if (!alive) return;
    const finished = refreshing && !busy;
    refreshing = busy;
    if (finished) void reloadStored();
    else render();
  });

  const observer = overlay && typeof MutationObserver !== "undefined"
    ? new MutationObserver(() => {
      if (!overlay.classList.contains("on")) restoreActiveCard();
    })
    : null;
  observer?.observe(overlay, { attributes: true, attributeFilter: ["class"] });

  loading = true;
  render();
  try {
    if (!currentLibrary() && ctx.data?.loadLibrary) {
      const state = await ctx.data.loadLibrary(ctx.api.getClient());
      loadedLibrary = state;
      ctx.setLibrary?.(state);
    }
  } catch (err) {
    ctx.showToast(err instanceof Error ? err.message : "לא הצלחנו לטעון את הספרייה");
  } finally {
    libraryChecked = true;
  }

  if (alive && !shouldShowRecsEmptyState(currentLibrary(), true)) {
    try {
      items = applyRecommendationRefresh(
        await loadStoredRecommendations(ctx.api.getClient()),
        excludedWorkIds,
      );
    } catch (err) {
      ctx.showToast(err instanceof Error ? err.message : "לא הצלחנו לטעון המלצות");
      items = [];
    }
  }

  loading = false;
  if (alive) render();
  // Nothing stored yet (first visit, or the library predates background refresh).
  if (alive && !items.length && !refreshing && !shouldShowRecsEmptyState(currentLibrary(), true)) {
    ctx.recsRefresh?.request();
  }

  return () => {
    alive = false;
    unsubscribe?.();
    refreshGeneration += 1;
    cardGeneration += 1;
    observer?.disconnect();
    restoreActiveCard();
    if (overlay?.classList.contains("on")) ctx.card?.close();
    inner.innerHTML = "";
  };
}
