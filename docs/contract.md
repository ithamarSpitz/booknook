# BookNook binding interface contract

This is the binding interface for sprint S1. SQL, JSON, and TypeScript names are identical unless a view-model table states otherwise. UUIDs are JSON strings and `timestamptz` values are ISO-8601 strings. All tables are in `public`.

## Shared values

| PostgreSQL / TypeScript type | Exact values |
|---|---|
| `shelf_kind` / `ShelfKind` | `reading`, `read`, `want`, `stopped`, `custom` |
| `resolve_status` / `ResolveStatus` | `pending`, `wikidata`, `nli`, `fuzzy`, `llm`, `not_found` |

`llm` is reserved and is never produced in this build. Simania display text is stored and returned unchanged; normalization is only for matching.

## Database rows

### `profiles`

| Column | SQL type | Null? | Default / constraint |
|---|---|---:|---|
| `id` | `uuid` | no | PK; references `auth.users(id)` on delete cascade |
| `display_name` | `text` | no | `''` |
| `locale` | `text` | no | `'he'` |
| `created_at` | `timestamptz` | no | `now()` |

RLS permits select and update only where `id = auth.uid()`. Clients have column-level update grants only for `display_name` and `locale`; no client insert/delete or update of other columns.

### `works`

| Column | SQL type | Null? | Default / constraint |
|---|---|---:|---|
| `id` | `uuid` | no | PK; `gen_random_uuid()` |
| `hardcover_id` | `integer` | yes | unique |
| `original_title` | `text` | no | none |
| `original_authors` | `text[]` | no | `'{}'` |
| `similar_ids` | `integer[]` | no | `'{}'`; Hardcover `cached_similar_book_ids` |
| `tags` | `jsonb` | no | `'{}'`; Hardcover cached tags |
| `hardcover_cover_url` | `text` | yes | none |
| `refreshed_at` | `timestamptz` | yes | none |

Authenticated clients may select; only service-role Edge Functions write.

`tags` uses `CachedTags`: a category-keyed object whose arrays contain objects with a non-empty string `tag`, for example `{"Genre":[{"tag":"fantasy"}],"Mood":[{"tag":"reflective"}]}`. These are retained provider tag names, not inferred labels. At ingestion, accept only array-valued categories and object entries with a non-blank string `tag`; discard malformed entries and use `{}` for absent/null/non-object caches. Preserve valid tag strings unchanged; other provider metadata may be retained but never affects matching. For recommendations, extract only `Genre` and `Mood` entries, in that category order and then provider array order. Compare tag strings exactly (case-sensitive, no trimming, translation or normalization), irrespective of category; deduplicate by exact string. `shared_tags` is the candidate's extracted list filtered to names present in the union of its contributing seeds' extracted lists, preserving candidate order. Missing categories contribute no names.

### `editions`

| Column | SQL type | Null? | Default / constraint |
|---|---|---:|---|
| `simania_id` | `integer` | no | PK |
| `work_id` | `uuid` | yes | references `works(id)`; indexed |
| `resolve_status` | `resolve_status` | no | `'pending'` |
| `resolved_at` | `timestamptz` | yes | none |
| `title` | `text` | no | none |
| `author` | `text` | yes | none |
| `translator` | `text` | yes | none |
| `publisher` | `text` | yes | none |
| `series` | `text` | yes | none |
| `category` | `text` | yes | none |
| `year` | `integer` | yes | none |
| `pages` | `integer` | yes | none |
| `description` | `text` | yes | none |
| `cover_url` | `text` | yes | none |
| `simania_rating` | `numeric(3,2)` | yes | none |
| `simania_rating_count` | `integer` | yes | none |
| `details_at` | `timestamptz` | yes | none |

Authenticated clients may select; only service-role Edge Functions write. Null `work_id` means unresolved or unavailable on Hardcover and never prevents shelving.

### `shelves`

| Column | SQL type | Null? | Default / constraint |
|---|---|---:|---|
| `id` | `uuid` | no | PK; `gen_random_uuid()` |
| `user_id` | `uuid` | no | references `auth.users(id)` on delete cascade |
| `name` | `text` | no | none |
| `kind` | `shelf_kind` | no | `'custom'` |
| `position` | `integer` | no | none |
| `created_at` | `timestamptz` | no | `now()` |

