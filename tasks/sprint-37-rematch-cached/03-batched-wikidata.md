---
id: S37-T3
stage: 2
model_class: worker
timeout_minutes: 30
review: true
depends_on:
  - S37-T1
allowed_paths:
  - supabase/functions/_shared/bridges.ts
  - tests/functions/wikidata-batch.test.ts
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

Contract: "**Batched Wikidata lookups (S37).**". Two helpers answer many names or titles per Wikidata request, for operator jobs. The Edge Functions don't use them yet.

# Scope

Add to `supabase/functions/_shared/bridges.ts`, using the existing `providerFetch` and `PROVIDER_HEADERS`:

1. `export async function wikidataHebrewAuthors(names: string[]): Promise<Map<string, string[]>>`
   - Trim the names, drop empty ones and duplicates, and split them into chunks of at most 100.
   - Per chunk, send one POST to `https://query.wikidata.org/sparql` with body `query=<SPARQL>` (form-encoded) and header `accept: application/sparql-results+json`. The query:
     ```
     SELECT ?name ?he WHERE {
       VALUES ?name { "<n1>"@en "<n2>"@en ... }
       ?item rdfs:label|skos:altLabel ?name .
       ?item wdt:P31 wd:Q5 .
       ?item rdfs:label ?he FILTER(lang(?he) = "he")
     }
     ```
     Escape `\` and `"` inside each literal.
   - The map key is the trimmed input name. The values are the distinct `he` labels, in result order. A name with no row is absent from the map.
2. `export async function wikidataOriginals(hebrewTitles: string[]): Promise<Map<string, string[]>>`
   - The same chunking and request. The query:
     ```
     SELECT ?he ?type ?en WHERE {
       VALUES ?he { "<t1>"@he ... }
       ?x rdfs:label ?he .
       OPTIONAL { ?x wdt:P629 ?w }
       BIND(COALESCE(?w, ?x) AS ?item)
       OPTIONAL { ?item wdt:P31 ?type }
       OPTIONAL { ?item rdfs:label ?en FILTER(lang(?en) = "en") }
     }
     ```
     Measured on 2026-11-21, putting the type filter inside the query timed out on Wikidata's side. So filter in code instead.
   - Keep a row only when `en` is set and the last path part of `type` is in the existing `WORK_TYPES`.
   - The map key is the trimmed input title, and the values are the distinct `en` labels.
3. Both helpers throw `ProviderError` when the response isn't OK (after `providerFetch`'s retry) or its body isn't valid JSON. Measured: Wikidata answered "upstream request timeout" as plain text. They never return a partial map for a failed chunk.

Change nothing else in the file.

# Tests

New `tests/functions/wikidata-batch.test.ts`, with a fetch stub and no network:
1. `wikidataHebrewAuthors(["Wally Lamb", "Wally Lamb", " ", "Rudyard \"X\" Kipling"])` sends one request. Its decoded query contains `"Wally Lamb"@en` once and the escaped `"Rudyard \"X\" Kipling"@en`. A stub answer with two `he` labels for Wally Lamb gives `Map { "Wally Lamb" => [both] }`.
2. 250 names send 3 requests of 100, 100 and 50 names.
3. `wikidataOriginals(["נדודי שינה", "עשב"])`: the stub returns `Insomnia` with type `http://www.wikidata.org/entity/Q7725634`, and an `en` label with a non-work type (Q5) for `עשב`. The result is `Map { "נדודי שינה" => ["Insomnia"] }`.
4. A 504 stub response (twice) throws `ProviderError`. A 200 plain-text body `upstream request timeout` also throws `ProviderError`.

Existing tests pass.

# Acceptance criteria

1. The behavior above; both verification commands pass.
