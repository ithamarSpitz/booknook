import { RPCS } from "./contract.js";
import { notifyRecsInputsChanged } from "./events.js";

export const GENRES_TITLE = "הגדרות מדפי המלצות";
export const GENRES_EMPTY = "דרגו כמה ספרים כדי שנמצא ז'אנרים בשבילכם";
export const SAVED_TOAST = "נשמר. המדפים יתעדכנו בעוד רגע";
export const DEFAULT_SHELF_COUNT = 10;

export const OPTIONS = Object.freeze([
  { state: "auto", label: "אוטומטי" },
  { state: "pinned", label: "תמיד להציג" },
  { state: "hidden", label: "לא להציג" },
]);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Union of reader_genres (position order) and preference-only genres (by label).
 * @param {Record<string, any>[]} readerGenres
 * @param {Record<string, any>[]} prefs
 * @param {Iterable<string>} shownKeys
 */
export function buildGenreRows(readerGenres, prefs, shownKeys) {
  const shown = new Set(shownKeys ?? []);
  const prefByKey = new Map((prefs ?? []).map((p) => [p.genre_key, p]));
  const found = [...(readerGenres ?? [])].sort((a, b) => Number(a.position) - Number(b.position));
  const seen = new Set(found.map((g) => g.genre_key));
  const rows = found.map((g) => ({
    genre_key: g.genre_key,
    label: g.label,
    seed_count: Number(g.seed_count),
    candidate_count: Number(g.candidate_count),
    hasCounts: true,
    shown: shown.has(g.genre_key),
    state: prefByKey.get(g.genre_key)?.state ?? "auto",
  }));
  const extra = (prefs ?? [])
    .filter((p) => !seen.has(p.genre_key))
    .sort((a, b) => String(a.label).localeCompare(String(b.label), "he"));
  for (const p of extra) {
    rows.push({
      genre_key: p.genre_key,
      label: p.label,
      seed_count: 0,
      candidate_count: 0,
      hasCounts: false,
      shown: shown.has(p.genre_key),
      state: p.state,
    });
  }
  return rows;
}

/** Pin limit: at most N - 1 pinned genres. */
export function pinInfo(rows, shelfCount) {
  const limit = Math.max(0, Number(shelfCount) - 1);
  const pinned = rows.filter((r) => r.state === "pinned").length;
  return { limit, pinned, full: pinned >= limit, over: pinned > limit };
}

export function pinNote(info) {
  if (info.over) return `רק ${info.limit} הנעיצות הראשונות יוצגו כמדפים`;
  return `אפשר לנעוץ עד ${info.limit} מדפים, כדי שיישאר מקום לז'אנר חדש`;
}

export function genreRowHtml(row, info) {
  const counts = row.hasCounts
    ? `<p class="genre-counts">${row.seed_count} ספרים שלך · ${row.candidate_count} ספרים מתאימים</p>`
    : "";
  const tag = row.shown ? `<span class="genre-tag">מוצג עכשיו</span>` : "";
  const buttons = OPTIONS.map((o) => {
    const on = row.state === o.state;
    const disabled = row.pending || (o.state === "pinned" && row.state !== "pinned" && info.full);
    return `<button type="button" class="genre-opt${on ? " is-on" : ""}" data-state="${o.state}" aria-pressed="${on}"${disabled ? " disabled" : ""}>${o.label}</button>`;
  }).join("");
  return `<li class="genre-row" data-genre-key="${escapeHtml(row.genre_key)}">
    <div class="genre-head"><h2 dir="auto">${escapeHtml(row.label)}</h2>${tag}</div>
    ${counts}
    <div class="genre-seg" role="group" aria-label="${escapeHtml(row.label)}">${buttons}</div>
  </li>`;
}

export function genreListHtml(rows, shelfCount) {
  if (!rows.length) return `<p class="genre-state" role="status">${GENRES_EMPTY}</p>`;
  const info = pinInfo(rows, shelfCount);
  const note = info.full ? `<p class="genre-note" role="note">${pinNote(info)}</p>` : "";
  return `${note}<ul class="genre-list" role="list">${rows.map((r) => genreRowHtml(r, info)).join("")}</ul>`;
}

