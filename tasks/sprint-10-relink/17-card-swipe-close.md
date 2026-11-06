---
id: S10-T17
stage: 2
model_class: worker
timeout_minutes: 35
review: true
allow_protected: false
depends_on:
  - S10-T11
allowed_paths:
  - public/js/card.js
  - public/css/base.css
  - tests/web/card.test.mjs
context:
  - contract
  - architecture.frontend
  - architecture.testing
environment: null
verification:
  - npm run test:web
---

# Goal

On a phone, a reader can close the book card by pulling it down from its top, like a native bottom sheet.

# Scope

Contract: "Web modules and ownership", **Swipe to close the book card (phone only)**.

1. `public/js/card.js`: add touch handlers on `.bk-card`.
   - Active only while the overlay is open, `matchMedia("(max-width: 640px)")` matches, and the input is touch. Use touch events, or pointer events with `pointerType === "touch"`. A mouse never triggers it.
   - The gesture may start only when `.bk-card.scrollTop <= 0` at touch start.
   - Engage after the finger has moved down at least 8px, and more vertically than horizontally. Until then, do nothing, so taps on the shelf `select`, the stars and buttons work exactly as now.
   - Once engaged, call `preventDefault` on `touchmove` (register it non-passive) so the page does not rubber-band. Set `.bk-card`'s `transform: translateY(<dy>px)` with no transition while dragging. Upward moves clamp to 0.
   - On release, close when `dy >= 90`, or when the speed is at least 0.5 px/ms and `dy >= 30`. Use the existing `close()`, so every listener on the overlay's `on` class, such as the recommendation chrome restore, still runs. Otherwise animate back to 0.
   - Clear the inline transform afterwards, so the next open uses the stylesheet's opening transition unchanged.
   - Do not break the existing open/close transition, `Escape`, the `×` button or a backdrop tap.
2. `public/css/base.css`: add only what the drag needs inside the existing `@media(max-width:640px)` block, for example `touch-action: pan-y` and `overscroll-behavior: contain` on the card, and a short spring-back transition. With `prefers-reduced-motion: reduce`, the spring-back has no transition.

# Tests (`tests/web/card.test.mjs`, fake DOM and touch events)

1. At phone width, scrolled to the top: a 120px downward drag closes the card (the `on` class is removed).
2. A 40px slow drag springs back, and the card stays open.
3. A 40px fast flick closes.
4. Starting with `scrollTop > 0` does nothing, even after a long drag.
5. At desktop width (`matchMedia` false), the same drag does nothing.
6. A mostly horizontal move does nothing. A tap on the select does not engage.

# Acceptance criteria

1. The behavior above; all tests pass.
2. The UI check at 390px width shows the sheet following the finger and closing. At desktop width there is no change.
