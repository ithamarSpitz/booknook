import { SHELF_KINDS } from "./contract.js";
import {
  applyOptimisticBookMove,
  applyOptimisticDeleteShelf,
  applyOptimisticRename,
  applyOptimisticShelfMove,
  bookCountLabel,
  bookDropIndexFromCenters,
  cloneLibrary,
  createCustomShelf,
  deleteShelf,
  libraryTitle,
  moveBook,
  moveShelf,
  renameShelf,
  shelfIndexById,
} from "./data.js";
import * as addBook from "./add-book.js";
import * as firstRun from "./first-run.js";

const EDGE_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>`;
const EDIT_SVG = `<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>`;

let chromeWired = false;

/** @param {HTMLElement} row */
export function booksInRow(row) {
  return [...row.querySelectorAll(".book:not(.plus)")];
}

/** @param {HTMLElement} row @param {HTMLElement} bookEl */
export function bookPositionInRow(row, bookEl) {
  return booksInRow(row).indexOf(bookEl);
}

/**
 * RTL drop index: where the book would land among siblings (excluding plus).
 * @param {HTMLElement} row
 * @param {HTMLElement} bookEl
 * @param {number} clientX
 */
export function bookDropIndex(row, bookEl, clientX) {
  const tiles = booksInRow(row).filter((b) => b !== bookEl);
  const centers = tiles.map((t) => {
    const r = t.getBoundingClientRect();
    return r.left + r.width / 2;
  });
  return bookDropIndexFromCenters(centers, clientX);
}

/** @param {HTMLElement} caseEl @param {HTMLElement} shelfEl */
export function shelfPositionInCase(caseEl, shelfEl) {
  const ids = [...caseEl.querySelectorAll(":scope > .shelf")].map((s) => s.dataset.shelfId);
  return shelfIndexById(ids, shelfEl.dataset.shelfId ?? "");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function bookTile(book) {
  const title = escapeHtml(book.title);
  const author = escapeHtml(book.author || "");
  const cover = book.cover_url
    ? `<img class="cover" src="${escapeHtml(book.cover_url)}" alt="${title}" loading="lazy" referrerpolicy="no-referrer" draggable="false">`
    : `<span class="cover" aria-hidden="true"></span>`;
  return `<div class="book" tabindex="0" data-simania-id="${book.simania_id}">
    ${cover}
    <span class="t"><b>${title}</b><small>${author}</small></span>
  </div>`;
}

function shelfSection(shelf) {
  const custom = shelf.kind === SHELF_KINDS.CUSTOM;
  const editBtn = custom
    ? `<button type="button" class="edit" aria-label="שנה שם מדף">${EDIT_SVG}</button><button type="button" class="shelf-delete" aria-label="מחק מדף">×</button>`
    : "";
  const books = shelf.books.map(bookTile).join("");
  return `<section class="shelf" data-shelf-id="${shelf.id}" data-kind="${shelf.kind}">
    <div class="shelf-head"><h2>${escapeHtml(shelf.name)}</h2>${editBtn}<span>${bookCountLabel(shelf.books.length)}</span></div>
    <div class="rowwrap">
      <button type="button" class="edge prev" aria-label="הקודם"><span class="knob">${EDGE_SVG}</span></button>
      <div class="row">${books}<button type="button" class="book plus" aria-label="הוסף ספר למדף" data-shelf-id="${shelf.id}"><span class="cover">+</span></button></div>
      <button type="button" class="edge next" aria-label="הבא"><span class="knob">${EDGE_SVG}</span></button>
    </div>
    <div class="board"></div>
  </section>`;
}

function crownHtml(title) {
  return `<div class="crown"><button type="button" class="burger" id="menu-open" aria-label="פתח תפריט"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button><h1>${escapeHtml(title)}</h1></div>`;
}

function renderCase(root, state) {
  const caseEl = root.querySelector("#case");
  if (!caseEl) return;
  const title = libraryTitle(state.displayName);
  if (state.error) {
    caseEl.innerHTML = `${crownHtml(title)}<p class="empty">${escapeHtml(state.error)}</p>`;
    return;
  }
  const shelvesHtml = state.shelves.map(shelfSection).join("");
  caseEl.innerHTML = `${crownHtml(title)}
    ${shelvesHtml}
    <button type="button" class="add-slot" id="add-shelf"><span>+ מדף חדש</span></button><div class="board"></div>`;
}

function wireRowScroll(wrap) {
  const row = wrap.querySelector(".row");
  const prev = wrap.querySelector(".prev");
  const next = wrap.querySelector(".next");
  if (!row || !prev || !next) return;
  const update = () => {
    const pos = Math.abs(row.scrollLeft);
    prev.classList.toggle("on", pos > 2);
    next.classList.toggle("on", pos + row.clientWidth < row.scrollWidth - 2);
  };
  wrap._updateEdges = update;
  const step = () => row.clientWidth * 0.85;
  next.onclick = () => row.scrollBy({ left: -step() });
  prev.onclick = () => row.scrollBy({ left: step() });
  row.addEventListener("scroll", update, { passive: true });
  update();
}

function setMenu(open) {
  document.body.classList.toggle("menu-open", open);
}

function hangDoor() {
  const door = document.getElementById("drawer");
  const caseEl = document.getElementById("case");
  if (!door || !caseEl) return;
  const r = caseEl.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  door.style.right = `${Math.max(0, vw - r.right)}px`;
  door.style.top = `${Math.max(0, r.top)}px`;
  door.style.width = `${Math.min(Math.max(340, r.width / 2), vw * 0.86, 640)}px`;
}

function paint(root, ctx) {
  const state = ctx.getLibrary();
  if (!state) return;
  renderCase(root, state);
  const doorTitle = document.querySelector(".door-panel h2");
  if (doorTitle) doorTitle.textContent = libraryTitle(state.displayName);
  const firstRunHost = root.querySelector(".first-run");
  if (firstRunHost) {
    const show = !state.error && firstRun.shouldShow(state.shelves);
    firstRunHost.hidden = !show;
    if (show) firstRun.mount(firstRunHost, ctx);
  }
  hangDoor();
  root.querySelectorAll(".rowwrap").forEach(wireRowScroll);
}

function openBookFromEl(bookEl, ctx) {
  const lib = ctx.getLibrary();
  if (!lib) return;
  const id = Number(bookEl.dataset.simaniaId);
  const shelf = lib.shelves.find((s) => s.books.some((b) => b.simania_id === id));
  const cardBook = shelf?.books.find((b) => b.simania_id === id);
  if (cardBook) ctx.card.open(cardBook, lib.shelves);
}

async function onAddShelf(root, ctx) {
  const btn = root.querySelector("#add-shelf");
  if (btn instanceof HTMLButtonElement) btn.disabled = true;
  try {
    const shelf = await createCustomShelf(ctx.api.getClient(), "מדף חדש");
    const next = cloneLibrary(ctx.getLibrary());
    next.shelves.push({ ...shelf, books: [] });
    ctx.setLibrary(next);
    paint(root, ctx);
    const editBtn = root.querySelector(`[data-shelf-id="${shelf.id}"] .edit`);
    if (editBtn) startRename(editBtn, root, ctx);
  } catch (err) {
    if (btn instanceof HTMLButtonElement) btn.disabled = false;
    ctx.showToast(err instanceof Error ? err.message : "לא הצלחנו ליצור מדף");
  }
}

function startRename(editBtn, root, ctx) {
  const h = editBtn.parentNode?.querySelector("h2");
  if (!(h instanceof HTMLElement)) return;
  h.contentEditable = "true";
  h.focus();
  getSelection()?.selectAllChildren(h);
  h.onblur = async () => {
    h.removeAttribute("contenteditable");
    const section = h.closest(".shelf");
    const shelfId = section?.dataset.shelfId;
    const newName = h.textContent?.trim() || "";
    const snapshot = cloneLibrary(ctx.getLibrary());
    const shelf = snapshot.shelves.find((s) => s.id === shelfId);
    if (!shelfId || !shelf) return;
    if (!newName) {
      h.textContent = shelf.name;
      return;
    }
    if (shelf.name === newName) return;
    ctx.setLibrary(applyOptimisticRename(snapshot, shelfId, newName));
    try {
      await renameShelf(ctx.api.getClient(), shelfId, newName);
    } catch (err) {
      ctx.setLibrary(snapshot);
      paint(root, ctx);
      ctx.showToast(err instanceof Error ? err.message : "לא הצלחנו לשנות שם");
    }
  };
  h.onkeydown = (k) => {
    if (k.key === "Enter") {
      k.preventDefault();
      h.blur();
    }
  };
}

async function onDeleteShelf(delBtn, root, ctx) {
  const section = delBtn.closest(".shelf");
  const shelfId = section?.dataset.shelfId;
  if (!shelfId) return;
  const snapshot = cloneLibrary(ctx.getLibrary());
  ctx.setLibrary(applyOptimisticDeleteShelf(snapshot, shelfId));
  paint(root, ctx);
  try {
    await deleteShelf(ctx.api.getClient(), shelfId);
    const fresh = await ctx.data.loadLibrary(ctx.api.getClient());
    ctx.setLibrary(fresh);
    paint(root, ctx);
  } catch (err) {
    ctx.setLibrary(snapshot);
    paint(root, ctx);
    ctx.showToast(err instanceof Error ? err.message : "לא הצלחנו למחוק מדף");
  }
}

function wireChrome() {
  if (chromeWired) return;
  chromeWired = true;
  document.getElementById("menu-close")?.addEventListener("click", () => setMenu(false));
  document.getElementById("door-handle")?.addEventListener("click", () => setMenu(false));
  document.getElementById("scrim")?.addEventListener("click", () => setMenu(false));
  document.querySelector(".door-panel nav")?.addEventListener("click", (e) => {
    if (e.target.closest("a")) setMenu(false);
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") setMenu(false);
  });
  addEventListener("resize", () => {
    hangDoor();
    document.querySelectorAll(".rowwrap").forEach((w) => w._updateEdges?.());
  });
}

/**
 * @param {HTMLElement} root
 * @param {{
 *   api: { getClient: () => import('@supabase/supabase-js').SupabaseClient },
 *   data: typeof import('./data.js'),
 *   card: { open: Function },
 *   getLibrary: () => import('./data.js').LibraryState | null,
 *   setLibrary: (s: import('./data.js').LibraryState) => void,
 *   showToast: (msg: string) => void,
 *   router: { go: (r: string) => void },
 * }} ctx
 */
export async function mount(root, ctx) {
  let state = ctx.getLibrary();
  if (!state) {
    try {
      state = await ctx.data.loadLibrary(ctx.api.getClient());
      ctx.setLibrary(state);
    } catch (err) {
      state = {
        displayName: "",
        shelves: [],
        error: err instanceof Error ? err.message : "לא הצלחנו לטעון את הספרייה",
      };
      ctx.setLibrary(state);
      ctx.showToast?.(state.error);
    }
  }

  paint(root, ctx);

  if (root.dataset.libraryWired === "1") {
    return () => setMenu(false);
  }
  root.dataset.libraryWired = "1";
  wireChrome();
  setupDrag(root, ctx);

  root.addEventListener("click", (e) => {
    if (e.target.closest("#menu-open")) {
      hangDoor();
      setMenu(true);
      return;
    }
    if (e.target.closest("#add-shelf")) {
      void onAddShelf(root, ctx);
      return;
    }
    const plus = e.target.closest(".plus");
    if (plus) {
      const shelfId = plus.dataset.shelfId;
      if (shelfId) void addBook.open(shelfId, ctx);
      return;
    }
    const book = e.target.closest(".book:not(.plus)");
    if (book) {
      openBookFromEl(book, ctx);
      return;
    }
    const head = e.target.closest(".shelf-head");
    root.querySelectorAll(".shelf-head.tapped").forEach((x) => {
      if (x !== head) x.classList.remove("tapped");
    });
    if (head) head.classList.add("tapped");
    const ed = e.target.closest(".edit");
    if (ed) startRename(ed, root, ctx);
    const delBtn = e.target.closest(".shelf-delete");
    if (delBtn) void onDeleteShelf(delBtn, root, ctx);
  });

  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const book = e.target.closest?.(".book:not(.plus)");
    if (book) {
      e.preventDefault();
      openBookFromEl(book, ctx);
    }
  });

  return () => setMenu(false);
}

/**
 * @param {HTMLElement} root
 * @param {object} ctx
 */
function setupDrag(root, ctx) {
  const HOLD = 420;
  const SLOP = 10;
  const caseEl = root.querySelector("#case");
  if (!caseEl) return;

  let press = null;
  let drag = null;
  let swallowClick = false;
  let dragSnapshot = null;
  let dragFrom = null;

  const cancelPress = () => {
    if (!press) return;
    clearTimeout(press.timer);
    press.cue.classList.remove("pressing");
    press = null;
  };

  const pickUp = (x, y) => {
    const { el, kind, cue } = press;
    cue.classList.remove("pressing");
    press = null;
    const r = el.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    ghost.classList.add("ghost", kind === "book" ? "ghost-book" : "ghost-shelf");
    ghost.querySelectorAll(".pressing").forEach((n) => n.classList.remove("pressing"));
    Object.assign(ghost.style, {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    document.body.appendChild(ghost);
    el.classList.add("placeholder");
    dragFrom = {
      shelfId: el.closest(".shelf")?.dataset.shelfId,
      position:
        kind === "book"
          ? bookPositionInRow(el.parentElement, el)
          : shelfPositionInCase(caseEl, el),
    };
    dragSnapshot = cloneLibrary(ctx.getLibrary());
    drag = {
      el,
      kind,
      ghost,
      from: el.closest(".shelf"),
      dx: x - r.left,
      dy: y - r.top,
      x,
      y,
      ox: r.left,
      oy: r.top,
    };
    document.body.classList.add("dragging");
    if (navigator.vibrate) navigator.vibrate(12);
    requestAnimationFrame(tick);
  };

  const place = () => {
    if (!drag) return;
    const { el, kind, x, y } = drag;
    if (kind === "shelf") {
      const next = [...caseEl.querySelectorAll(":scope > .shelf")].find(
        (s) => s !== el && y < s.getBoundingClientRect().top + s.getBoundingClientRect().height / 2,
      );
      const before = next || caseEl.querySelector(".add-slot");
      if (el.nextElementSibling !== before) caseEl.insertBefore(el, before);
      return;
    }
    const under = document.elementFromPoint(x, y);
    const wrap = under?.closest(".rowwrap");
    if (!wrap || under?.closest(".edge")) return;
    const row = wrap.querySelector(".row");
    const target = under?.closest(".book");
    if (target === el) return;
    let before;
    if (target && !target.classList.contains("plus")) {
      const tr = target.getBoundingClientRect();
      before = x > tr.left + tr.width / 2 ? target : target.nextElementSibling;
    } else {
      before = row.querySelector(".plus");
    }
    if (before !== el && el.nextElementSibling !== before) row.insertBefore(el, before);
  };

  const moveGhost = () => {
    if (!drag) return;
    const { ghost, kind, x, y, dx, dy, ox, oy } = drag;
    ghost.style.transform =
      `translate(${x - dx - ox}px, ${y - dy - oy}px)` +
      (kind === "book" ? " rotate(-3deg) scale(1.06)" : "");
  };

  const tick = () => {
    if (!drag) return;
    const { kind, x, y } = drag;
    const edge = 70;
    moveGhost();
    if (y < edge) scrollBy(0, -(edge - y) / 5);
    else if (y > innerHeight - edge) scrollBy(0, (y - innerHeight + edge) / 5);
    if (kind === "book") {
      const under = document.elementFromPoint(x, y);
      const wrap = under?.closest(".rowwrap");
      if (wrap) {
        const row = wrap.querySelector(".row");
        const r = wrap.getBoundingClientRect();
        if (x < r.left + 56) row.scrollLeft -= 9;
        else if (x > r.right - 56) row.scrollLeft += 9;
      }
    }
    place();
    requestAnimationFrame(tick);
  };

  const recountShelf = (shelf) => {
    const span = shelf.querySelector(".shelf-head span");
    if (span) span.textContent = bookCountLabel(shelf.querySelectorAll(".book:not(.plus)").length);
  };

  const drop = async () => {
    if (!drag) return;
    const { el, ghost, kind, ox, oy } = drag;
    const r = el.getBoundingClientRect();
    ghost.style.transition = "transform .18s ease";
    ghost.style.transform = `translate(${r.left - ox}px, ${r.top - oy}px)`;
    setTimeout(() => {
      ghost.remove();
      el.classList.remove("placeholder");
    }, 180);
    document.body.classList.remove("dragging");
    swallowClick = true;
    setTimeout(() => {
      swallowClick = false;
    }, 350);

    const client = ctx.api.getClient();
    try {
      if (kind === "shelf") {
        const shelfId = el.dataset.shelfId;
        const toPosition = shelfPositionInCase(caseEl, el);
        if (shelfId && dragFrom && toPosition !== dragFrom.position) {
          ctx.setLibrary(applyOptimisticShelfMove(dragSnapshot, { shelfId, toPosition }));
          await moveShelf(client, shelfId, toPosition);
        }
      } else {
        const simaniaId = Number(el.dataset.simaniaId);
        const toShelfEl = el.closest(".shelf");
        const toShelfId = toShelfEl?.dataset.shelfId;
        const row = el.parentElement;
        const toPosition = bookPositionInRow(row, el);
        if (
          simaniaId &&
          dragFrom?.shelfId &&
          toShelfId &&
          (toShelfId !== dragFrom.shelfId || toPosition !== dragFrom.position)
        ) {
          ctx.setLibrary(
            applyOptimisticBookMove(dragSnapshot, {
              simaniaId,
              fromShelfId: dragFrom.shelfId,
              toShelfId,
              toPosition,
            }),
          );
          await moveBook(client, simaniaId, toShelfId, toPosition);
        }
        if (drag.from) recountShelf(drag.from);
        if (toShelfEl) recountShelf(toShelfEl);
      }
    } catch (err) {
      ctx.setLibrary(dragSnapshot);
      paint(root, ctx);
      ctx.showToast(err instanceof Error ? err.message : "לא הצלחנו לשמור");
    }
    drag = null;
    dragSnapshot = null;
    dragFrom = null;
    root.querySelectorAll(".row").forEach((row) => row.dispatchEvent(new Event("scroll")));
  };

  root.addEventListener("pointerdown", (e) => {
    if (e.button > 0 || drag || document.body.classList.contains("menu-open") || e.target.closest(".bk")) {
      return;
    }
    const book = e.target.closest(".book:not(.plus)");
    const head = !book && e.target.closest(".shelf-head");
    if (!book && !head) return;
    if (head && (e.target.closest(".edit") || e.target.closest(".shelf-delete") || e.target.isContentEditable)) {
      return;
    }
    const cue = book || head;
    cue.classList.add("pressing");
    press = {
      el: book || head.closest(".shelf"),
      kind: book ? "book" : "shelf",
      cue,
      x: e.clientX,
      y: e.clientY,
    };
    press.timer = setTimeout(() => {
      if (press) pickUp(press.x, press.y);
    }, HOLD);
  });

  addEventListener("pointermove", (e) => {
    if (drag) {
      drag.x = e.clientX;
      drag.y = e.clientY;
      moveGhost();
      place();
      return;
    }
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) cancelPress();
  });
  addEventListener("pointerup", () => {
    cancelPress();
    if (drag) void drop();
  });
  addEventListener("pointercancel", () => {
    cancelPress();
    if (drag) void drop();
  });
  document.addEventListener(
    "touchmove",
    (e) => {
      if (drag) e.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener("contextmenu", (e) => {
    if (press || drag) e.preventDefault();
  });
  document.addEventListener("dragstart", (e) => e.preventDefault());
  root.addEventListener(
    "click",
    (e) => {
      if (swallowClick) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );
}
