---
id: S17-T1
stage: 1
model_class: worker
timeout_minutes: 20
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
    node -e "const t=require('fs').readFileSync('docs/contract.md','utf8');for(const w of ['Genre keys and names (S17)','genre_preferences','reader_genres','genre_shelf_count','set_genre_preference','set_genre_shelf_count','replace_reader_genres','Recommendation shelf settings page (#genres, S17)','Hiding a genre shelf (browser, S17)'])if(!t.includes(w))throw new Error('missing '+w)"
---

# Goal

`docs/contract.md` describes S17: genres come from the Hardcover data instead of a fixed list of 22, and the reader controls which genre shelves appear and how many (up to 20).

# Protected-path permission (operator decision, 2026-11-19)

`docs/contract.md` is a protected path. This task may change it, and only as listed here.

Permitted:
- The edits A-G below, using the given text word for word (fix only Markdown table alignment).

Not permitted:
- Any other change to `docs/contract.md`: other sections, wording, or whitespace outside the edited places.
- Any other file.

The reviewer must fail the task if the diff changes anything outside A-G.

# Edits

## A. `profiles` table

Add this row to the end of the `profiles` column table:

| `genre_shelf_count` | `smallint` | no | `10`; check `genre_shelf_count between 1 and 20` (S17) |

After the table's RLS paragraph, add: `genre_shelf_count` gets no client update grant; it changes only through `set_genre_shelf_count`.

## B. `genre_recommendations` table

1. Replace the `genre` row with these two rows:

| `genre_key` | `text` | no | genre key (see "Genre keys and names (S17)"); the migration fills existing rows with their `genre` value |
| `genre` | `text` | no | the genre's display name |

2. Replace the `shelf_position` row's constraint with `0-19, shelf order`.

## C. New tables, after the `dismissed_works` section (before `search_cache`)

### `genre_preferences`

The reader's choices for genre shelves (S17). A genre with no row is automatic.

| Column | SQL type | Null? | Default / constraint |
|---|---|---:|---|
| `user_id` | `uuid` | no | references `auth.users(id)` on delete cascade; PK part 1 |
| `genre_key` | `text` | no | PK part 2; non-empty |
| `label` | `text` | no | display name when the choice was made; non-empty |
| `state` | `text` | no | check `state in ('pinned','hidden')` |
| `pin_order` | `integer` | yes | not null exactly when `state = 'pinned'` |
| `updated_at` | `timestamptz` | no | `now()` |

RLS: a user may only `SELECT` own rows. Clients get no write grants; writes go only through `set_genre_preference`.

### `reader_genres`

The genres the latest `recommendations` run found for this reader (S17), listed by the shelf settings page.

| Column | SQL type | Null? | Default / constraint |
|---|---|---:|---|
| `user_id` | `uuid` | no | references `auth.users(id)` on delete cascade; PK part 1 |
| `genre_key` | `text` | no | PK part 2 |
| `label` | `text` | no | display name |
| `seed_count` | `integer` | no | check `>= 0` |
| `candidate_count` | `integer` | no | check `>= 0` |
| `position` | `smallint` | no | 0-99 |
| `generated_at` | `timestamptz` | no | `now()` |

RLS: a user may only `SELECT` own rows; clients get no write grants. Writes go only through `replace_reader_genres`.

## D. RPCs

Add to the `## RPCs` section, after the `dismiss_work` / `restore_work` entries:

- `set_genre_preference(p_genre_key text, p_label text, p_state text) returns void` (S17): security definer, caller = `auth.uid()`, execute granted only to `authenticated`. `p_state` not in `auto`, `pinned`, `hidden`, or a blank `p_genre_key` or `p_label`, raises `22023`. `auto` deletes the caller's row for that key. `hidden` upserts the row with `pin_order` null. `pinned` upserts it; a genre that is already pinned keeps its `pin_order`, otherwise `pin_order` = the caller's current highest `pin_order` + 1 (0 when none). Pinning a 20th genre (19 already pinned) raises `22023`. Every write sets `label` and `updated_at`.
- `set_genre_shelf_count(p_count integer) returns void` (S17): security definer, caller = `auth.uid()`, execute granted only to `authenticated`. Outside 1-20 raises `22023`. Sets the caller's `profiles.genre_shelf_count`.

Change the "Service-only genre recommendation replacement" section:
1. Each `p_rows` item also requires a non-empty string `genre_key` (an unknown or missing key in the object still raises `22023`, as for the other fields).
2. At most 240 rows (was 60); `shelf_position` 0-19 (was 0-4); at most 12 rows per `genre_key` (the per-genre count is now by `genre_key`).

Add after it:

### Service-only reader genre replacement

`replace_reader_genres(p_user_id uuid, p_rows jsonb) returns void` (S17): transactional, security-invoker, execute granted only to service_role. `p_rows` is an array of at most 100 objects with exactly `genre_key` (non-empty string), `label` (non-empty string), `seed_count` and `candidate_count` (integers `>= 0`), `position` (integer 0-99, unique). A bad payload raises `22023` and changes nothing; an unknown profile raises `23503`. Deletes all of that user's `reader_genres` rows and inserts the new ones with one shared `generated_at`.

