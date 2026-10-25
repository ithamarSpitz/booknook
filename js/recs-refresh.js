import { FUNCTIONS } from "./contract.js?v=fe20a65";
import { localizeRecommendations, recommendationFromApiCard } from "./recs.js?v=fe20a65";

/**
 * Regenerates recommendations in the background: the recommendations function
 * stores the new list, then the browser localizes English-only cards
 * (link-edition updates the stored rows). The recommendations screen shows the
 * stored list meanwhile and reloads it when `busy` turns false.
 * Requests made while a run is in progress restart it once it reaches a safe
 * point, so a burst of adds costs one extra run, not one per book.
 * @param {{
 *   callFunction: (name: string, body: Record<string, unknown>) => Promise<unknown>,
 *   delayMs?: number,
 *   localize?: typeof localizeRecommendations,
 * }} deps
 */
export function createRecsRefresher(deps) {
  const delayMs = deps.delayMs ?? 1500;
  const localize = deps.localize ?? localizeRecommendations;
  /** @type {Set<(busy: boolean) => void>} */
  const listeners = new Set();
  let timer = null;
  let running = false;
  let again = false;

  const busy = () => running || timer !== null;
  const emit = () => {
    for (const fn of listeners) fn(busy());
  };

  async function run() {
    timer = null;
    running = true;
    try {
      do {
        again = false;
        const res = await deps.callFunction(FUNCTIONS.RECOMMENDATIONS, {});
        if (again) continue;
        const cards = res && typeof res === "object" && Array.isArray(res.recommendations)
          ? res.recommendations.map(recommendationFromApiCard)
          : [];
        await localize(cards, {
          callFunction: deps.callFunction,
          isCurrent: () => !again,
          onLinked: () => {},
        });
      } while (again);
    } catch (err) {
      console.warn("Background recommendations refresh failed:", err);
    } finally {
      running = false;
      emit();
    }
  }

  return {
    /** Schedules a refresh (debounced); restarts a running one. */
    request() {
      if (running) {
        again = true;
        return;
      }
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => void run(), delayMs);
      emit();
    },
    busy,
    /** @param {(busy: boolean) => void} fn @returns {() => void} unsubscribe */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
