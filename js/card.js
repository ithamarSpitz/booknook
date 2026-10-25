import { notifyShelvesChanged } from "./events.js?v=4dfdb63";
import {
  applyOptimisticBookMove,
  applyOptimisticRemoveBook,
  cloneLibrary,
  moveBook,
  removeBook,
} from "./data.js?v=4dfdb63";

/**
 * @param {HTMLElement} overlay `.bk` element
 * @param {{
 *   api: { getClient: () => import('@supabase/supabase-js').SupabaseClient },
 *   data: typeof import('./data.js?v=4dfdb63'),
 *   showToast: (msg: string) => void,
 *   getLibrary?: () => import('./data.js?v=4dfdb63').LibraryState | null,
 *   setLibrary?: (s: import('./data.js?v=4dfdb63').LibraryState) => void,
 *   onLibraryChange: () => Promise<void>,
 * }} deps
 */
export function createCard(overlay, deps) {
  const $ = (sel) => overlay.querySelector(sel);
  const cover = $(".bk-cover");
  const titleEl = $(".bk-title");
  const authorEl = $(".bk-author");
  const shelfEl = $(".bk-shelf");
  const ratingEl = $(".bk-rating");
  const metaEl = $(".bk-meta");
  const descEl = $(".bk-desc");
  const moveSelect = overlay.querySelector(".bk-move select");
  const removeBtn = overlay.querySelector(".bk-remove");

  let current = null;
  let shelves = [];

  function renderRating(book) {
    const count = book.simania_rating_count ?? 0;
    const rating = book.simania_rating ?? 0;
    if (!count) {
      ratingEl.innerHTML = "<small>אין עדיין דירוגים בסימניה</small>";
      return;
    }
    const width = (rating / 5) * 100;
    ratingEl.innerHTML = `<span class="stars"><span class="fill" style="width:${width}%"></span></span><b>${rating}</b><small>(${count.toLocaleString("he-IL")} דירוגים בסימניה)</small>`;
  }

  function renderMeta(book) {
    const meta = [
      ["תרגום", book.translator],
      ["הוצאה", book.publisher],
      ["שנה", book.year],
      ["עמודים", book.pages],
      ["סדרה", book.series],
    ].filter((m) => m[1]);
    metaEl.innerHTML = meta.map(([k]) => `<dt>${k}</dt><dd></dd>`).join("");
    metaEl.querySelectorAll("dd").forEach((dd, i) => {
      dd.textContent = String(meta[i][1]);
    });
    metaEl.hidden = !meta.length;
  }

  function fillShelfSelect(book) {
    if (!moveSelect) return;
    moveSelect.replaceChildren();
    for (const s of shelves) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      if (s.id === book.shelf_id) opt.selected = true;
      moveSelect.append(opt);
    }
  }

  function open(book, shelfList) {
    current = book;
    shelves = shelfList;
    cover.src = book.cover_url || "";
    cover.alt = book.title;
    shelfEl.textContent = book.shelf_name || "";
    titleEl.textContent = book.title;
    authorEl.textContent = book.author || "";
    renderRating(book);
    renderMeta(book);
    descEl.textContent = book.description || "אין תקציר לספר הזה בסימניה.";
    descEl.classList.toggle("none", !book.description);
    fillShelfSelect(book);
    $(".bk-body") && ($(".bk-body").scrollTop = 0);
    $(".bk-card") && ($(".bk-card").scrollTop = 0);
    overlay.classList.add("on");
    document.body.style.overflow = "hidden";
    $(".bk-x")?.focus({ preventScroll: true });
  }

  function close() {
    overlay.classList.remove("on");
    document.body.style.overflow = "";
    current = null;
  }

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest(".bk-x")) close();
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("on")) close();
  });

  moveSelect?.addEventListener("change", async () => {
    if (!current) return;
    const toShelf = moveSelect.value;
    if (toShelf === current.shelf_id) return;
    const client = deps.api.getClient();
    const state = deps.getLibrary?.();
    const snapshot = state ? cloneLibrary(state) : null;
    if (state && deps.setLibrary) {
      deps.setLibrary(
        applyOptimisticBookMove(state, {
          simaniaId: current.simania_id,
          fromShelfId: current.shelf_id,
          toShelfId: toShelf,
          toPosition: 0,
        }),
      );
      await deps.onLibraryChange();
    }
    try {
      await moveBook(client, current.simania_id, toShelf, 0);
      notifyShelvesChanged();
      close();
    } catch (err) {
      if (snapshot && deps.setLibrary) {
        deps.setLibrary(snapshot);
        await deps.onLibraryChange();
      }
      deps.showToast(err instanceof Error ? err.message : "לא הצלחנו להעביר את הספר");
      fillShelfSelect(current);
    }
  });

  removeBtn?.addEventListener("click", async () => {
    if (!current) return;
    const client = deps.api.getClient();
    const state = deps.getLibrary?.();
    const snapshot = state ? cloneLibrary(state) : null;
    if (state && deps.setLibrary) {
      deps.setLibrary(applyOptimisticRemoveBook(state, current.simania_id));
      await deps.onLibraryChange();
    }
    try {
      await removeBook(client, current.simania_id);
      notifyShelvesChanged();
      close();
    } catch (err) {
      if (snapshot && deps.setLibrary) {
        deps.setLibrary(snapshot);
        await deps.onLibraryChange();
      }
      deps.showToast(err instanceof Error ? err.message : "לא הצלחנו להסיר את הספר");
    }
  });

  return { open, close };
}