## E. Genre shelves

In "### Genre recommendation shelves":

1. Replace step 1 ("**Genre map**" with its list and the "A work's genres are..." line) with:

1. **Genre keys and names (S17).** Genres come from the work's Hardcover `Genre` tags (its first 12; was 8). There is no fixed list of shelves. In `supabase/functions/_shared/genres.ts`:
   - **Normalize** each tag: remove every `"`, `[`, `]` and `\`, replace `-` and `_` with a space, collapse spaces, trim, lower-case. Skip empty results.
   - **Noise** (never a genre): the exact normalized tags `general`, `fiction`, `genre fiction`, `novel`, `novels`, `adult`, `adult fiction`, `literary collections`, `authors`, `audiobook`, `audiobooks`, `ebook`, `ebooks`, `english fiction`, `american fiction`, `british fiction`, `english`, `spanish`, `hebrew`, `french`, `german`, `book club`, `did not finish`, `dnf`, `owned`, `kindle`; and any normalized tag that contains `tbr`, `to read`, `favorite`, `favourite` or `read in`, or that is only digits.
   - **Groups.** A fixed alias table maps known normalized tags to a Hebrew genre name. The Hebrew name is that genre's key and its display name. The table (aliases in normalized form):
     `מדע בדיוני`: science fiction, sci fi, space, aliens, cyberpunk, space opera, hard science fiction · `פנטזיה`: fantasy, epic fantasy, high fantasy, urban fantasy, dark fantasy · `דיסטופיה`: dystopian, dystopia, post apocalyptic, apocalyptic · `מותחנים`: thriller, thrillers, thriller & suspense, suspense, psychological thriller, domestic thriller, legal thriller, espionage, spy · `מתח ובלש`: mystery, crime, murder, detective, mystery & detective, mystery thriller, mystery/thriller, detective and mystery stories, police, police procedural, cozy mystery, crime fiction, noir · `רומנטיקה`: romance, contemporary romance, historical romance · `ספרות יפה`: literary fiction, literary, literature & fiction, literature · `קלאסיקות`: classics · `רומן היסטורי`: historical fiction, historical · `אימה`: horror · `הרפתקאות`: adventure, action & adventure, action · `נוער`: young adult, young adult fiction, teen & young adult, teen, ya · `ריאליזם מאגי`: magical realism · `מלחמה`: war, military fiction · `היסטוריה`: history · `ביוגרפיה וממואר`: biography, biography & autobiography, memoir, autobiography · `קומיקס`: comics, graphic novels, comics & graphic novels · `הומור`: humor, humour, comedy · `עיון`: nonfiction, non fiction · `פילוסופיה`: philosophy · `פסיכולוגיה`: psychology · `מדע`: science, popular science · `ילדים`: children, childrens, juvenile fiction, juvenile nonfiction, middle grade, children's stories, children's literature, picture books · `שירה`: poetry · `סיפורים קצרים`: short stories, short story collections, anthologies · `פוליטיקה`: politics, political science · `מסעות`: travel · `דת ורוחניות`: religion, spirituality, christianity, judaism · `התבגרות`: coming of age · `על-טבעי`: paranormal, supernatural, ghosts, vampires · `מסע בזמן`: time travel · `קומדיה רומנטית`: romantic comedy, rom com · `סאטירה`: satire · `להט"ב`: lgbtq, lgbt, queer, lgbtqia+, lgbtq+ · `ספרות עכשווית`: contemporary, contemporary fiction, realistic fiction · `ספרות נשים`: women's fiction, women · `משפחה`: family, family life, family & relationships · `חברות`: friendship · `ספרות פסיכולוגית`: psychological · `דרמה`: drama · `ספרות ספקולטיבית`: speculative fiction · `פשע אמיתי`: true crime · `מיתולוגיה`: mythology · `אגדות`: fairy tales · `מסות`: essays · `ביקורת ספרות`: literary criticism · `עסקים וכלכלה`: business, economics · `עזרה עצמית`: self help · `פמיניזם`: feminism · `מערבונים`: western, westerns · `סטימפאנק`: steampunk · `LitRPG`: litrpg, gamelit.
   - **Compound tags.** A normalized tag that is not an alias and contains ` & ` or `/` is split on those; when every trimmed part is an alias, the tag gives each part's genre (for example `science fiction & fantasy` gives `מדע בדיוני` and `פנטזיה`). Otherwise the whole tag is handled as below.
   - **Other tags** (not noise, not an alias): the genre key is `en:` + the normalized tag, and its display name is the tag with only the quote/bracket/backslash removal and trimming applied, from the first genre seed (in seed order) whose work carries it, else from the first loaded candidate work that carries it (lowest `hardcover_id`).
   - A work's genres are the distinct keys its tags give, in tag order.
   - Existing rows: Hebrew keys equal the old Hebrew shelf names, so old `genre_recommendations` rows keep matching.

2. In step 3 ("**Qualifying genres.**"), replace "For each Hebrew genre:" with "For each genre key:", replace "then Hebrew name" with "then display name (Hebrew collation)", and replace the clause "take at most the first 5 that end up with at least 4 books (step 4); fewer is fine, zero means no genre shelves." with "these are the **automatic** genres. Step 3a decides which genres become shelves."

