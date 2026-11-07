---
id: S13-T4
stage: 2
model_class: worker
timeout_minutes: 20
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - public/css/base.css
context:
  - architecture.frontend
environment: null
verification:
  - npm run test:web
---

# Goal

On the library shelves, the rating stars above each book are a little bigger and sit closer together, with more space at their sides, and the books on a shelf are a little further apart.

# Scope

Only `public/css/base.css`. No markup, JS or test changes.

1. `.tile-stars` (line ~71): stop spreading the stars across the full width of the cover (`justify-content: space-between`). Center them as a group instead, with a small gap of about 2px between stars. The space left at both sides grows as a result. Keep `direction: rtl`, the absolute position above the cover, the colors and `pointer-events: none`.
2. `.tile-stars` and `.tile-stars svg`: make the stars bigger, 11px → 14px. Adjust `height` to match, and move `top` up just enough (about -21px) that the stars don't touch the cover. Check there is still room above the stars: in the mobile block (`@media(max-width:560px)`, `.row{padding-top:24px}`) and on desktop (`.row` top padding, line ~18). If they would be clipped, raise that `padding-top` by the same 3px.
3. Gap between books on the shelves, the `.rowwrap` `--gap` values in base.css: desktop shelves 12px → 16px (line ~64), phones 8px → 11px (line ~99). Don't touch `public/css/recs.css`.
4. The five stars must still fit on the narrowest cover. On phones, a cover is about (360px - margins) / 3.5 ≈ 90px wide, and 5 × 14px + 4 × 2px = 78px fits.

# Acceptance criteria

1. The CSS changes above; `npm run test:web` passes.
