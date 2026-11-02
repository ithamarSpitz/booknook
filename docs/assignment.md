# BookNook product brief

Owner: Itamar. This file records product decisions. Agents must not edit it.

## What it is

A private Hebrew book library with discovery recommendations, for about 10 invited users, at $0 running cost.

- A user keeps books on shelves that scroll sideways (RTL), like a real bookcase.
- The user gets recommendations based on taste and mood similarity, not "same author" or "next in series".
- Recommendations combine several of the user's books.

## Data sources (decided, tested live in Oct 2026)

- **Simania** official MCP (`https://simania.co.il/api/mcp`, no auth): the Hebrew catalog. Search, details, description, translator, cover, community rating. Non-commercial use allowed. Simania reviews and "readers also liked" are not used for recommendations. Simania's Cloudflare blocks Supabase server IPs but allows CORS, so the browser calls Simania directly.
- **Hardcover** GraphQL: canonical book identity and similarity (`cached_similar_book_ids`, `cached_tags` for genres and moods). Free, about 5,000 requests per day. The token is a server secret.
- **Wikidata** first, **NLI** as fallback: the bridge between a Hebrew title and the original title, both directions. NLI is slow and sometimes returns 502s.
- Rejected: Open Library, Google Books, LibraryThing, TasteDive, Big Book API, Qloo, LLM-generated recommendations, large dataset downloads.

## Product rules

1. One book = one work. The original and every translation are the same book. Several Hebrew translations may exist; the user sees one book, and a user cannot shelve two editions of the same work.
2. Hebrew first. If no Hebrew edition is found for a recommended book, it is shown in English. Shelves hold Simania books only, so an English-only recommendation can be dismissed but not shelved.
3. A book that is not on Hardcover can still be shelved. It is simply not used as a recommendation seed.
4. Users never create or fix catalog records. There is no admin review queue.
5. Title matching: deterministic normalization and fuzzy matching first. Only when that is ambiguous, an LLM fallback (not built yet, deferred).
6. Recommendation seeds are weighted by the reader's own rating: a book rated 3-5 on any shelf counts with its rating, an unrated book on "read" counts as 2.5 (internal only), and books rated 1-2 or other unrated books are not seeds. Books on any shelf are never recommended. Dismissed recommendations never return.
7. Ratings: the reader can rate any shelved book 1-5 from its card (tap again to clear). An unrated book that reaches "read" prompts "how was it?". Low ratings may later push similar books down (not built).
8. Explanations use only data Hardcover returned (shared tags) or the seed titles. Never invent a genre or mood.
9. The book card shows no links to external sites.

## Users and access

- Supabase Auth, email and password. Public sign-up off; users are invited.
- Every user's library is private.
- Every user can invite friends by email from the menu (הזמנת חברים), up to 10 invites a day. An invited user sets a password and a display name.
- Every change to a user's shelves is recorded in a history (`book_events`) for reading statistics later.

## UI

The approved design is `design/library.html` (the "Pine library"): light pine wood shelves, Netflix-style horizontal rows with a partly visible last cover, same-size covers, closet-door menu, book card popup, long-press drag to reorder books and shelves, a "+" tile at the end of each row to add a book, custom shelves that can be renamed.

Default shelves: קורא עכשיו, קראתי, רוצה לקרוא, הפסקתי.

Menu items: הספרייה שלי, המלצות בשבילי, חיפוש ספרים, סטטיסטיקות קריאה (hidden until built), הגדרות, הזמנת חברים.

Recommendations regenerate in the background after every shelf change; there is no refresh button. The app is installable on Android (service worker).

Hebrew UI is required. English UI is planned but not in this build.

## Out of scope for this build

LLM matching fallback, reading statistics page, English UI, buying links, social features beyond invites, imports.
