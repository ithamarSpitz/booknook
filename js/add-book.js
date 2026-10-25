import { FUNCTIONS } from "./contract.js?v=18f2175";
import { cloneLibrary } from "./data.js?v=18f2175";
import { fetchSimaniaPayload, searchBooks } from "./simania.js?v=18f2175";
import { notifyShelvesChanged } from "./events.js?v=18f2175";
import { promptRating, shouldPromptRating } from "./my-rating.js?v=18f2175";

// Simania is called from the browser (it blocks Edge Function IPs); the
// response keeps the old search-books envelope so mapSearchResults is unchanged.
const searchSimania = async (query) => ({ books: await searchBooks(query) });

export const SEARCH_DEBOUNCE_MS = 300;
export const MIN_SEARCH_QUERY_LEN = 2;

export const DUPLICATE_MSG = "הספר כבר בספרייה שלך";

/** @typedef {{
 *   api?: { callFunction: Function, getClient?: Function, getSession?: Function },
 *   data?: typeof import('./data.js?v=18f2175'),
 *   getLibrary: () => import('./data.js?v=18f2175').LibraryState | null,
 *   setLibrary: (s: import('./data.js?v=18f2175').LibraryState) => void,
 *   showToast: (msg: string) => void,
 *   redrawLibrary?: () => Promise<void>,
 *   reloadLibrary?: () => Promise<void>,
 * }} AppCtx */

/** @type {AppCtx | null} */
let appCtx = null;

function isAppCtx(value) {
  return Boolean(value && typeof value.getLibrary === "function" && typeof value.setLibrary === "function");
}

/** @param {AppCtx} ctx */
function rememberCtx(ctx) {
  if (isAppCtx(ctx)) appCtx = ctx;
  return appCtx;
}

let toastTimer = 0;

function showToast(message) {
  if (typeof document === "undefined") return;
  const toastEl = document.getElementById("toast");
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 4000);
}

/**
 * The app ctx from `open(shelfId, ctx)` or `mount(root, ctx)`. There is only one
 * library state, owned by main.js; this module never loads its own copy.
 * @param {AppCtx | null | undefined} explicit
 */
function resolveCtx(explicit) {
  return isAppCtx(explicit) ? rememberCtx(explicit) : appCtx;
}

/**
 * @param {number} waitMs
 * @param {(query: string) => void | Promise<void>} fn
 */
export function debounce(waitMs, fn) {
  let timer = null;
  const debounced = (...args) => {
    if (timer) clearTimeout(timer);
    return new Promise((resolve) => {
      timer = setTimeout(() => {
        timer = null;
        resolve(Promise.resolve(fn(...args)));
      }, waitMs);
    });
  };
  debounced.cancel = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };
  return debounced;
}

/** @param {Record<string, unknown>} raw */
export function mapSearchBook(raw) {
  const id = raw.id ?? raw.bookId;
  const yearRaw = raw.year;
  let year = null;
  if (typeof yearRaw === "number" && Number.isFinite(yearRaw)) year = yearRaw;
  else if (yearRaw != null && yearRaw !== "") {
    const n = Number(yearRaw);
    if (Number.isFinite(n)) year = n;
  }
  return {
    simania_id: typeof id === "number" ? id : Number(id),
    title: String(raw.title ?? ""),
    author: raw.author != null ? String(raw.author) : null,
    year,
    cover_url: raw.coverUrl != null ? String(raw.coverUrl) : raw.cover_url != null ? String(raw.cover_url) : null,
  };
}

/** @param {unknown} payload */
export function mapSearchBooksResponse(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.books)) return [];
  return payload.books.map((b) => mapSearchBook(b));
}

