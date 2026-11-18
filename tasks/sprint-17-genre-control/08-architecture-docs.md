---
id: S17-T8
stage: 5
model_class: worker
timeout_minutes: 25
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
  - docs/architecture/matching.md
  - docs/architecture/frontend.md
  - docs/architecture/functions.md
context:
  - contract
  - architecture.data_model
  - architecture.matching
  - architecture.frontend
  - architecture.functions
environment: null
verification:
  - npm run check:contract
---

# Goal

The architecture docs describe S17 as it was built: genres from data, the reader's genre shelf choices, and the settings page.

# Scope

Describe only what the merged code does. Read the code (`supabase/functions/_shared/genres.ts`, `supabase/functions/recommendations/index.ts`, `supabase/migrations/20261119000100_genre_control.sql`, `public/js/library.js`, `public/js/genre-settings.js`), not only the contract. Where code and contract differ, write what the code does and say so in your final message.

1. `data-model.md`: `profiles.genre_shelf_count`, `genre_recommendations.genre_key`, `genre_preferences`, `reader_genres`, and the three new RPCs, in the style of the existing entries.
2. `matching.md`: replace the fixed 22-genre map description with the S17 rules (normalization, noise, aliases, compound tags, `en:` genres), the shelf plan (pins, hidden, N), the 200 cap, and reader genres. Keep it short; point to the contract for the full alias table.
3. `frontend.md`: the "הסתר מדף" button, the "נעוץ" label and note, and the `#genres` page in the screen list.
4. `functions.md`: one sentence on the `recommendations` run reading preferences and storing reader genres.

# Protected-path permission (operator decision, 2026-11-19)

`docs/architecture/**` is protected. Permitted: the edits in Scope 1-4 to those four files. Not permitted: any other file, or rewording unrelated sections. The reviewer must fail the task otherwise.

# Acceptance criteria

1. The four docs match the merged code; `check:contract` passes.
