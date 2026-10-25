import { SHELF_KINDS } from "./contract.js";

/**
 * @param {Array<{ books?: unknown[] }>} shelves
 * @returns {boolean}
 */
export function shouldShow(shelves) {
  if (!Array.isArray(shelves)) return false;
  return !shelves.some((s) => (s.books?.length ?? 0) > 0);
}

const PROMPT =
  "כדי להתחיל, הוסף ספר שאהבת במדף «קראתי» — לחץ על ";

/** @param {HTMLElement} root @param {object} _ctx */
export function mount(root, _ctx) {
  if (!root.querySelector(".first-run__text")) {
    root.innerHTML = `<p class="first-run__text">${PROMPT}<span class="first-run__plus" aria-hidden="true">+</span></p>`;
    if (!root.dataset.wired) {
      root.dataset.wired = "1";
      window.addEventListener("resize", () => placeNearReadPlus(root), { passive: true });
    }
  }
  placeNearReadPlus(root);
}

/**
 * Physical center of the plus tile inside `main`'s border box.
 * Use with physical `left`/`top` (not logical inset-inline-*) so RTL
 * does not mirror the prompt away from the tile.
 * @param {{ left: number, top: number, width: number, height: number }} plusRect
 * @param {{ left: number, top: number }} mainRect
 */
export function plusCenterOffset(plusRect, mainRect) {
  return {
    top: plusRect.top - mainRect.top + plusRect.height * 0.5,
    left: plusRect.left - mainRect.left + plusRect.width * 0.5,
  };
}

/** @param {HTMLElement} root */
function placeNearReadPlus(root) {
  const plus = document.querySelector(`.shelf[data-kind="${SHELF_KINDS.READ}"] .plus`);
  const main = root.closest("main");
  if (!plus || !main) return;
  const { top, left } = plusCenterOffset(plus.getBoundingClientRect(), main.getBoundingClientRect());
  root.style.setProperty("--first-run-top", `${top}px`);
  root.style.setProperty("--first-run-left", `${left}px`);
}
