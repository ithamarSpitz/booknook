/**
 * One recommendations refresh per signed-in app open, and another after a long background hide.
 * Pure logic — no DOM; wired from main.js.
 */
export function createOpenRefresh({
  request,
  now = () => Date.now(),
  minHiddenMs = 30 * 60 * 1000,
}) {
  let openRefreshDone = false;
  let signedInEver = false;
  /** @type {number | null} */
  let hiddenAt = null;
  let visibleHandled = true;

  function signedIn() {
    signedInEver = true;
    if (openRefreshDone) return;
    openRefreshDone = true;
    request();
  }

  /** @param {boolean} visible */
  function visibility(visible) {
    if (!visible) {
      hiddenAt = now();
      visibleHandled = false;
      return;
    }
    if (!signedInEver || visibleHandled || hiddenAt === null) return;
    const elapsed = now() - hiddenAt;
    hiddenAt = null;
    visibleHandled = true;
    if (elapsed < minHiddenMs) return;
    request();
  }

  return { signedIn, visibility };
}
