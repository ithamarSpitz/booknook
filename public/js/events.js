/**
 * Fired on `document` whenever what is on the shelves changes: a book added,
 * moved to another shelf (e.g. to "stopped"), removed, or a shelf deleted.
 * Recommendations depend on all of these.
 */
export const SHELVES_CHANGED = "booknook:shelves-changed";

export function notifyShelvesChanged() {
  if (typeof document !== "undefined") document.dispatchEvent(new CustomEvent(SHELVES_CHANGED));
}

export const RECS_INPUTS_CHANGED = "booknook:recs-inputs-changed";

export function notifyRecsInputsChanged() {
  if (typeof document !== "undefined") document.dispatchEvent(new CustomEvent(RECS_INPUTS_CHANGED));
}
