import { RPCS } from "./contract.js";

export const RESTORED_TOAST = "הספר יחזור להמלצות בפעם הבאה שהן יתעדכנו";
export const REMOVED_EMPTY = "לא הסרת ספרים";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function related(value) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/**
 * Maps a dismissed_works row to the display contract. Positive edition IDs are
 * Hebrew editions; negative IDs are generated English Hardcover editions.
 * @param {Record<string, any>} row
 */
export function mapRemovedRow(row) {
  const work = related(row.works ?? row.work) ?? {};
  const editions = (Array.isArray(work.editions) ? work.editions : [])
    .filter((edition) => Number(edition?.simania_id) > 0)
    .sort((a, b) => Number(a.simania_id) - Number(b.simania_id));
  const edition = editions[0] ?? null;
  const authors = Array.isArray(work.original_authors) ? work.original_authors : [];

  return {
    work_id: String(row.work_id ?? ""),
    kind: row.kind === "not_my_type" ? "not_my_type" : "hide",
    dismissed_at: String(row.dismissed_at ?? ""),
    title: String(edition?.title ?? work.original_title ?? ""),
    author: edition?.author ?? authors[0] ?? null,
    cover_url: edition?.cover_url ?? work.hardcover_cover_url ?? null,
  };
}

/** @param {Record<string, any>[]} rows */
export function mapRemovedRows(rows) {
  return (rows ?? [])
    .map(mapRemovedRow)
    .sort((a, b) => {
      const byDate = Date.parse(b.dismissed_at) - Date.parse(a.dismissed_at);
      return Number.isNaN(byDate) || byDate === 0
        ? b.dismissed_at.localeCompare(a.dismissed_at)
        : byDate;
    });
}

/** @param {ReturnType<typeof mapRemovedRow>} row */
export function removedRowHtml(row) {
  const title = escapeHtml(row.title);
  const author = row.author
    ? `<p class="removed-author" dir="auto">${escapeHtml(row.author)}</p>`
    : "";
  const cover = row.cover_url
    ? `<img class="removed-cover" src="${escapeHtml(row.cover_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="removed-cover removed-cover-fallback" aria-hidden="true">${title.slice(0, 1)}</span>`;
  const label = row.kind === "not_my_type" ? "לא הסגנון שלי" : "הוסר";

  return `<li class="removed-row" data-work-id="${escapeHtml(row.work_id)}">
    ${cover}
    <div class="removed-book">
      <h2 dir="auto">${title}</h2>
      ${author}
      <span class="removed-label">${label}</span>
    </div>
    <button type="button" class="removed-restore">החזר</button>
  </li>`;
}

/** @param {ReturnType<typeof mapRemovedRow>[]} rows */
export function removedListHtml(rows) {
  if (!rows.length) return `<p class="removed-state" role="status">${REMOVED_EMPTY}</p>`;
  return `<ul class="removed-list" role="list">${rows.map(removedRowHtml).join("")}</ul>`;
}

/**
 * @param {ReturnType<import('./api.js').getClient>} client
 * @param {string} workId
 */
export async function restoreRemovedWork(client, workId) {
  const { error } = await client.rpc(RPCS.RESTORE_WORK.name, { p_work_id: workId });
  if (error) throw error;
}

/**
 * @param {HTMLElement} root
 * @param {{ api: { getClient: Function }, showToast?: (message: string) => void }} ctx
 */
export async function mount(root, ctx) {
  const inner = root.querySelector(".screen-inner") ?? root;
  const client = ctx.api.getClient();
  let alive = true;

  inner.innerHTML = `<div class="removed-wrap">
    <h1 class="removed-title">ספרים שהסרתי</h1>
    <div class="removed-content"><p class="removed-state" role="status">טוען…</p></div>
  </div>`;
  const content = inner.querySelector(".removed-content");

  const onClick = async (event) => {
    const button = event.target?.closest?.(".removed-restore");
    if (!button || !inner.contains(button)) return;
    const row = button.closest(".removed-row");
    const workId = row?.dataset?.workId;
    if (!row || !workId) return;

    button.disabled = true;
    try {
      await restoreRemovedWork(client, workId);
      if (!alive) return;
      row.remove();
      if (!content?.querySelector(".removed-row")) {
        content.innerHTML = removedListHtml([]);
      }
      ctx.showToast?.(RESTORED_TOAST);
    } catch (error) {
      if (!alive) return;
      button.disabled = false;
      ctx.showToast?.(error instanceof Error ? error.message : "לא הצלחנו להחזיר את הספר");
    }
  };
  inner.addEventListener("click", onClick);

  try {
    const { data, error } = await client
      .from("dismissed_works")
      .select("work_id,kind,dismissed_at,works!inner(original_title,original_authors,hardcover_cover_url,editions(simania_id,title,author,cover_url))")
      .order("dismissed_at", { ascending: false });
    if (error) throw error;
    if (alive && content) content.innerHTML = removedListHtml(mapRemovedRows(data ?? []));
  } catch (error) {
    if (alive && content) {
      const message = error instanceof Error ? error.message : "לא הצלחנו לטעון את הספרים שהסרת";
      content.innerHTML = `<p class="removed-state removed-error" role="alert">${escapeHtml(message)}</p>`;
    }
  }

  return () => {
    alive = false;
    inner.removeEventListener("click", onClick);
    inner.innerHTML = "";
  };
}
