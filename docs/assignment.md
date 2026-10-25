# BookNook product brief

Owner: Itamar. This file records product decisions. Agents must not edit it.

## What it is

A private Hebrew book library with discovery recommendations, for about 10 invited users, at $0 running cost.

- A user keeps books on shelves that scroll sideways (RTL), like a real bookcase.
- The user gets recommendations based on taste and mood similarity, not "same author" or "next in series".
- Recommendations combine several of the user's books.

## Data sources (decided, tested live in Oct 2026)

- **Simania** official MCP (`https://simania.co.il/api/mcp`, no auth): the Hebrew catalog. Search, details, description, translator, cover, community rating. Non-commercial use allowed. Simania reviews and "readers also liked" are not used for recommendations.
- **Hardcover** GraphQL: canonical book identity and similarity (`cached_similar_book_ids`, `cached_tags` for genres and moods). Free, about 5,000 requests per day. The token is a server secret.
- **Wikidata** first, **NLI** as fallback: the bridge between a Hebrew title and the original title, both directions. NLI is slow and sometimes returns 502s.
- Rejected: Open Library, Google Books, LibraryThing, TasteDive, Big Book API, Qloo, LLM-generated recommendations, large dataset downloads.

## Product rules

1. One book = one work. The original and every translation are the same book. Several Hebrew translations may exist; the user sees one book, and a user cannot shelve two editions of the same work.
2. Hebrew first. If no Hebrew edition is found for a recommended book, it is shown in English. Shelves hold Simania books only, so an English-only recommendation can be dismissed but not shelved.
3. A book that is not on Hardcover can still be shelved. It is simply not used as a recommendation seed.
4. Users never create or fix catalog records. There is no admin review queue.
5. Title matching: deterministic normalization and fuzzy matching first. Only when that is ambiguous, an LLM fallback (not built yet, deferred).
6. Recommendation seeds: books on "read" and "currently reading" shelves. Books on any shelf are never recommended. "Stopped" books are excluded and may later push similar books down. Dismissed recommendations never return.
7. Ratings are deferred. The column exists, nothing uses it yet.
8. Explanations use only data Hardcover returned (shared tags) or the seed titles. Never invent a genre or mood.
9. The book card shows no links to external sites.

## Users and access

- Supabase Auth, email and password. Public sign-up off; users are invited.
- Every user's library is private.

## UI

The approved design is `design/library.html` (the "Pine library"): light pine wood shelves, Netflix-style horizontal rows with a partly visible last cover, same-size covers, closet-door menu, book card popup, long-press drag to reorder books and shelves, a "+" tile at the end of each row to add a book, custom shelves that can be renamed.

Default shelves: קורא עכשיו, קראתי, רוצה לקרוא, הפסקתי.

Menu items: הספרייה שלי, המלצות בשבילי, חיפוש ספרים, סטטיסטיקות קריאה, הגדרות.

Hebrew UI is required. English UI is planned but not in this build.

## Out of scope for this build

LLM matching fallback, reading statistics page, English UI, ratings as a recommendation weight, buying links, social features, imports.
