import { SHELF_KINDS } from "./contract.js?v=02bfe78";

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

/**
 * Keeps a bubble of `width` centered as close to `left` as fits inside
 * `containerWidth` (8px margin), and returns where its arrow must sit so it
 * still points at `left`. On phones the plus tile is at the screen edge.
 * @param {number} left @param {number} width @param {number} containerWidth
 */
export function clampBubble(left, width, containerWidth) {
  const margin = 8;
  const min = width / 2 + margin;
  const max = containerWidth - width / 2 - margin;
  const center = max < min ? containerWidth / 2 : Math.min(Math.max(left, min), max);
  const arrow = Math.min(Math.max(left - (center - width / 2), 14), width - 14);
  return { center, arrow };
}

/** @param {HTMLElement} root */
function placeNearReadPlus(root) {
  const plus = document.querySelector(`.shelf[data-kind="${SHELF_KINDS.READ}"] .plus`);
  const main = root.closest("main");
  if (!plus || !main) return;
  const { top, left } = plusCenterOffset(plus.getBoundingClientRect(), main.getBoundingClientRect());
  const { center, arrow } = clampBubble(left, root.offsetWidth, main.clientWidth);
  root.style.setProperty("--first-run-top", `${top}px`);
  root.style.setProperty("--first-run-left", `${center}px`);
  root.style.setProperty("--first-run-arrow", `${arrow}px`);
}