`(user_id, position)` is unique, deferrable, initially deferred. `(user_id, kind)` is unique where `kind <> 'custom'`. RLS permits operations only where `user_id = auth.uid()`; direct client inserts must use `custom`. Client grants allow select, insert, and update of `name` only (custom shelves only); revoke table-level UPDATE and DELETE. Direct position updates and direct deletion, including custom shelves, are forbidden; use `move_shelf` and `delete_shelf` through the protected write mechanism below. A custom-shelf insert trigger takes the same per-user profile lock as the RPCs, then assigns the current shelf count to `NEW.position`, overriding the supplied position so creation appends without gaps. A `BEFORE UPDATE` trigger rejects changes to `id`, `user_id`, or `kind` with `22023`, for custom and built-in shelves alike. A `BEFORE DELETE` trigger rejects non-custom deletion with `22023` while the owning `auth.users` row exists; deletion cascading from removal of that user is allowed. Together with atomic creation of the four built-ins, these protections and the partial unique index guarantee exactly one shelf of each non-custom kind for each existing user. A built-in cannot become custom or be transferred to another user.

### `shelf_books`

| Column | SQL type | Null? | Default / constraint |
|---|---|---:|---|
| `user_id` | `uuid` | no | references `auth.users(id)` on delete cascade; PK part 1 |
| `simania_id` | `integer` | no | references `editions`; PK part 2 |
| `shelf_id` | `uuid` | no | references `shelves` on delete cascade |
| `position` | `integer` | no | none |
| `added_at` | `timestamptz` | no | `now()` |
| `finished_at` | `timestamptz` | yes | none |
| `rating` | `smallint` | yes | check 1 through 5; currently unused |

`(shelf_id, position)` is unique, deferrable, initially deferred. A check/trigger guarantees the shelf belongs to `user_id`. RLS permits operations only where `user_id = auth.uid()`. Revoke table-level `INSERT`, `UPDATE`, and `DELETE` from clients; grant only `SELECT` plus `INSERT (user_id, simania_id, shelf_id)`. Consequently a client cannot supply `position`, `added_at`, `finished_at`, or `rating`. Every insert passes through the authoritative `BEFORE INSERT` append/duplicate trigger specified under `add-book`: it assigns `position`, overwrites `added_at` with `now()`, sets `finished_at` to `now()` exactly when the initial target shelf is `read` and otherwise to null, and sets `rating` to null. These assignments also override values supplied by a privileged caller. Updates and deletes use the protected RPC write mechanism below: identity (`user_id`, `simania_id`) and `added_at` are immutable, movement uses `move_book`, removal uses `remove_book`, and the reader's own 1-5 rating uses `set_rating`. The PK ensures one row per edition/user; `add-book` separately enforces one non-null work per user. A duplicate created by later resolution is tolerated, but is still excluded from recommendations by work.

### `recommendations`

| Column | SQL type | Null? | Default / constraint |
|---|---|---:|---|
| `user_id` | `uuid` | no | references `auth.users(id)` on delete cascade; PK part 1 |
| `work_id` | `uuid` | no | references `works`; PK part 2 |
| `simania_id` | `integer` | yes | references `editions`; null is English-only |
| `score` | `real` | no | none |
| `because` | `integer[]` | no | seed Simania IDs |
| `shared_tags` | `text[]` | no | `'{}'` |
| `dismissed` | `boolean` | no | `false` |
| `generated_at` | `timestamptz` | no | `now()` |

RLS permits select where `user_id = auth.uid()`. Revoke table-level `UPDATE` from clients and grant only `UPDATE (dismissed)` on their own rows; the service role performs all other writes. Dismissal is one-way: a `BEFORE UPDATE OF dismissed` trigger permits `false -> true`, `false -> false`, and `true -> true`, but rejects `true -> false` with `22023`, for clients and the service role alike. Dismissed works therefore remain stored and excluded permanently.

### `search_cache`

| Column | SQL type | Null? | Default / constraint |
|---|---|---:|---|
| `query_norm` | `text` | no | PK |
| `results` | `jsonb` | no | serialized `SimaniaBook[]` |
| `fetched_at` | `timestamptz` | no | `now()` |

RLS has no client policies; service role only. Entries are fresh for 24 hours.

## Trigger

`handle_new_user() returns trigger` runs after insert on `auth.users`. It creates a profile, taking a non-empty `raw_user_meta_data->>'display_name'` or else the email local part, with locale `he`. It creates exactly these zero-based shelves:

| Position | Name | Kind |
|---:|---|---|
| 0 | קורא עכשיו | `reading` |
| 1 | קראתי | `read` |
| 2 | רוצה לקרוא | `want` |
| 3 | הפסקתי | `stopped` |