3. Insert after step 3:

3a. **Shelf plan (S17).** Read the caller's `profiles.genre_shelf_count` (N, default 10) and `genre_preferences`.
   - Hidden genres never get a shelf.
   - **Pinned** genres come first, by `pin_order`, at most N − 1 of them (so at least one slot stays automatic). A pinned genre is a shelf even when it does not qualify. Its candidates come from **all** genre seeds (not only the seeds that have the genre), filtered to works with that genre, scored as in step 4. It keeps any number of books from 1 to 12; with 0 books it gets no rows.
   - Then the **automatic** genres (step 3 order), skipping hidden and pinned ones; each needs at least 4 books (step 4), and a genre with fewer is dropped so the next one may take its place. Stop when there are N shelves in total.
   - Shelf positions follow this order, from 0.

4. In step 4 ("**Books per genre.**"), replace "at most 100 new works per run in total across all genres" with "at most 200 new works per run in total across all planned genres", and replace "a genre with fewer than 4 is dropped (the next qualifying genre may take its place)" with "the minimum is in step 3a".

5. Insert after step 6 ("**Failure.**"):

7. **Reader genres (S17).** In the same run, after the shelves, compute every genre key found on the works of the genre seeds or on the loaded candidate works (the first 40 `similar_ids` of every genre seed that are in `works`). For each: `seed_count` = genre seeds whose work has it, `candidate_count` = such candidate works, minus works on the caller's shelves or in `dismissed_works`. Keep keys with `seed_count >= 1` or `candidate_count >= 3`. Order by seed evidence (step 3) descending, then `candidate_count` descending, then display name; keep the first 100; store them with `replace_reader_genres`. A failure here is logged and ignored, like step 6.

6. In "**Reading them (browser).**", add after its first sentence: Each shelf carries its `genre_key`. After the stored shelves, every pinned genre (from `genre_preferences`) that has no stored rows gets an empty shelf under its `label`.

## F. New browser sections

Insert right after the "**Refresh after removing or restoring (S16).**" paragraph:

**Hiding a genre shelf (browser, S17).** Every genre shelf's header (`.shelf-head`) has a small secondary button "הסתר מדף". It calls `set_genre_preference(genre_key, genre, 'hidden')`. While the call runs the button is disabled. On success the shelf section leaves the screen at once, a toast says "המדף הוסתר. אפשר להחזיר אותו בהגדרות מדפי ההמלצות", and `notifyRecsInputsChanged()` is called. On failure the button re-enables and a toast shows the error. A pinned genre's header also shows the label "נעוץ". A pinned shelf with fewer than 4 books (including an empty one) shows the note "אין עדיין מספיק ספרים במדף הזה. דרגו ספרים מהז'אנר הזה כדי לקבל עוד" under its books.

**Recommendation shelf settings page (#genres, S17).** A menu (hamburger) item "הגדרות מדפי המלצות", after "ספרים שהסרתי". The page title is the same text. Loading and error states as on the other screens. The page burger shows on this screen like on the others.
1. **Number of shelves:** a select with 1-20, showing `profiles.genre_shelf_count`. A change calls `set_genre_shelf_count`.
2. **Genre list:** one row per genre in the union of the caller's `reader_genres` (in `position` order) and `genre_preferences` rows whose key is not in `reader_genres` (after them, by `label`). Each row shows the display name, the line "{seed_count} ספרים שלך · {candidate_count} ספרים מתאימים" (only for `reader_genres` rows), the tag "מוצג עכשיו" when that key has `genre_recommendations` rows, and a three-option control: "אוטומטי", "תמיד להציג", "לא להציג", showing the current state (no row = אוטומטי). A choice calls `set_genre_preference(genre_key, label, 'auto' | 'pinned' | 'hidden')`.
3. While the caller has N − 1 pinned genres (N = shelf count), "תמיד להציג" is disabled on the rows that are not pinned, and the note "אפשר לנעוץ עד {N − 1} מדפים, כדי שיישאר מקום לז'אנר חדש" shows above the list. When more than N − 1 are pinned (after lowering N), the same note says only the first N − 1 pins are shown.
4. Every successful change shows a toast "נשמר. המדפים יתעדכנו בעוד רגע" and calls `notifyRecsInputsChanged()`. A failed change restores the previous value and shows the error in a toast.
5. Empty state, when the union is empty: "דרגו כמה ספרים כדי שנמצא ז'אנרים בשבילכם".
6. The new shelves show on the library screen on its next mount, as with any regeneration.

## G. `GenreShelf` view model

In "### `GenreShelf` and `GenreBook`", replace "`GenreShelf` is `{ genre, books }` ordered by `shelf_position`;" with "`GenreShelf` is `{ genre_key, genre, pinned, books }` ordered by `shelf_position` (`pinned` is true when the caller's `genre_preferences` pins that key; an empty pinned shelf from "Reading them" has `books: []`);".

# Acceptance criteria

1. The diff is exactly edits A-G.
2. `npm run check:contract` passes, and the verification command finds every new name.
