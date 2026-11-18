---
id: S17-T8
stage: 5
model_class: worker
timeout_minutes: 30
review: true
allow_protected: true
depends_on:
  - S17-T2
  - S17-T3
  - S17-T4
  - S17-T5
  - S17-T6
  - S17-T7
allowed_paths:
  - docs/architecture/data-model.md
  - docs/architecture/functions.md
  - docs/architecture/frontend.md
  - docs/architecture/overview.md
context:
  - contract
  - architecture.overview
  - architecture.data_model
  - architecture.functions
  - architecture.frontend
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "const r=f=>require('fs').readFileSync('docs/architecture/'+f,'utf8');const need={'data-model.md':['## genre_recommendations','genre_key','## genre_preferences','## reader_genres','genre_shelf_count','set_genre_preference','set_genre_shelf_count','replace_reader_genres'],'functions.md':['genre_preferences','reader_genres','en:'],'frontend.md':['#genres','הסתר מדף','נעוץ'],'overview.md':['genre_recommendations','genre_preferences','reader_genres']};for(const[f,ws]of Object.entries(need))for(const w of ws)if(!r(f).includes(w))throw new Error(f+' missing '+w)"
---

# Goal

The architecture docs describe the genre shelves as they are built after S17: genres from the Hardcover data, the reader's genre shelf choices, and the settings page.

# Scope

Describe only what the merged code does. Read the code, not only the contract:
- `supabase/functions/_shared/genres.ts`
- `supabase/functions/recommendations/index.ts`
- `supabase/migrations/20261119000100_genre_control.sql`
- `public/js/data.js`, `public/js/library.js`, `public/js/genre-settings.js`

Where code and contract differ, write what the code does and say so in your final message.

Today the architecture docs barely describe the genre shelves, so several entries are new (not replacements). Keep each one short and in the style of its file, and point to the contract for detail such as the full alias table.

1. `data-model.md`:
   - A new `## genre_recommendations` section (it is missing today), after `## recommendations`, including `genre_key` and `shelf_position` 0-19.
   - New `## genre_preferences` and `## reader_genres` sections after `## dismissed_works`.
   - `genre_shelf_count` in `## profiles`.
   - `set_genre_preference`, `set_genre_shelf_count`, `replace_genre_recommendations` and `replace_reader_genres` in "Functions and triggers".
2. `functions.md`, in `## recommendations`, a short "Genre shelves" part after the numbered behavior:
   - genres come from tags (normalization, noise, aliases, compound tags, `en:` keys with English names);
   - the shelf plan (hidden never, pinned first with at most N − 1 and books from all seeds, automatic genres need 4 books, N from `profiles.genre_shelf_count`);
   - the 200 new-work cap; storing `reader_genres`;
   - failures there are logged and ignored.
3. `frontend.md`, under `## Screens`:
   - in **Library**, the genre shelves below the reader's shelves, with "הסתר מדף", the "נעוץ" label and the few-books note;
   - a new **Recommendation shelf settings** (`#genres`) entry after **Removed books**.
4. `overview.md`, in "Who writes what": rows for `genre_recommendations` and `reader_genres` (the `recommendations` function), and `genre_preferences` (the user, only through `set_genre_preference`); in the `profiles` row, `genre_shelf_count` only through `set_genre_shelf_count`.

# Protected-path permission (operator decision, 2026-11-19)

`docs/architecture/**` is protected. Permitted: the edits in Scope 1-4 to those four files. Not permitted: any other file, or rewording unrelated sections. The reviewer must fail the task otherwise.

# Acceptance criteria

1. The four docs match the merged code; `check:contract` and the verification command pass.