It returns `new`. It is security-definer with a fixed safe search path; failure aborts user creation atomically.

## RPCs

The four library RPCs below are `security invoker`, use `auth.uid()`, are atomic, and return SQL `void` (JSON `null`). Positions are zero-based; out-of-range positions are rejected, not clamped. Ownership failures do not disclose another user's rows. Before reading positions or changing library rows, each RPC locks the caller's `profiles` row with `SELECT ... FOR UPDATE`. The insert trigger described under `add-book` takes this same per-user lock before duplicate checks and position allocation. Locks last until transaction end; use READ COMMITTED and read positions in a separate statement after obtaining the lock so a waiter sees the preceding commit.

**Protected writes with invoker RPCs.** RLS ownership policies do not themselves authorize direct writes: the table/column grants above also apply. Keep the four public RPCs security-invoker wrappers; each delegates to a corresponding security-definer helper in a private schema that is not exposed by PostgREST. Each helper has the same arguments and result as its wrapper and implements the entire corresponding operation below, including authentication, ownership checks, profile locking, bounds, renumbering, and timestamp rules. Use a fixed safe search path and schema-qualified relations. Revoke helper execution from PUBLIC and anon; grant authenticated only the schema USAGE and helper EXECUTE needed by the invoker wrappers. Even a direct SQL invocation of a helper must enforce every rule; accept no caller-supplied user ID, arbitrary SQL, or bypass flag. The helper's owner has the required table privileges; if it bypasses RLS, explicit `auth.uid()` predicates on every affected user row remain mandatory. Do not grant clients table UPDATE/DELETE merely to make invoker RPCs work, and do not rely on a client-settable session variable to authorize writes. This preserves caller ownership while preventing direct REST/SQL mutations from bypassing the RPC algorithms. Only account-deletion cascades may remove library rows without these algorithms.

**Position bounds.** Compute counts after acquiring the profile lock and validating ownership, before mutation. Reject null or out-of-range positions with `22023`; parameters are SQL integers. For a cross-shelf `move_book`, let `N` be the target's current book count: valid positions are `0..N` inclusive, and `N` appends (an empty target accepts only `0`). For a same-shelf move, let `M` be its count including the moved book: remove that book conceptually first, then insert at a final index in `0..M-1` inclusive; `M-1` appends after the remaining books, and `M` is invalid. For `move_shelf`, let `S` be the caller's shelf count including the moved shelf: valid final indices are `0..S-1` inclusive, after conceptual removal; `S` is invalid. A move to the existing index preserves order. Preserve the relative order of all other rows and finish with contiguous positions starting at zero. For example, a target with three books accepts cross-shelf index `3`, but a same-shelf move among three books accepts at most `2`; four shelves accept at most `3`.

| RPC | Typed arguments | Behavior |
|---|---|---|
| `move_book` | `p_simania_id integer`, `p_to_shelf uuid`, `p_to_position integer` | Requires caller-owned book and target shelf. Closes the source gap, opens the target slot, and leaves both shelves contiguous. Same-shelf moves are stable. Sets `finished_at = now()` only the first time the book reaches `read`; never clears/overwrites it. |
| `move_shelf` | `p_shelf_id uuid`, `p_to_position integer` | Moves a caller-owned shelf and makes that user's positions contiguous. |
| `delete_shelf` | `p_shelf_id uuid` | Custom only. Appends its books in existing order after the caller's last `want` book, deletes it, and closes the shelf gap. |
| `remove_book` | `p_simania_id integer` | Deletes the caller's row and closes its old shelf gap; catalog rows remain. |
| `set_rating` | `p_simania_id integer, p_rating smallint` | Sets the caller's 1-5 rating for a shelved book on any shelf; null clears it. Recommendations weight seeds by it: 3-5 on any shelf, 2.5 when unrated on `read` (internal only), otherwise not a seed. |

The TS interfaces `MoveBookArgs`, `MoveShelfArgs`, `DeleteShelfArgs`, and `RemoveBookArgs` use those exact parameter keys. Their corresponding result types are `MoveBookResult`, `MoveShelfResult`, `DeleteShelfResult`, and `RemoveBookResult`, each exactly `null`. Errors: unauthenticated `42501`; an absent row and a row not owned by the caller both produce `P0002` with the same message; invalid position or non-custom deletion `22023`; constraint conflict `23505`/`23514`. An RPC must apply the ownership predicate in its lookup and must not perform a separate existence check that could distinguish those two `P0002` cases.

