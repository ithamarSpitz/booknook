---
id: S9-T3
stage: 1
model_class: worker
timeout_minutes: 25
review: true
allow_protected: false
depends_on: []
allowed_paths:
  - scripts/lib/simania-page.ts
  - tests/functions/simania-page.test.ts
context:
  - contract
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

Read the original (Latin) title of a translated book from its Simania book page HTML.

# Scope

Contract: "Operator scripts: catalog audit and link repair", **Original title from the Simania page**.

1. New `scripts/lib/simania-page.ts`:
   - `pageOriginalTitle(html: string): string | null` exactly as specified (JSON-LD `alternativeHeadline` first, else the `direction: ltr` element after the title in the escaped React payload; unescape, trim, cut a trailing ` + ...` companion title; null without Latin letters or with Hebrew letters).
   - `simaniaPageUrl(id: number): string` returning `https://simania.co.il/bookdetails.php?item_id=<id>`.
   - `fetchSimaniaPage(id, fetchImpl = fetch): Promise<string>`: GET with a browser-like `User-Agent`, 20 s timeout; a non-2xx status throws.
2. Parsing is pure; only `fetchSimaniaPage` touches the network.

# Tests (new `tests/functions/simania-page.test.ts`)

Use the real trimmed page fixtures in `tests/functions/fixtures/simania-page/` (read them with `Deno.readTextFile` relative to the test file; do not edit them):
- `905132.html` gives `Under the Dome` (ltr element)
- `1026572.html` gives `The Housemaid is Watching` (companion `+ The Housemaid's Wedding` cut)
- `1024649.html` gives `Margo's Got Money Troubles` (JSON-LD `alternativeHeadline`)
- `659042.html` (Hebrew original) gives `null`

Plus inline cases: leading and trailing spaces trimmed (` The Coworker` gives `The Coworker`); a typographic apostrophe kept (`An Ancient Witch’s Guide To Modern Dating`); a value with Hebrew letters gives null; `fetchSimaniaPage` with a fake fetch uses the right URL and header, and a non-2xx status throws.

# Acceptance criteria

1. The behavior above; all tests pass.
