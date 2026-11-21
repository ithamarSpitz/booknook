---
id: S40-T1
stage: 1
model_class: worker
timeout_minutes: 15
review: true
allow_protected: true
depends_on: []
allowed_paths:
  - docs/contract.md
context:
  - contract
environment: null
verification:
  - npm run check:contract
  - >-
    node -e "if(!require('fs').readFileSync('docs/contract.md','utf8').includes('**Rematch author agreement (S40).**'))throw new Error('missing')"
---

# Goal

`docs/contract.md` gets one general rule next to the S39 rules, **Rematch author agreement (S40).**, with no book-specific constants.

A `rematch:cached` proposal also needs the Hebrew edition's author to agree with the work's authors. For some spelling variant `v` of the edition author, either:
- `nameSoundScore(v, original_authors) >= 0.7`, or
- `similarity(v, h) >= 0.6` for an authors-table Hebrew name `h` of one of the work's authors.

The variants are:
- the name with every `(...)` group removed;
- the name with every `word (alt)` replaced by `alt`.

This holds in normal runs and in `--from` mode. A failure is skipped as `author_mismatch` and never linked.

Measured on 2026-11-21, from the first 238 works of the S37 dry run (53 proposals):
- **Spare** (Prince Harry) was proposed with Simania 774691 `Wikipedia` by Dan O'Sullivan. Wikidata's Hebrew label for Spare is `wikipedia`, so the forward hint found that book, and `resolveMatch` confirmed it through the same Wikidata item.
- This rule passes 50 of the 53 and rejects Spare. The other 2 rejections are correct books (Stefan Zweig, Thomas Hardy), so they are misses, not wrong links.

Change nothing else.

# Acceptance criteria

1. Both verification commands pass.