```json
{"rpc":"move_book","args":{"p_simania_id":1234,"p_to_shelf":"7d94c068-7489-4aea-9e13-78c1113df4f7","p_to_position":0},"result":null}
```

### Service-only recommendation replacement

`replace_recommendations(p_user_id uuid, p_rows jsonb) returns setof public.recommendations` is a single transactional, security-invoker RPC called only by the recommendations Edge Function using its service client after JWT verification. Revoke execution from PUBLIC, anon and authenticated; grant only to service_role. `p_user_id` must be the verified caller's ID, never a request-body value. `p_rows` is an array of at most 20 `RecommendationReplacement` objects, each containing exactly `work_id`, nullable `simania_id`, finite `score`, `because` (integer array), and `shared_tags` (string array). Work IDs must be distinct; a non-null edition must belong to that work. Invalid payloads raise `22023`, missing user/catalog references `23503`; failure rolls back the entire operation.

First lock `public.profiles` for `p_user_id` with `SELECT ... FOR UPDATE`; a missing profile raises `23503`. This is the same per-user lock and the same lock order used by `add-book`: profile first, recommendations second. After obtaining it, acquire `LOCK TABLE public.recommendations IN SHARE ROW EXCLUSIVE MODE` before reading or writing recommendations. The profile lock serializes the final shelf recheck with additions; the table lock serializes replacement transactions and direct dismissals. Committed shelves and dismissals at lock acquisition are therefore observed.

Within this transaction, capture one `clock_timestamp()` value, re-read the user's shelved work IDs only after both locks are held, retain all dismissed rows, delete this user's non-dismissed rows, and insert the payload excluding any retained dismissed work and any work now on this user's shelves. Set `dismissed = false` and the captured `generated_at` on every inserted row. Return only inserted rows ordered by score descending, then joined `works.hardcover_id` ascending. Empty input clears non-dismissed rows and returns `[]`. Concurrent generations replace whole sets in lock order, never partial or mixed sets. The `add-book` insertion path deletes a matching non-dismissed recommendation while it holds the same profile lock, so either transaction order preserves the shelf-exclusion invariant: replacement after addition sees the shelf, and addition after replacement removes the row. The function maps returned rows to cards; it must not separately delete/upsert via REST or return the unfiltered payload. Locks are held only during this short database operation, never during provider requests.

Types: `ReplaceRecommendationsArgs` and `ReplaceRecommendationsResult` (`RecommendationRow[]`). Example: `{"rpc":"replace_recommendations","args":{"p_user_id":"7d94c068-7489-4aea-9e13-78c1113df4f7","p_rows":[]},"result":[]}`. This service-only RPC is intentionally absent from the browser's `RPCS` constants.

## Edge Functions

All accept `POST` JSON plus bearer JWT and return JSON with CORS headers; `OPTIONS` is preflight. Success is `200`. Errors are `{"error":"message"}`: malformed/invalid body `400`, missing/invalid JWT `401`, unsupported method `405`, unexpected/configuration failure `500`, and upstream failure `502`. Shared provider timeout is 12 seconds; Hardcover GraphQL uses 18 seconds. Secrets are never returned.

### Simania runs in the browser

Simania's Cloudflare answers `403` to Edge Function (data-center) IPs and allows CORS from any origin, so **no Edge Function calls Simania**; `public/js/simania.js` calls the MCP endpoint from the reader's browser. Search is browser-only: trim the query; under 2 characters returns `[]` without a call; otherwise call `books_search` once with `limit: 8, offset: 0` and keep the real `SimaniaBook` fields. A Simania failure is shown as an error in the search panel. `search_cache` is no longer written (the `search-books` function was removed).

Functions that need edition data take an optional `simania` field `{"details": <raw books_get_details object>, "rating": <raw books_get_rating object or null>}` that the browser fetched just before the call. The server trusts it (about 10 invited users) and maps it with the same field rules as before. Wherever this contract says "call Simania `books_get_details` and `books_get_rating`", read: use the supplied `simania` field; when it is absent, try Simania directly (works only off-cloud), and when that fails keep an existing cached row unchanged instead of failing.

### `add-book`

Request `AddBookRequest`: `{"simania_id":1234,"shelf_id":"7d94c068-7489-4aea-9e13-78c1113df4f7","simania":{"details":{"title":"ספר"},"rating":null}}` (the browser always sends `simania`). Response is `AddBookResponse`:

