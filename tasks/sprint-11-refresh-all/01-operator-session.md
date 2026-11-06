---
id: S11-T1
stage: 1
model_class: worker
timeout_minutes: 30
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - scripts/lib/operator-session.ts
  - tests/functions/operator-session.test.ts
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

Operator scripts can act as each reader through the deployed Edge Functions, using only the Supabase CLI login on this machine, and never expose a secret.

# Scope

Contract: "Operator scripts", **`npm run refresh:all`** (Credentials, Acting as a reader). New `scripts/lib/operator-session.ts`, with every dependency injectable for tests:

1. `projectKeys(run?)`: runs `npx supabase projects api-keys --project-ref zheosjpootcwvuazwjzh -o json` (default `run` uses `Deno.Command`; on Windows run it through `cmd /c` as needed) and returns `{ url, anonKey, serviceKey }`. The URL is fixed. A missing key or a failed command throws an `Error` whose message names the step and **never contains key material or the command's raw output**.
2. `listReaders(keys, fetchImpl?)`: users from the Auth admin API (`GET {url}/auth/v1/admin/users`, service key), returned as `{ id, email }`, sorted by email.
3. `readerToken(keys, email, fetchImpl?)`:
   - `POST {url}/auth/v1/admin/generate_link` with `{ type: "magiclink", email }` (service key). This sends no email. Read `hashed_token` (top level or under `properties`).
   - Then `POST {url}/auth/v1/verify` with `{ type: "magiclink", token_hash }` (anon key) and return `access_token`.
   - Errors name the step, never a token.
4. `callAs(keys, token, name, body, fetchImpl?)`: `POST {url}/functions/v1/{name}` with `Authorization: Bearer <token>`, `apikey: <anonKey>` and JSON. It returns the parsed JSON, or throws an `Error` carrying `status` (no token in the message).
5. Nothing in this module logs.

Use plain `fetch` against the documented Auth REST endpoints rather than adding a dependency. If the Supabase JS client is already imported elsewhere in `scripts/` or `tests/` in a Deno-compatible way, it is fine to use it instead; report which.

# Tests (new `tests/functions/operator-session.test.ts`, fakes only)

1. `projectKeys` parses CLI JSON shaped like `[{"name":"anon","api_key":"A"},{"name":"service_role","api_key":"S"}]`. When the service key is missing, it throws a message without `A`.
2. `readerToken` sends the right two requests, with the right keys on each, and returns the token. A failed verify throws without the hashed token or keys in the message.
3. `callAs` sets both headers. A non-2xx response throws with `status`.
4. No test calls the network or the real CLI.

# Acceptance criteria

1. The behavior above; all tests pass.
