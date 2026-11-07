# Reference probes (read-only, not production code)

Working scratch probes from 2026-11-07 that produced the numbers in `docs/contract.md`, "Catalog fallback for English-only books". Read them to see how the queries and matching work in practice, including NLI SRU query strings, MARC field parsing, the Wikidata calls and the Simania search shapes. Then implement what the contract says.

- `nli-match.probe.ts`: rules A-F and the Simania check. Run with `deno run --allow-net --allow-env --allow-read nli-match.probe.ts <rows.jsonl>`.
- `names.probe.ts`: rule G (character names). It has one known bug that the contract fixes: it did not drop the author's own name words from `english_names`, so it counted "Ted" and "Lethem" as hits.
- `probe-results.jsonl`: the output for the 61 English-only books of both readers.

Differences from the contract win. Never import these files from production code or tests.
