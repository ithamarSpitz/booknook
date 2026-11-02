---
id: S3-T1
stage: 1
model_class: worker
timeout_minutes: 25
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
  - >-
    node -e "const t=require('fs').readFileSync('public/css/base.css','utf8');if(t.includes('#3e2a17'))throw new Error('walnut plaque color #3e2a17 must be gone');if(!/\.shelf-head h2\{[^}]*#5a3714/.test(t))throw new Error('shelf name must use #5a3714');if(!/\.shelf-head h2\{[^}]*font-size:21px/.test(t))throw new Error('shelf name must be 21px');if(!/\.shelf-head span\{[^}]*font-size:16px[^}]*font-weight:700|\.shelf-head span\{[^}]*font-weight:700[^}]*font-size:16px/.test(t))throw new Error('count must be 16px bold');if(!/\.shelf-head h2\{font-size:19px;font-weight:700\}/.test(t))throw new Error('phone shelf name must be 19px bold');if(!/\.shelf-head span\{font-size:15px;font-weight:700\}/.test(t))throw new Error('phone count must be 15px bold');if(!t.includes('.shelf-head{right:12px;bottom:3px;padding:1px 11px 2px;gap:8px}'))throw new Error('phone label position')"
---

# Goal

Shelf labels look carved into the wood, like the menu (burger) button and the library title in the top bar, instead of a dark walnut plaque.

# Context

Only `public/css/base.css`. The shelf label markup (from `public/js/library.js`, do not change it) is:

```html
<div class="shelf-head"><h2>NAME</h2><button class="edit">...</button><span>COUNT</span></div>
```

It sits on the shelf board (`.board`, light pine `#f7e8c6` wood image). Today the "v2 overrides" block in `base.css` paints it as a dark plaque: the rules starting at the comment `/* dark walnut plaque inside the board's height ...` (`.shelf-head` with `background:#3e2a17`, `.shelf-head h2` with `color:#f6e8d0`, the `contenteditable`, `.edit` and `.shelf-head span` rules after it).

The look to copy, already in the same file:

- `.burger`: transparent background, color `#5a3714`, bold strokes.
- `.crown h1`: `font-weight:700; color:#5a3714; text-shadow:0 1px 0 rgba(255,255,255,.55)`. That light shadow under dark text is what makes it look carved into the wood.

# Scope

Change only the v2 override rules for the shelf label, exactly:

1. `.shelf-head`: no background (`transparent`), no `box-shadow`, no border radius. Keep `right:22px` and `gap:10px`; set `bottom:4px` and `padding:1px 14px 3px`, so the larger text below still fits inside the 34px board and the covers stay fully visible.
2. `.shelf-head h2`: `font-size:21px`, `font-weight:700`, `color:#5a3714`, `text-shadow:0 1px 0 rgba(255,255,255,.55)`. Keep the Assistant font.
3. `.shelf-head span` (book count, e.g. "ספר אחד"): `font-size:16px`, `font-weight:700`, `color:#5a3714`, same `text-shadow`. It must be as easy to read as the name: bold, same color, a little smaller.
4. `.edit` (rename pencil): `color:#5a3714`. Keep its show-on-hover/tap behavior.
5. `.shelf-head h2[contenteditable=true]` (renaming): `border-bottom:1.5px dashed rgba(90,55,20,.55)`, `caret-color:#5a3714`.
6. Replace the plaque comment with a short comment saying the label is carved into the board like the burger and title. Keep the existing note about the extra bottom padding (Hebrew has no ascenders).
7. Remove the color `#3e2a17` from the file (it is only used by the plaque).

Phones: the second `@media(max-width:560px)` block (the one with `.crown h1{font-size:22px...}` and `.board{...height:30px}`) has its own shelf label sizes. Today they are:

```css
    .shelf-head{right:12px;bottom:8px;padding:1px 11px 4px;gap:8px}
    .shelf-head h2{font-size:15px}
    .shelf-head span{font-size:11px}
```

Keep these three rules (do not delete them) and change them to exactly:

```css
    .shelf-head{right:12px;bottom:3px;padding:1px 11px 2px;gap:8px}
    .shelf-head h2{font-size:19px;font-weight:700}
    .shelf-head span{font-size:15px;font-weight:700}
```

so on phones the label is a little bigger, bold, and still inside the 30px board. The first `@media(max-width:560px)` block (`.shelf-head{right:12px;bottom:5px}`) stays unchanged.

# Target result (desktop, v2 overrides)

This is the exact target for desktop (sizes raised after the user's review):

```css
  /* label carved into the board like the burger and title.
     Hebrew has no ascenders, so the extra padding goes below the text to center it optically. */
  .shelf-head{right:22px;bottom:4px;padding:1px 14px 3px;gap:10px;background:transparent;border-radius:0;box-shadow:none}
  .shelf-head h2{font-size:21px;font-weight:700;color:#5a3714;text-shadow:0 1px 0 rgba(255,255,255,.55)}
  .shelf-head h2[contenteditable=true]{outline:none;border-bottom:1.5px dashed rgba(90,55,20,.55);caret-color:#5a3714}
  .edit{display:grid;place-items:center;width:24px;height:24px;margin:0 -6px;padding:0;border:0;background:none;color:#5a3714;cursor:pointer;opacity:0;transition:opacity .15s}
  .shelf-head span{font-size:16px;font-weight:700;color:#5a3714;text-shadow:0 1px 0 rgba(255,255,255,.55)}
```

Do not open the user's own browser. For a visual check use only a headless browser, or leave it to the reviewer.

# Out of scope

Any HTML or JS change. Any other element (covers, board, crown, burger, menu, cards). New colors other than the ones listed.

# Acceptance criteria

1. Shelf names on every shelf render bold 21px, dark brown `#5a3714`, with the light carved shadow, directly on the wood with no plaque behind them, on desktop; on phones bold 19px.
2. The book count is bold 16px (15px on phones) in the same color and clearly readable; the rename pencil matches (colors above), and renaming a custom shelf still works and shows the dashed underline.
3. The labels still sit inside the board (34px tall) and do not overflow above it or cover book covers, on desktop (34px board) and at phone width (30px board).
4. `npm run test:web` passes.
