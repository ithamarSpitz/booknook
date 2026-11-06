import { notifyShelvesChanged } from "./events.js";
import { promptRating, renderStars, saveRating, shouldPromptRating } from "./my-rating.js";
import {
  applyOptimisticBookMove,
  applyOptimisticRemoveBook,
  cloneLibrary,
  moveBook,
  removeBook,
} from "./data.js";

/**
 * @param {HTMLElement} overlay `.bk` element
 * @param {{
 *   api: { getClient: () => import('@supabase/supabase-js').SupabaseClient },
 *   data: typeof import('./data.js'),
 *   showToast: (msg: string) => void,
 *   getLibrary?: () => import('./data.js').LibraryState | null,
 *   setLibrary?: (s: import('./data.js').LibraryState) => void,
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
  const myRatingEl = $(".bk-my-rating");
  const myStarsEl = $(".bk-my-rating .my-stars");
  const metaEl = $(".bk-meta");
  const descEl = $(".bk-desc");
  const moveSelect = overlay.querySelector(".bk-move select");
  const removeBtn = overlay.querySelector(".bk-remove");
  const cardEl = $(".bk-card");

  let current = null;
  let shelves = [];
  let drag = null;
  let springTimer = null;

  function clearDragStyles() {
    if (!cardEl) return;
    if (springTimer !== null) {
      clearTimeout(springTimer);
      springTimer = null;
    }
    cardEl.classList.remove("bk-dragging", "bk-springing");
    cardEl.style.transform = "";
  }

  function resetDrag() {
    drag = null;
    clearDragStyles();
  }

  function touchById(touches, id) {
    return Array.from(touches || []).find((touch) => touch.identifier === id);
  }

  function springBack() {
    if (!cardEl) return;
    cardEl.classList.remove("bk-dragging");
    cardEl.classList.add("bk-springing");
    cardEl.style.transform = "translateY(0px)";

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      clearDragStyles();
      return;
    }

    const finish = (event) => {
      if (event.target === cardEl && (!event.propertyName || event.propertyName === "transform")) {
        clearDragStyles();
      }
    };
    cardEl.addEventListener("transitionend", finish, { once: true });
    springTimer = setTimeout(clearDragStyles, 250);
  }

  function renderRating(book) {
    const englishEdition = Boolean(book.english_edition || (book.simania_id && book.simania_id < 0));
    const count = book.simania_rating_count ?? 0;
    const rating = book.simania_rating ?? 0;
    if (!count) {
      ratingEl.innerHTML = englishEdition
        ? "<small>אין עדיין דירוגים ב־Hardcover</small>"
        : "<small>אין עדיין דירוגים בסימניה</small>";
      return;
    }
    const width = (rating / 5) * 100;
    const label = englishEdition ? "דירוגים ב־Hardcover" : "דירוגים בסימניה";
    ratingEl.innerHTML = `<span class="stars"><span class="fill" style="width:${width}%"></span></span><b>${rating}</b><small>(${count.toLocaleString("he-IL")} ${label})</small>`;
  }

  // The reader's own rating, only for books on their shelves (not recommendations).
  function renderMyRating(book) {
    if (!myRatingEl || !myStarsEl) return;
    myRatingEl.hidden = !book.shelf_id;
    if (!book.shelf_id) return;
    renderStars(myStarsEl, book.rating ?? null, async (rating) => {
      const previous = book.rating ?? null;
      book.rating = rating;
      renderMyRating(book);
      if (!(await saveRating(deps, book.simania_id, rating))) {
        book.rating = previous;
        if (current === book) renderMyRating(book);
      }
    });
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
    resetDrag();
    current = book;
    shelves = shelfList;
    cover.src = book.cover_url || "";
    cover.alt = book.title;
    shelfEl.textContent = book.shelf_name || "";
    titleEl.textContent = book.title;
    authorEl.textContent = book.author || "";
    titleEl.setAttribute("dir", "auto");
    authorEl.setAttribute("dir", "auto");
    descEl.setAttribute("dir", "auto");
    renderRating(book);
    renderMyRating(book);
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
    resetDrag();
  }

  cardEl?.addEventListener("touchstart", (event) => {
    if (
      !overlay.classList.contains("on")
      || !matchMedia("(max-width: 640px)").matches
      || cardEl.scrollTop > 0
      || event.touches.length !== 1
    ) {
      drag = null;
      return;
    }
    clearDragStyles();
    const touch = event.touches[0];
    drag = {
      id: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: event.timeStamp,
      dy: 0,
      engaged: false,
      rejected: false,
    };
  }, { passive: true });

  cardEl?.addEventListener("touchmove", (event) => {
    if (!drag || drag.rejected || !overlay.classList.contains("on")) return;
    const touch = touchById(event.touches, drag.id);
    if (!touch) return;
    const dx = touch.clientX - drag.startX;
    const rawDy = touch.clientY - drag.startY;

    if (!drag.engaged) {
      if (Math.abs(dx) >= 8 && Math.abs(dx) >= Math.abs(rawDy)) {
        drag.rejected = true;
        return;
      }
      if (rawDy < 8 || rawDy <= Math.abs(dx)) return;
      drag.engaged = true;
      cardEl.classList.add("bk-dragging");
    }

    event.preventDefault();
    drag.dy = Math.max(0, rawDy);
    cardEl.style.transform = `translateY(${drag.dy}px)`;
  }, { passive: false });

  cardEl?.addEventListener("touchend", (event) => {
    if (!drag) return;
    const releaseTouch = touchById(event.changedTouches, drag.id);
    if (!releaseTouch) return;
    const finished = drag;
    drag = null;
    if (!finished.engaged) return;
    finished.dy = Math.max(0, releaseTouch.clientY - finished.startY);
    const elapsed = Math.max(1, event.timeStamp - finished.startTime);
    const fastEnough = finished.dy >= 30 && finished.dy / elapsed >= 0.5;
    if (finished.dy >= 90 || fastEnough) close();
    else springBack();
  });

  cardEl?.addEventListener("touchcancel", (event) => {
    if (!drag || !touchById(event.changedTouches, drag.id)) return;
    const engaged = drag.engaged;
    drag = null;
    if (engaged) springBack();
  });

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
      const moved = current;
      await moveBook(client, moved.simania_id, toShelf, 0);
      notifyShelvesChanged();
      close();
      const kind = shelves.find((s) => s.id === toShelf)?.kind;
      if (shouldPromptRating(kind, moved.rating)) promptRating(deps, moved);
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