export function createSearchGeneration() {
  let generation = 0;
  return {
    next() {
      generation += 1;
      return generation;
    },
    isLatest(token) {
      return token === generation;
    },
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {import('./data.js?v=18f2175').LibraryState} state
 * @param {string} shelfId
 * @param {ReturnType<typeof mapSearchBook>} hit
 */
export function applyOptimisticAdd(state, shelfId, hit, pendingKey = nextPendingKey()) {
  const next = cloneLibrary(state);
  const shelf = next.shelves.find((s) => s.id === shelfId);
  if (!shelf) return next;
  shelf.books.push({
    simania_id: hit.simania_id,
    work_id: null,
    resolve_status: "pending",
    title: hit.title,
    author: hit.author,
    translator: null,
    publisher: null,
    series: null,
    category: null,
    year: hit.year,
    pages: null,
    description: null,
    cover_url: hit.cover_url,
    simania_rating: null,
    simania_rating_count: null,
    shelf_id: shelfId,
    shelf_name: shelf.name,
    shelf_kind: shelf.kind,
    position: shelf.books.length,
    added_at: null,
    finished_at: null,
    rating: null,
    pending: true,
    pending_key: pendingKey,
  });
  return next;
}

let pendingCounter = 0;

function nextPendingKey() {
  pendingCounter += 1;
  return `add-${pendingCounter}`;
}

/**
 * Remove only the pending row this add created. Never restore a snapshot (that would
 * drop other adds still in flight) and never match by simania_id (on 409 the real copy
 * of that edition is already on a shelf).
 * @param {import('./data.js?v=18f2175').LibraryState} state
 * @param {string} pendingKey
 */
export function removePendingAdd(state, pendingKey) {
  const next = cloneLibrary(state);
  for (const shelf of next.shelves) {
    shelf.books = shelf.books.filter((b) => !(b.pending && b.pending_key === pendingKey));
  }
  return next;
}

/** @param {unknown} err */
export function addErrorMessage(err) {
  if (err && typeof err === "object" && err.status === 409) return DUPLICATE_MSG;
  return err instanceof Error ? err.message : "לא הצלחנו להוסיף את הספר";
}

/**
 * @param {import('./data.js?v=18f2175').LibraryState} state
 * @param {string} shelfId
 * @param {string} pendingKey
 * @param {Record<string, unknown>} book
 */
export function fillBookFromAddResponse(state, shelfId, pendingKey, book) {
  const merged = cloneLibrary(state);
  const shelf = merged.shelves.find((s) => s.id === shelfId);
  if (!shelf) return merged;
  const filled = { ...book, pending: false };
  const idx = shelf.books.findIndex((b) => b.pending && b.pending_key === pendingKey);
  if (idx >= 0) {
    shelf.books[idx] = filled;
  } else if (!shelf.books.some((b) => !b.pending && b.simania_id === book.simania_id)) {
    // The server kept the book even though its pending row is gone; show it.
    shelf.books.push(filled);
  }
  return merged;
}

function shelfSelector(shelfId) {
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(shelfId)
      : String(shelfId).replace(/"/g, "");
  return `.shelf[data-shelf-id="${escaped}"]`;
}

/**
 * Dim the pending row that this add created. Match by shelf + index so a 409
 * duplicate does not paint `.pending` onto the copy that must stay.
 * @param {HTMLElement} libRoot
 * @param {import('./data.js?v=18f2175').LibraryState} state
 */
export function markPendingBooks(libRoot, state) {
  if (!libRoot || !state) return;
  for (const shelf of state.shelves) {
    const shelfEl = libRoot.querySelector(shelfSelector(shelf.id));
    if (!shelfEl) continue;
    const tiles = [...shelfEl.querySelectorAll(".book:not(.plus)")];
    for (let i = 0; i < shelf.books.length; i++) {
      if (shelf.books[i].pending) tiles[i]?.classList.add("pending");
    }
  }
}

/**
 * @param {number} simaniaId
 * @param {string} shelfId
 */
async function callAddBook(simaniaId, shelfId) {
  const api = await import("./api.js?v=18f2175");
  const { FUNCTIONS_URL, SUPABASE_ANON_KEY } = await import("./config.js?v=18f2175");
  const [session, simania] = await Promise.all([api.getSession(), fetchSimaniaPayload(simaniaId)]);
  const token = session?.access_token || SUPABASE_ANON_KEY;
  const res = await fetch(`${FUNCTIONS_URL}/${FUNCTIONS.ADD_BOOK}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ simania_id: simaniaId, shelf_id: shelfId, simania }),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 409) {
    const err = new Error(DUPLICATE_MSG);
    err.status = 409;
    throw err;
  }
  if (!res.ok) {
    const msg = typeof json.error === "string" ? json.error : `שגיאה (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

function renderResultItem(hit) {
  const title = escapeHtml(hit.title);
  const author = escapeHtml(hit.author || "");
  const year = hit.year != null ? ` · ${hit.year}` : "";
  const cover = hit.cover_url
    ? `<img src="${escapeHtml(hit.cover_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="search-hit-cover-ph" aria-hidden="true"></span>`;
  return `<li><button type="button" class="search-hit" data-simania-id="${hit.simania_id}">
    ${cover}
    <span class="search-hit-text"><strong>${title}</strong><span>${author}${year}</span></span>
  </button></li>`;
}

function setResultsPanel(panel, { status, hits = [], message = "" }) {
  if (!panel) return;
  panel.dataset.status = status;
  if (status === "loading") {
    panel.innerHTML = `<p class="search-status" role="status">טוען…</p>`;
    return;
  }
  if (status === "error") {
    panel.innerHTML = `<p class="search-status search-error" role="alert">${escapeHtml(message || "לא הצלחנו לחפש ספרים")}</p>`;
    return;
  }
  if (status === "idle") {
    panel.innerHTML = "";
    return;
  }
  if (!hits.length) {
    panel.innerHTML = `<p class="search-status">לא נמצאו ספרים</p>`;
    return;
  }
  panel.innerHTML = `<ul class="search-results">${hits.map(renderResultItem).join("")}</ul>`;
}

/**
 * @param {{
 *   input: HTMLInputElement,
 *   panel: HTMLElement,
 *   onPick: (hit: ReturnType<typeof mapSearchBook>) => void,
 *   callSearch: (query: string) => Promise<unknown>,
 * }} opts
 */
export function wireSearchInput(opts) {
  const gen = createSearchGeneration();
  /** @type {ReturnType<typeof mapSearchBook>[]} */
  let lastHits = [];

  const runSearch = debounce(SEARCH_DEBOUNCE_MS, async () => {
    const token = gen.next();
    const trimmed = String(opts.input.value ?? "").trim();
    if (!gen.isLatest(token)) return;
    if (trimmed.length < MIN_SEARCH_QUERY_LEN) {
      lastHits = [];
      setResultsPanel(opts.panel, { status: "idle" });
      return;
    }
    setResultsPanel(opts.panel, { status: "loading" });
    try {
      const payload = await opts.callSearch(trimmed);
      if (!gen.isLatest(token)) return;
      lastHits = mapSearchBooksResponse(payload);
      setResultsPanel(opts.panel, { status: "results", hits: lastHits });
    } catch (err) {
      if (!gen.isLatest(token)) return;
      lastHits = [];
      setResultsPanel(opts.panel, {
        status: "error",
        message: err instanceof Error ? err.message : "לא הצלחנו לחפש ספרים",
      });
    }
  });

  const abort = () => {
    runSearch.cancel();
    gen.next();
    lastHits = [];
  };

  const onInput = () => {
    void runSearch();
  };
  opts.input.addEventListener("input", onInput);

  const onPanelClick = (e) => {
    const el = e.target instanceof Element ? e.target : e.target?.parentElement;
    const btn = el?.closest?.(".search-hit");
    if (!btn) return;
    const id = Number(btn.dataset.simaniaId);
    const hit = lastHits.find((h) => h.simania_id === id);
    if (hit) opts.onPick(hit);
  };
  opts.panel.addEventListener("click", onPanelClick);

  const cleanup = () => {
    abort();
    opts.input.removeEventListener("input", onInput);
    opts.panel.removeEventListener("click", onPanelClick);
  };
  cleanup.abort = abort;
  return cleanup;
}

function ensurePickerShell() {
  if (typeof document === "undefined") return null;
  const picker = document.getElementById("picker");
  if (!picker) return null;
  if (picker.dataset.ready === "1") return picker;
  picker.innerHTML = `<div class="box" role="dialog" aria-labelledby="picker-title">
    <button type="button" class="x" aria-label="סגור">×</button>
    <h3 id="picker-title">הוספת ספר</h3>
    <p class="picker-shelf"></p>
    <form class="search add-book-search" action="#">
      <input type="search" autocomplete="off" placeholder="חפש ספר בעברית…" aria-label="חיפוש ספר">
    </form>
    <div class="search-panel"></div>
  </div>`;
  picker.dataset.ready = "1";
  return picker;
}

function closePicker() {
  if (typeof document === "undefined") return;
  abortPickerSearch();
  const picker = document.getElementById("picker");
  picker?.classList.remove("on");
  const input = picker?.querySelector("input");
  if (input instanceof HTMLInputElement) input.value = "";
  const panel = picker?.querySelector(".search-panel");
  if (panel) setResultsPanel(panel, { status: "idle" });
}

function shelfNameFromDom(shelfId) {
  if (typeof document === "undefined") return "";
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(shelfId) : String(shelfId).replace(/"/g, "");
  const shelf = document.querySelector(`.shelf[data-shelf-id="${escaped}"]`);
  return shelf?.querySelector("h2")?.textContent ?? "";
}

let pickerCleanup = null;
let presetShelfId = null;
let pickerEscapeWired = false;
let showPickerForShelf = null;

function abortPickerSearch() {
  pickerCleanup?.abort?.();
}

function wirePickerEscape() {
  if (pickerEscapeWired || typeof document === "undefined") return;
  pickerEscapeWired = true;
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePicker();
  });
}

async function redrawLibraryWithPending(ctx) {
  await ctx.redrawLibrary?.();
  if (typeof document === "undefined") return;
  const libRoot = document.getElementById("screen-library");
  const state = ctx.getLibrary();
  if (libRoot && state) markPendingBooks(libRoot, state);
}

/**
 * @param {ReturnType<typeof mapSearchBook>} hit
 * @param {string} shelfId
 * @param {{ ctx?: AppCtx, add?: typeof callAddBook }} [options]
 */
export async function addBookToShelf(hit, shelfId, options = {}) {
  const ctx = resolveCtx(options.ctx);
  const state = ctx?.getLibrary();
  if (!ctx || !state) {
    showToast("הספרייה עדיין נטענת, נסו שוב");
    return;
  }

  const pendingKey = nextPendingKey();
  ctx.setLibrary(applyOptimisticAdd(state, shelfId, hit, pendingKey));
  await redrawLibraryWithPending(ctx);

  closePicker();

  const add = options.add ?? callAddBook;
  try {
    const payload = await add(hit.simania_id, shelfId);
    const book = payload?.book;
    if (!book) throw new Error("תשובה לא תקינה מהשרת");
    ctx.setLibrary(fillBookFromAddResponse(ctx.getLibrary(), shelfId, pendingKey, book));
    notifyShelvesChanged();
    await redrawLibraryWithPending(ctx);
    const shelf = ctx.getLibrary()?.shelves.find((s) => s.id === shelfId);
    if (shouldPromptRating(shelf?.kind, null)) promptRating(ctx, { simania_id: hit.simania_id, title: book.title ?? hit.title });
  } catch (err) {
    ctx.setLibrary(removePendingAdd(ctx.getLibrary(), pendingKey));
    await redrawLibraryWithPending(ctx);
    ctx.showToast(addErrorMessage(err));
  }
}

function wirePicker(ctx) {
  const picker = ensurePickerShell();
  if (!picker) return;
  const panel = picker.querySelector(".search-panel");
  const input = picker.querySelector("input");
  const shelfLine = picker.querySelector(".picker-shelf");
  const form = picker.querySelector("form");
  if (!(input instanceof HTMLInputElement) || !panel) return;

  if (picker.dataset.wired !== "1") {
    picker.dataset.wired = "1";
    picker.addEventListener("click", (e) => {
      if (e.target === picker || e.target.closest(".x")) closePicker();
    });
    form?.addEventListener("submit", (e) => e.preventDefault());
    wirePickerEscape();
  }

  if (!pickerCleanup) {
    pickerCleanup = wireSearchInput({
      input,
      panel,
      callSearch: searchSimania,
      onPick: (hit) => {
        if (presetShelfId) void addBookToShelf(hit, presetShelfId, { ctx });
      },
    });
  }

  showPickerForShelf = (shelfId, shelfName) => {
    abortPickerSearch();
    presetShelfId = shelfId;
    if (shelfLine) shelfLine.textContent = shelfName ? `למדף: ${shelfName}` : "";
    picker.classList.add("on");
    input.value = "";
    setResultsPanel(panel, { status: "idle" });
    input.focus();
  };
}

/** @param {string} shelfId @param {AppCtx} ctx */
export async function open(shelfId, ctx) {
  const resolved = resolveCtx(ctx);
  if (!resolved) {
    showToast("הספרייה עדיין נטענת, נסו שוב");
    return;
  }
  wirePicker(resolved);
  const shelf = resolved.getLibrary()?.shelves?.find((s) => s.id === shelfId);
  showPickerForShelf?.(shelfId, shelf?.name ?? shelfNameFromDom(shelfId));
}

let searchUnmount = null;

/**
 * @param {HTMLElement} root
 * @param {AppCtx} ctx
 */
export async function mount(root, ctx) {
  rememberCtx(ctx);

  if (!ctx.getLibrary?.() && ctx.data && ctx.api?.getClient) {
    try {
      ctx.setLibrary(await ctx.data.loadLibrary(ctx.api.getClient()));
    } catch (err) {
      ctx.showToast?.(err instanceof Error ? err.message : "לא הצלחנו לטעון את הספרייה");
    }
  }

  wirePicker(ctx);

  const inner = root.querySelector(".screen-inner") ?? root;
  inner.innerHTML = `<header class="search-page-head"><h1>חיפוש ספרים</h1></header>
    <form class="search add-book-search search-page" action="#">
      <input type="search" autocomplete="off" placeholder="חפש ספר בעברית…" aria-label="חיפוש ספר">
    </form>
    <div class="search-panel"></div>
    <div class="shelf-pick" hidden>
      <h2>בחר מדף</h2>
      <ul class="shelf-pick-list"></ul>
      <button type="button" class="shelf-pick-cancel">ביטול</button>
    </div>`;

  const form = inner.querySelector("form");
  const input = inner.querySelector("input");
  const panel = inner.querySelector(".search-panel");
  const shelfPick = inner.querySelector(".shelf-pick");
  const shelfList = inner.querySelector(".shelf-pick-list");
  const cancelPick = inner.querySelector(".shelf-pick-cancel");
  if (!(input instanceof HTMLInputElement) || !panel || !shelfPick || !shelfList) {
    return undefined;
  }

  form?.addEventListener("submit", (e) => e.preventDefault());

  /** @type {ReturnType<typeof mapSearchBook> | null} */
  let pendingHit = null;

  const hideShelfPick = () => {
    shelfPick.hidden = true;
    pendingHit = null;
  };

  const showShelfPick = (hit) => {
    pendingHit = hit;
    const lib = ctx.getLibrary();
    shelfList.innerHTML = (lib?.shelves ?? [])
      .map(
        (s) =>
          `<li><button type="button" class="shelf-pick-btn" data-shelf-id="${escapeHtml(s.id)}">${escapeHtml(s.name)}</button></li>`,
      )
      .join("");
    shelfPick.hidden = false;
  };

  cancelPick?.addEventListener("click", hideShelfPick);

  shelfList.addEventListener("click", (e) => {
    const el = e.target instanceof Element ? e.target : e.target?.parentElement;
    const btn = el?.closest?.(".shelf-pick-btn");
    if (!btn || !pendingHit) return;
    const shelfId = btn.dataset.shelfId;
    if (!shelfId) return;
    const hit = pendingHit;
    hideShelfPick();
    void addBookToShelf(hit, shelfId, { ctx });
  });

  if (searchUnmount) searchUnmount();
  searchUnmount = wireSearchInput({
    input,
    panel,
    callSearch: searchSimania,
    onPick: (hit) => showShelfPick(hit),
  });

  const onKey = (e) => {
    if (e.key === "Escape") {
      if (!shelfPick.hidden) hideShelfPick();
      else closePicker();
    }
  };
  addEventListener("keydown", onKey);

  return () => {
    removeEventListener("keydown", onKey);
    if (searchUnmount) {
      searchUnmount();
      searchUnmount = null;
    }
  };
}