function countSelectHtml(count, pending) {
  const options = Array.from({ length: 20 }, (_, i) => i + 1)
    .map((n) => `<option value="${n}"${n === count ? " selected" : ""}>${n}</option>`)
    .join("");
  return `<label class="genre-count-label">מספר מדפי המלצות
    <select class="genre-count"${pending ? " disabled" : ""}>${options}</select></label>`;
}

const errorText = (error, fallback) => (error instanceof Error && error.message ? error.message : fallback);

/**
 * @param {HTMLElement} root
 * @param {{ api: { getClient: Function }, showToast?: (message: string) => void }} ctx
 */
export async function mount(root, ctx) {
  const inner = root.querySelector(".screen-inner") ?? root;
  const client = ctx.api.getClient();
  let alive = true;
  let rows = [];
  let shelfCount = DEFAULT_SHELF_COUNT;
  let shelfCountPending = false;

  inner.innerHTML = `<div class="genre-wrap">
    <h1 class="genre-title">${GENRES_TITLE}</h1>
    <div class="genre-content"><p class="genre-state" role="status">טוען…</p></div>
  </div>`;
  const content = inner.querySelector(".genre-content");

  const render = () => {
    if (!alive || !content) return;
    content.innerHTML = `${countSelectHtml(shelfCount, shelfCountPending)}${genreListHtml(rows, shelfCount)}`;
  };

  const saved = () => {
    notifyRecsInputsChanged();
    ctx.showToast?.(SAVED_TOAST);
  };

  const onClick = async (event) => {
    const button = event.target?.closest?.(".genre-opt");
    if (!button || button.disabled) return;
    const key = button.closest(".genre-row")?.dataset?.genreKey;
    const row = rows.find((r) => r.genre_key === key);
    const state = button.dataset?.state;
    if (!row || row.pending || !OPTIONS.some((o) => o.state === state) || row.state === state) return;
    if (state === "pinned" && pinInfo(rows, shelfCount).full) return;

    const previous = row.state;
    row.state = state;
    row.pending = true;
    render();
    try {
      const { error } = await client.rpc(RPCS.SET_GENRE_PREFERENCE.name, {
        p_genre_key: row.genre_key,
        p_label: row.label,
        p_state: state,
      });
      if (error) throw error;
      saved();
    } catch (error) {
      row.state = previous;
      ctx.showToast?.(errorText(error, "לא הצלחנו לשמור את השינוי"));
    } finally {
      row.pending = false;
      render();
    }
  };

  const onChange = async (event) => {
    const select = event.target?.closest?.(".genre-count");
    if (!select || shelfCountPending) return;
    const next = Number(select.value);
    if (!Number.isInteger(next) || next < 1 || next > 20 || next === shelfCount) return;
    const previous = shelfCount;
    shelfCount = next;
    shelfCountPending = true;
    render();
    try {
      const { error } = await client.rpc(RPCS.SET_GENRE_SHELF_COUNT.name, { p_count: next });
      if (error) throw error;
      saved();
    } catch (error) {
      shelfCount = previous;
      ctx.showToast?.(errorText(error, "לא הצלחנו לשמור את השינוי"));
    } finally {
      shelfCountPending = false;
      render();
    }
  };

  inner.addEventListener("click", onClick);
  inner.addEventListener("change", onChange);

  try {
    const [profile, genres, prefs, shelves] = await Promise.all([
      client.from("profiles").select("genre_shelf_count").maybeSingle(),
      client.from("reader_genres").select("genre_key,label,seed_count,candidate_count,position").order("position", { ascending: true }),
      client.from("genre_preferences").select("genre_key,label,state,pin_order"),
      client.from("genre_recommendations").select("genre_key"),
    ]);
    for (const result of [profile, genres, prefs, shelves]) if (result.error) throw result.error;
    const count = Number(profile.data?.genre_shelf_count);
    if (Number.isInteger(count) && count >= 1 && count <= 20) shelfCount = count;
    rows = buildGenreRows(
      genres.data ?? [],
      prefs.data ?? [],
      (shelves.data ?? []).map((r) => r.genre_key),
    );
    render();
  } catch (error) {
    if (alive && content) {
      content.innerHTML = `<p class="genre-state genre-error" role="alert">${escapeHtml(errorText(error, "לא הצלחנו לטעון את ההגדרות"))}</p>`;
    }
  }

  return () => {
    alive = false;
    inner.removeEventListener("click", onClick);
    inner.removeEventListener("change", onChange);
    inner.innerHTML = "";
  };
}
