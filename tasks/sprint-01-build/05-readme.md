---
id: S1-T5
stage: 1
model_class: worker
review_model_class: worker
timeout_minutes: 20
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - README.md
  - docs/setup.md
context:
  - assignment
  - architecture.overview
  - architecture.testing
environment: null
verification:
  - >-
    node -e "const t=require('fs').readFileSync('README.md','utf8');for(const w of ['harness status','supabase:start','functions:serve','web:serve','test:db','Simania','Hardcover','Wikidata'])if(!t.includes(w))throw new Error('README.md missing '+w);for(const w of ['Open Library','Google Books','LibraryThing'])if(t.includes(w))throw new Error('README.md mentions rejected source '+w)"
---

# Goal

Replace the README with an accurate one for the current architecture and the harness workflow.

# Scope

1. `README.md`: what Torimitor is, data sources and their roles, repository layout, local setup (Docker, `npm ci`, `npm run supabase:start`, `npm run functions:serve` and the `TORIMITOR_ENV_FILE` secrets file, `npm run web:serve`), test commands, and how the work is run with the harness (`python harness.py status`, `run`, `resume`, `failure`; point to `README-HARNESS.md`).
2. `docs/setup.md`: inviting a user locally (Supabase Studio or the admin API), resetting the database.

# Out of scope

Any code. Deployment (sprint S2).

# Acceptance criteria

1. No mention of Open Library, Google Books or LibraryThing.
2. Every command in the README exists in `package.json` or `harness.py`.