```json
{"book":{"simania_id":1234,"work_id":null,"resolve_status":"not_found","title":"ספר","author":null,"translator":null,"publisher":null,"series":null,"category":null,"year":null,"pages":null,"description":null,"cover_url":null,"simania_rating":null,"simania_rating_count":null,"shelf_id":"7d94c068-7489-4aea-9e13-78c1113df4f7","shelf_name":"רוצה לקרוא","shelf_kind":"want","position":3,"added_at":"2026-10-25T10:00:00Z","finished_at":null,"rating":null},"resolve_status":"not_found"}
```

Require caller-owned shelf. If edition is absent or `details_at` is at least 30 days old, call Simania `books_get_details` and `books_get_rating`, upsert every edition display/rating field, and set `details_at` now.

Resolve when `pending`, or `not_found` at least 14 days old, using the following bounded deterministic procedure. All similarities below are the normalized word-set Dice value: normalize with NFKD, strip U+0300--U+036F combining marks, lowercase, remove one leading English `the`, `a`, or `an`, replace non-letter/digit runs with one space, trim, then compute `2 * |intersection| / (|left set| + |right set|)`; an empty set scores zero. Equal-score ties retain provider order unless a numeric-ID tie-break is stated.

1. **Wikidata bridge.** Make one Hebrew `wbsearchentities` item search with `limit=8`, but inspect at most the first 6 results in provider order. Fetch each entity until one qualifies. Reject an entity whose P31 is film (`Q11424`), audio book (`Q24856`), television series (`Q5398426`), radio program (`Q277759`), television program (`Q7058673`), or video game (`Q7889`). Accept its type as a written work only when P31 includes book (`Q571`), novel (`Q8261`), literary work (`Q7725634`), written work (`Q47461344`), science-fiction book (`Q49084`), or short story (`Q25379`), or it has a P50 author claim. Use its English label, falling back to the search-result label; skip a blank title or a title whose normalized form equals the Hebrew input. Fetch only the first P50 author's English label. This bridge is at most 8 Wikidata requests: one search, six entity reads, and one author read.
2. **NLI fallback bridge.** If Wikidata yields no accepted Hardcover work, make one NLI SRU `title` search with `maximumRecords=25`. For each MARC record, form its Hebrew title from 245 subfields a/b/n/p, creators from 100 and 700 subfields a/d, and original-title candidates in source order from 240 a/n/p, 130 a/n/p, then 765 t. Clean an original candidate by removing a trailing `/ Hebrew`, `/ עברית`, punctuation, and whitespace; take the first non-empty candidate whose normalized value differs from that record's title. Keep only records with Hebrew-title Dice at least `0.78`. Rank by `Hebrew-title Dice * 3 + maximum creator Dice * 2` (the creator term is zero without an author hint), descending, and use the top record's original title and first creator.
3. **Hardcover match.** For each bridge result, make one Hardcover Book search with `per_page=8`, discard non-numeric IDs, fetch all returned books in one batch, and rank them by `title Dice * 3 + author boost + popularity`, descending, then Hardcover ID ascending. The author boost is exactly `2` when the hint is non-empty and any cached contributor name has Dice greater than `0.45`, otherwise `0`. Popularity is `log10(1 + max(users_read_count, 0)) / 20`. Accept only the first ranked book, and only when its title Dice is at least `0.50`.
4. **Direct fuzzy fallback.** If neither bridge produces an accepted work, perform exactly one more Hardcover match using the unchanged Simania title and author as the title and author hint. An acceptance by this direct path is the only path that produces `resolve_status = 'fuzzy'`.

An accepted Wikidata or NLI bridge stores that respective lowercase status; the direct path stores `fuzzy`. Upsert the accepted Hardcover record as the work and set `resolved_at` now. With no accepted result store null `work_id`, `not_found`, and current `resolved_at`. A complete attempt makes at most 15 provider requests (8 Wikidata, 1 NLI, and three two-request Hardcover matches). No LLM call is made. A bridge or resolution-provider failure (network error, timeout, or a non-2xx answer after one retry on 429/5xx) is treated as that path missing and never prevents shelving. If no path is accepted and any provider request failed, keep `pending` with null `resolved_at` instead of storing `not_found`, so a later request retries; `not_found` means every provider answered. Provider requests send a descriptive `User-Agent`.

