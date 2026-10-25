import { notifyShelvesChanged } from "./events.js?v=b90e49c";
import { applyOptimisticRating, cloneLibrary, setRating } from "./data.js?v=b90e49c";
import { SHELF_KINDS } from "./contract.js?v=b90e49c";

/**
 * Five tappable stars for the reader's own 1-5 rating. Tapping the current
 * rating again clears it. Rows are RTL, so star 1 sits on the right.
 * @param {HTMLElement} host
 * @param {number|null} value
 * @param {(rating: number|null) => void} onPick
 */
export function renderStars(host, value, onPick) {
  host.replaceChildren();
  host.setAttribute("role", "radiogroup");
  host.setAttribute("aria-label", "הדירוג שלי");
  for (let n = 1; n <= 5; n++) {
    const star = document.createElement("button");
    star.type = "button";
    star.className = "my-star";
    star.textContent = "★";
    star.setAttribute("role", "radio");
    star.setAttribute("aria-checked", String(value === n));
    star.setAttribute("aria-label", n === 1 ? "כוכב אחד" : `${n} כוכבים`);
    star.classList.toggle("on", value != null && n <= value);
    star.addEventListener("click", (e) => {
      e.stopPropagation();
      onPick(value === n ? null : n);
    });
    host.append(star);
  }
}

/**
 * Save a rating: the library updates at once, the server after; on failure the
 * library goes back and a toast explains. Recommendations refresh in the background.
 * @param {{
 *   api: { getClient: () => any },
 *   getLibrary?: () => any,
 *   setLibrary?: (s: any) => void,
 *   showToast: (msg: string) => void,
 * }} deps
 * @param {number} simaniaId
 * @param {number|null} rating
 * @returns {Promise<boolean>}
 */
export async function saveRating(deps, simaniaId, rating) {
  const state = deps.getLibrary?.();
  const snapshot = state ? cloneLibrary(state) : null;
  if (state && deps.setLibrary) deps.setLibrary(applyOptimisticRating(state, simaniaId, rating));
  try {
    await setRating(deps.api.getClient(), simaniaId, rating);
    notifyShelvesChanged();
    return true;
  } catch (err) {
    if (snapshot && deps.setLibrary) deps.setLibrary(snapshot);
    deps.showToast(err instanceof Error ? err.message : "לא הצלחנו לשמור את הדירוג");
    return false;
  }
}

/** True when a book just landed on "read" and the reader has not rated it yet. */
export function shouldPromptRating(shelfKind, rating) {
  return shelfKind === SHELF_KINDS.READ && rating == null;
}

let promptEl = null;

/**
 * "How was it?" sheet shown once a book reaches "read" without a rating.
 * @param {Parameters<typeof saveRating>[0]} deps
 * @param {{ simania_id: number, title: string }} book
 */
export function promptRating(deps, book) {
  promptEl?.remove();
  const sheet = document.createElement("div");
  sheet.className = "rate-prompt";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-labelledby", "rate-prompt-title");
  sheet.innerHTML = `
    <div class="rate-card">
      <p class="rate-kicker">סיימתם לקרוא</p>
      <h2 id="rate-prompt-title" dir="auto"></h2>
      <p class="rate-q">איך היה?</p>
      <div class="rate-stars"></div>
      <button type="button" class="rate-later">אחר כך</button>
    </div>`;
  const titleEl = sheet.querySelector("h2");
  if (titleEl) titleEl.textContent = book.title;
  const close = () => {
    sheet.classList.remove("on");
    setTimeout(() => sheet.remove(), 200);
    if (promptEl === sheet) promptEl = null;
  };
  const stars = sheet.querySelector(".rate-stars");
  if (stars instanceof HTMLElement) {
    renderStars(stars, null, (rating) => {
      if (rating == null) return;
      renderStars(stars, rating, () => {});
      void saveRating(deps, book.simania_id, rating).then(async (ok) => {
        if (ok) {
          await deps.onRated?.();
          setTimeout(close, 350);
        }
      });
    });
  }
  sheet.querySelector(".rate-later")?.addEventListener("click", close);
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet) close();
  });
  document.body.append(sheet);
  promptEl = sheet;
  requestAnimationFrame(() => sheet.classList.add("on"));
}
