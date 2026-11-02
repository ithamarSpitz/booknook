---
id: S2-T1
stage: 1
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - supabase/config.toml
  - docs/deploy.md
  - scripts/deploy.ps1
  - public/js/config.js
context:
  - assignment
  - architecture.overview
environment: null
verification:
  - npm run check:functions
  - >-
    node -e "const t=require('fs').readFileSync('supabase/config.toml','utf8');const a=(t.split(/^\[auth\]\s*$/m)[1]||'').split(/^\[/m)[0];if(!/^enable_signup\s*=\s*false/m.test(a))throw new Error('sign-up must be disabled')"
---

# Goal

Prepare everything for deploying to a Supabase cloud project and Cloudflare Pages, so the remaining steps are a short manual checklist.

# Scope

1. `supabase/config.toml`: disable public sign-up, set `site_url` and redirect URLs for local and a placeholder production origin, keep `verify_jwt` on for all functions.
2. `public/js/config.js`: choose local or production settings by `location.hostname`; production URL and anon key read from a clearly marked block the operator fills in. The anon key is public by design; the service-role key never appears.
3. `scripts/deploy.ps1`: `supabase link`, `supabase db push`, `supabase functions deploy` for each function, `supabase secrets set HARDCOVER_API_KEY` from the secrets file. Stops on the first error. Does not run on its own; the operator runs it.
4. `docs/deploy.md`: the manual checklist: create the Supabase project, run the script, invite users, create the Cloudflare Pages project with `public/` as the output directory, update `site_url`, and a note that the free Supabase project pauses after a week without activity.

# Out of scope

Actually deploying. Creating accounts. Any change to application behavior.

# Acceptance criteria

1. Local development still works with the new config (verification passes).
2. Someone following `docs/deploy.md` needs no other instructions.