Before insert, return `409` if the exact edition is already shelved, or if another shelved edition has the same non-null `work_id`. The authoritative duplicate check and append execute together in a `shelf_books` `BEFORE INSERT` trigger whose function is `SECURITY DEFINER` with a fixed safe `search_path`; execution is available only through the trigger, not granted as a client-callable function. First lock the user's `profiles` row with `SELECT ... FOR UPDATE`, using the same lock as the library RPCs and recommendation replacement. Then validate the owned target shelf against `auth.uid()`, lock the referenced `editions` row while reading its `work_id`, and check for the same edition or another edition of that non-null work on any of this user's shelves. Raise `23505` with constraint diagnostic `shelf_books_pkey` for the same edition, or `shelf_books_user_work_key` for the same work. Under the per-user lock, compute `max(position)+1` in the target shelf (0 if empty) and assign it to `NEW.position`, overriding any caller-supplied position. Thus two different books added concurrently both succeed in successive positions; two editions of one work serialize and one conflicts. On every insert, overwrite `added_at` with now, overwrite `finished_at` with now when the target shelf is `read` and with null otherwise, and overwrite `rating` with null; no supplied value survives. After validation, delete the caller's non-dismissed recommendation whose `work_id` equals the inserted edition's non-null `work_id`; this occurs in the same transaction and after the profile lock, so rollback restores the recommendation if insertion fails. Never delete dismissed rows. The trigger runs only on insertion; duplicates caused by later edition resolution remain tolerated. Map only those two named duplicate violations (or the equivalent precheck) to `409`; other `23505` errors are unexpected `500`, not duplicate-book conflicts. Unknown Simania ID or missing/non-owned shelf is `404`; required Simania detail failure is `502`.

### `book-details`

Request `BookDetailsRequest`: `{"simania_id":1234}`, optionally with `simania` as for `add-book`. A `BookDetailsResponse` example is:

```json
{"book":{"simania_id":1234,"work_id":null,"resolve_status":"pending","title":"ספר","author":null,"translator":null,"publisher":null,"series":null,"category":null,"year":null,"pages":null,"description":null,"cover_url":null,"simania_rating":null,"simania_rating_count":null,"shelf_id":null,"shelf_name":null,"shelf_kind":null,"position":null,"added_at":null,"finished_at":null,"rating":null}}
```

Perform the same 30-day detail/rating refresh. If the edition is still `pending` (an earlier resolution hit a provider failure), also run the resolution procedure above. Never shelve. Fill shelf fields for the caller if shelved, otherwise set them all null. Unknown ID is `404`; Simania failure is `502`.

### `recommendations`

Request `RecommendationsRequest` is `{}` (unknown fields ignored). Response `RecommendationsResponse`:

```json
{"recommendations":[{"work_id":"78e9c71d-d6f2-4ea4-bcbb-42e4ec9300cf","simania_id":null,"title":"Piranesi","author":"Susanna Clarke","cover_url":"https://...","score":1.75,"because":[1234,5678],"because_titles":["ספר א","ספר ב"],"shared_tags":["fantasy"],"dismissed":false,"generated_at":"2026-10-25T10:00:00Z","english_only":true,"can_add":false}]}
```

Seeds are books on `reading` and `read` with non-null work. Take at most 8: `reading` first in book position order, then `read` by `finished_at desc nulls last`, `added_at desc`, and Simania ID tie-break. Zero seeds calls `replace_recommendations` with an empty array and returns `{"recommendations":[]}` with status `200`.

For each seed inspect only its first 40 `similar_ids`. At zero-based rank `r`, add `1 - r/40` to candidate score. Sum across seeds and deduplicate contributing seed IDs. Sort score descending then Hardcover ID ascending. Exclude works of every caller book on every shelf, plus every dismissed work. Null-work shelf books cannot seed and exclude only that edition until resolved.

Fetch missing candidate IDs from Hardcover in batches of at most 50; discard IDs not returned by Hardcover and upsert the rest. Localize candidates in score/Hardcover-ID order. First reuse the linked edition having the lowest `simania_id`, if one exists. Otherwise use this bounded procedure (normalization and Dice are exactly as defined for `add-book`):

