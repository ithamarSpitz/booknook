---
id: S43-T2
stage: 2
model_class: worker
timeout_minutes: 40
review: true
depends_on:
  - S43-T1
allowed_paths:
  - scripts/rematch-cached.ts
  - supabase/functions/_shared/catalog.ts
  - tests/functions/rematch-cached.test.ts
  - tests/functions/rematch-failure-detail.test.ts
context:
  - contract
  - architecture.matching
  - architecture.testing
environment: null
verification:
  - npm run check:functions
  - npm run test:functions
---

# Goal

Implement **Provider failure detail (S43)** from `docs/contract.md`.

Today, every `catch` in `scripts/rematch-cached.ts` that sets `anyFailed = true`, and every `failures.count += 1` in `resolveMatch` (`supabase/functions/_shared/catalog.ts`), drops the error. That leaves 124 works failing every night with no way to know why.

Keep `failures.count` as it is. Also record each failure as `{ provider, error }`, for example:

```ts
} catch (error) {
  failures.count += 1;
  failures.details?.push({ provider: "wikidata", error: String((error as Error)?.message ?? error).slice(0, 200) });
}
```

Then the `provider_failure` skip line becomes:

```json
{"hardcover_id":434661,"title":"The Painted Veil","skipped":"provider_failure","failures":[{"provider":"wikidata","error":"429 Too Many Requests"}]}
```

Pick the provider name from what the `try` block calls. Use the contract list.

# Acceptance criteria

1. A new test, `tests/functions/rematch-failure-detail.test.ts`, uses fake providers. One fake throws `new Error("boom")` from the Wikidata lookup. The test asserts that the skip line has `failures: [{ provider: "wikidata", error: "boom" }]`.
2. Existing tests still pass, and skip lines for other reasons are unchanged.
3. Both verification commands pass.
