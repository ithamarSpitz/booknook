---
id: S41-T3
stage: 3
model_class: worker
timeout_minutes: 30
review: true
depends_on:
  - S41-T2
allowed_paths:
  - supabase/functions/_shared/author-sound.ts
  - tests/functions/author-sound-lookup.test.ts
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

Contract: "**Author by sound (S41).**". Add `hebrewAuthorBySound(englishName, searchBooks)` to `supabase/functions/_shared/author-sound.ts`:
- `searchBooks(query, limit, offset)` has the same shape as `searchBooks` in `_shared/simania.ts`, and is injected.
- It returns `Promise<string | null>`.

# Reference implementation (validated 2026-11-21)

Keep the query plan, the cap, and the ranking:

```ts
export async function hebrewAuthorBySound(en: string, searchBooks: SearchBooks): Promise<string | null> {
  const et = enTokens(en);
  if (!et.length) return null;
  const lastS = surnameSpellings(et[et.length - 1], 6);
  const firstS = et.length > 1 ? hebrewSpellings(et[0], 4) : [];
  const plan: [string, number][] = [];
  // Full names first (precise), then each surname spelling alone (Simania matches prefixes).
  for (const f of firstS) for (const l of lastS.slice(0, 2)) plan.push([`${f} ${l}`, 0]);
  for (const l of lastS) plan.push([l, 0]);
  for (const l of lastS.slice(2)) if (firstS[0]) plan.push([`${firstS[0]} ${l}`, 0]);
  plan.push([lastS[0], 50]);
  // Simania treats ' and ׳ as different characters: send both.
  const queries = plan.slice(0, 20)
    .flatMap(([q, o]) => (q.includes("'") ? [[q, o], [q.replace(/'/g, "׳"), o]] : [[q, o]]) as [string, number][])
    .slice(0, 26);
  const counts = new Map<string, { n: number; score: number }>();
  const seen = new Set<number>();
  for (const [q, offset] of queries) {
    const list = await searchBooks(q, 50, offset); // a failure throws: never report "not found"
    for (const b of list) {
      const id = Number(b.id);
      if (!Number.isFinite(id) || seen.has(id)) continue;
      seen.add(id);
      const a = String(b.author ?? "").trim();
      if (!/[א-ת]/.test(a)) continue;
      // Whole comma-separated names too: splitting on " ו" ("and") alone would cut
      // surnames that start with ו (וולטון).
      const parts = new Set([...a.split(/\s*,\s*/), ...a.split(/\s*[,،]\s*|\s+ו(?=[א-ת])/)]);
      for (const part of parts) {
        const s = sameName(part, en);
        if (!s) continue;
        const k = variants(part)[0];
        const c = counts.get(k) ?? { n: 0, score: 0 };
        c.n++; c.score = Math.max(c.score, s); counts.set(k, c);
      }
    }
  }
  const ranked = [...counts].sort((x, y) => y[1].n - x[1].n || y[1].score - x[1].score);
  return ranked[0]?.[0] ?? null;
}
```

`SearchBooks` is a type for the injected function. Use the book id field that `_shared/simania.ts` search results actually carry.

# Tests

New `tests/functions/author-sound-lookup.test.ts`, with a stubbed `searchBooks` that records its queries:
1. Julia Walton: the results hold `ג'וליה וולטון` and `ג'וד וולטון` → `ג'וליה וולטון`.
2. Stephen King: `סטיבן קינג` on 3 books and `סטיפן קינג` on 1 → `סטיבן קינג`.
3. Veronica Roth: the only result is `בריאן רוט` → null.
4. A co-author field `ניל גיימן וטרי פראצ'ט` with Terry Pratchett → `טרי פראצ'ט`.
5. At most 26 queries. Every query with `'` is also sent with `׳`.
6. A throwing `searchBooks` makes the function throw.

Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