1. **Wikidata bridge.** Make one English `wbsearchentities` item search with `limit=10`. Score all returned results as `title Dice * 3 + author-description boost`, where the boost is exactly `2` only when the normalized non-empty author hint is a substring of the normalized search-result description. Sort descending, retaining provider order on a tie, and inspect at most the first 4. Fetch each entity, applying the same written-work/rejected-type filters listed for `add-book`; choose the first with a non-empty Hebrew label. Use the first P50 author's Hebrew label, falling back to its English label. This is at most 6 Wikidata requests: one search, four entity reads, and one author read.
2. **Simania match.** Search once for `"<Hebrew title> <Hebrew author>"` with `limit=6, offset=0`; only when that returns zero results, search the title alone once with the same limit. Do not combine the two result sets. Rank the at-most-6 results as `title Dice * 3 + author Dice * 2` when the bridge supplied an author, otherwise title only; retain provider order on a tie. Accept the top result only when its title Dice is at least `0.45`.
3. **NLI fallback.** If the Wikidata bridge is absent or its Simania search is not accepted, make exactly three NLI SRU searches in this order: `uniform_title`, `title`, `all_for_ui`, each with `maximumRecords=25`. Parse fields as in the `add-book` NLI rule and deduplicate records by normalized title plus normalized first creator, keeping the first. Keep only records with at least one Hebrew character in the title. For each, `original score` is the maximum Dice between the Hardcover title and its cleaned 240/130/765 originals; `author score` is the maximum creator Dice, or zero without an author hint. Keep original scores at least `0.72`, rank by `original score * 4 + author score * 2` descending while retaining discovery order on a tie, and use the top record's title and first creator for the Simania match in step 2.

**Step 2 runs in the browser.** The function performs steps 1 and 3 only as far as finding a Hebrew title: the Wikidata Hebrew label and author, or, only when Wikidata yields none, the top NLI record. It returns that as the card's `hebrew_hint` `{"source":"wikidata"|"nli","title":"...","author":"..."|null}` and the card stays English-only. The browser (`localizeRecommendations` in `public/js/recs.js`, at most 3 cards at a time) runs step 2 against Simania, fetches the accepted result's details and rating, and calls `link-edition`; a miss or any failure leaves the card English-only. Thus a candidate without a cached edition makes at most 9 server bridge requests (6 Wikidata, 3 NLI) and the browser at most 2 Simania searches plus 2 detail reads; the original bound below describes the combined procedure: at most 13 bridge/localization requests (6 Wikidata, two Simania, three NLI, two Simania). Run at most 5 candidate localizations concurrently, begin no more than the first 40 candidates, and stop scheduling when 20 cards have been accepted or retained as English-only. Every attempted candidate yields a card: if localization is not accepted it uses the English-only fallback, so the ordinary result reaches `min(20, candidate count, 40)` cards. Provider request loops may not exceed these bounds.

**Linking a localized edition** is done by `link-edition` (below), not by this function, after the browser's step 2 accepts a Simania result. Fetch its Simania details and rating when the `editions` row is absent or its `details_at` is at least 30 days old; insert or update all edition display/rating columns and set `details_at` to now. If the row's `work_id` is null (regardless of its current `resolve_status`), set `work_id` to the candidate work, `resolve_status` to `wikidata` or `nli` according to the bridge that supplied the accepted Hebrew title, and `resolved_at` to now. If it already links to that candidate work, retain the link; if it links to a different work, treat this candidate as a localization miss (English-only) and never relink the edition. A required detail-fetch failure for a new row is also a miss. Only after this succeeds may the `simania_id` be written to the caller's recommendation row, which guarantees every non-null recommendation `simania_id` references an edition belonging to its `work_id`. The `recommendations` function itself only sends a non-null `simania_id` to `replace_recommendations` for an edition already linked to the work.

Localization misses remain English-only: null Simania ID, title/authors/cover from the work, dismiss allowed, add-to-shelf forbidden. Localized cards use edition display data. `shared_tags` includes only actual candidate Hardcover tags also present on a contributing seed. `because_titles` looks up exact edition titles in `because` order; explanations never invent tags. Call `replace_recommendations` once with the completed candidates to preserve dismissed rows and atomically replace only non-dismissed rows, using one generation timestamp; build the response from its returned rows. Hardcover failure is `502`; individual bridge failure counts as a localization miss.

### `link-edition`

Request `LinkEditionRequest`: `{"work_id":"78e9c71d-d6f2-4ea4-bcbb-42e4ec9300cf","simania_id":1234,"source":"wikidata","simania":{"details":{"title":"ספר"},"rating":null}}`. Response `LinkEditionResponse`: `{"work_id":"78e9c71d-...","simania_id":1234,"title":"ספר","author":null,"cover_url":null}`; the browser applies it to the card, which becomes `english_only: false, can_add: true`.

`source` must be `wikidata` or `nli` and `simania` is required (`400` otherwise). The caller must have a non-dismissed recommendation row for `work_id` (`404` otherwise). Store the edition from `simania` with the 30-day rule, then apply the linking rules above: claim the row only while `work_id` is null (conditional update), keep an existing link to the same work with its metadata, and answer `409` when the edition is linked to a different work (never relink). On success set the caller's recommendation `simania_id` with the service client.

## View models

### `BookCard`

No external-site URL is included.

| Field | Type | Exact source |
|---|---|---|
| `simania_id` | `number` | `editions.simania_id` |
| `work_id` | `string \| null` | `editions.work_id` |
| `resolve_status` | `ResolveStatus` | `editions.resolve_status` |
| `title` | `string` | `editions.title` |
| `author` | `string \| null` | `editions.author` |
| `translator` | `string \| null` | `editions.translator` |
| `publisher` | `string \| null` | `editions.publisher` |
| `series` | `string \| null` | `editions.series` |
| `category` | `string \| null` | `editions.category` |
| `year` | `number \| null` | `editions.year` |
| `pages` | `number \| null` | `editions.pages` |
| `description` | `string \| null` | `editions.description` |
| `cover_url` | `string \| null` | `editions.cover_url` |
| `simania_rating` | `number \| null` | numeric `editions.simania_rating` serialized as number |
| `simania_rating_count` | `number \| null` | `editions.simania_rating_count` |
| `shelf_id` | `string \| null` | caller's `shelf_books.shelf_id`, else null |
| `shelf_name` | `string \| null` | joined `shelves.name`, else null |
| `shelf_kind` | `ShelfKind \| null` | joined `shelves.kind`, else null |
| `position` | `number \| null` | caller's `shelf_books.position`, else null |
| `added_at` | `string \| null` | caller's `shelf_books.added_at`, else null |
| `finished_at` | `string \| null` | caller's `shelf_books.finished_at`, else null |
| `rating` | `number \| null` | caller's `shelf_books.rating`, else null; unused by scoring |

### `RecommendationCard`

| Field | Type | Exact source / computation |
|---|---|---|
| `work_id` | `string` | `recommendations.work_id` |
| `simania_id` | `number \| null` | `recommendations.simania_id` |
| `title` | `string` | edition title; English-only `works.original_title` |
| `author` | `string \| null` | edition author; English-only authors joined with `, `, null if empty |
| `cover_url` | `string \| null` | edition cover; English-only `works.hardcover_cover_url` |
| `score` | `number` | `recommendations.score` |
| `because` | `number[]` | `recommendations.because` |
| `because_titles` | `string[]` | exact edition title for each `because` ID, same order |
| `shared_tags` | `string[]` | `recommendations.shared_tags` |
| `dismissed` | `boolean` | `recommendations.dismissed` |
| `generated_at` | `string` | `recommendations.generated_at` |
| `english_only` | `boolean` | `simania_id === null` |
| `can_add` | `boolean` | `simania_id !== null` |
| `hebrew_hint` | `HebrewHint \| null` | English-only cards only: the bridge's Hebrew title for the browser's Simania match; not stored |

## Web modules and ownership

Each native screen module exports `mount(root, ctx)`, with an `HTMLElement` root and `{ api, data, router, card }`. It renders inside root, installs only its listeners, and may return cleanup; the router calls cleanup before another route. Pure ordering/mapping/debounce helpers are named exports with no DOM access at import.

Routes are exactly `#library`, `#recs`, `#search`, `#settings`, `#login`. Empty/unknown authenticated routes redirect to library; unauthenticated routes redirect to login. `public/js/contract.js` owns `SHELF_KINDS`, function names, routes, and RPC names/parameter names.

| Lane | Exclusive files after shell creation |
|---|---|
| S1-T4 shell/library/card | `index.html`, `css/base.css`, shared CSS stubs, `assets/**`, `js/config.js`, `api.js`, `data.js`, `router.js`, `library.js`, `card.js`, `main.js`; creates later JS stubs only |
| S1-T6 login/settings | `js/auth.js`, `settings.js`, `css/auth.css`, `settings.css` |
| S1-T7 recommendations | `js/recs.js`, `css/recs.css` |
| S1-T8 add/search | `js/add-book.js`, `css/add-book.css` |
| S1-T9 first-run/PWA | `js/first-run.js`, `css/first-run.css`, `manifest.webmanifest`, `icons/**` |

Feature lanes do not edit shared routing, data access, `index.html`, or other lanes' files. UI is RTL Hebrew, supports keyboard/touch, has loading/error states, rolls back failed optimistic writes, and respects reduced motion.
