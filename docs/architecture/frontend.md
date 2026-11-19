# Frontend

## Structure

Static files in `public/`, native ES modules, no build step, no framework. `design/library.html` is the visual reference: copy its look and interactions (pine shelves, rows, door menu, book card, long-press drag, "+" tile), not its hardcoded data. The design file embeds images as data URIs; move them to files under `public/assets/`.

```text
public/index.html          one page, all screens as sections toggled by the router
public/css/base.css        tokens, layout, shelves, rows, door menu, card (shell)
public/css/<screen>.css    one file per screen lane
public/js/config.js        Supabase URL, anon key, functions URL (local defaults)
public/js/api.js           supabase client, auth session, callFunction(name, body)
public/js/data.js          library reads and writes (shelves, books, RPCs)
public/js/router.js        hash routes: #library, #recs, #search, #removed, #settings, #login
public/js/library.js       library screen: render shelves, scroll, drag, rename, new shelf
public/js/card.js          book card popup
public/js/auth.js          login screen, session guard, logout       (lane D1)
public/js/settings.js      settings screen                           (lane D1)
public/js/recs.js          recommendations screen                    (lane D2)
public/js/add-book.js      search dropdown and add flow              (lane D3)
public/js/first-run.js     empty-library prompt                      (lane D4)
public/manifest.webmanifest, public/icons/*                          (lane D4)
```

Added after the first build:

```text
public/js/contract.js      shared constants: shelf kinds, function names
public/js/simania.js       browser Simania client: search, details, rating, Hebrew match
public/js/my-rating.js     five-star rating widget and the "how was it?" prompt
public/js/events.js        shelves-changed event fired on every shelf change
public/js/recs-refresh.js  debounced background recommendation refresh
public/js/app-open-refresh.js  one refresh per app open, and after 30+ minutes away
public/js/invite.js        invite-friends screen (#invite)
public/css/invite.css      invite screen styles
public/sw.js               network-first service worker (Android install, offline shell)
```

`scripts/build-site.mjs` adds `?v=<hash>` to every module when the site is published, so a cached old module never mixes with new ones.

The shell lane creates every file above, including empty stubs for the lane-owned modules with their exported function names, and links every CSS file and script from `index.html`. Later lanes edit only their own files, so they never conflict on `index.html`.

## Module contract

Each screen module exports `mount(root, ctx)` where `ctx` holds `{ api, data, router, card }`. The router calls `mount` when its route is shown. Pure helpers (ordering, mapping rows to view models, debounce) are exported separately so `node --test` can test them without a browser.

## Screens

- **Library** (`#library`): shelves in `position` order, books in `position` order, counts, "+" tile, "+ מדף חדש", rename custom shelves, long-press drag for books and shelves (persisted through `move_book` and `move_shelf`). Genre shelves appear below the reader's shelves; each has "הסתר מדף", pinned shelves show "נעוץ", and a pinned shelf with fewer than four books shows a note encouraging more genre ratings.
- **Book card**: cover, shelf tag, title, author; Simania rating and count, then the reader's own 1-5 stars (library books only; tap the current rating again to clear); actions directly below the ratings: recommendation reason (recommendation and genre cards only), move to shelf (select), English-only note (English-only cards only), and remove buttons ("הסר" for a library book; "הסר" and "לא הסגנון שלי" for a recommended book); "על הספר" and the description; then the details (translator, publisher, year, pages, series). No external links. An unrated book that reaches `read` (drag, card move, add, or add from a recommendation) prompts "how was it?".
- **Add book** (from "+" tile, preselected shelf; or from `#search`, user picks the shelf): results while typing (Simania called from the browser), 300 ms debounce, loading, no results, error. Tap a result to add. The book appears at once with a pending state, then fills from the `add-book` response.
- **Recommendations** (`#recs`): covers with the reason line ("similar to X and Y" since seeds can be unread rated books, or the shared tags), tap opens the card with "add to shelf", "הסר" and "לא הסגנון שלי" (S15; the same two buttons on a genre shelf's card). English-only items (no `simania_id`) show the Hardcover title and cover, a short note that there is no Hebrew edition, and only the two remove buttons. Long loading state. Empty state when there are no seeds. No refresh button: the list regenerates in the background after every shelf change, and the screen shows the stored list with a small "searching for new recommendations" line, then reloads. English-only cards are localized in the browser and become addable when `link-edition` succeeds; the year guard for fallback rules E, F and G uses `original_year`. The actions "הסר", "לא הסגנון שלי" and "החזר" start a background regeneration.
- **Login** (`#login`): email and password, errors in Hebrew, password reset email. Invite and reset links open a set-password form (the client reads the `#access_token` fragment before the router runs); after an invite the user also picks a display name.
- **Removed books** (`#removed`, S15): the books removed from recommendations or genre shelves, with "החזר" (contract: "Removed books page").
- **Recommendation shelf settings** (`#genres`): choose automatic, pinned, or hidden genre shelves and set their count.
- **Settings** (`#settings`): display name, log out.
- **Invite** (`#invite`): invite a friend by email through `invite-user`, list of invitations sent.
- **First run**: a new user with no books sees one line inviting them to add a book they loved, pointing at the "+" tile.
- Menu: הספרייה שלי, המלצות בשבילי, חיפוש ספרים, הגדרות, הזמנת חברים. "סטטיסטיקות קריאה" is hidden in this build. Every screen has a menu button.

## Rules

- RTL, Hebrew copy. Library name from `profiles.display_name`.
- Every network action has loading and error states. A failed write reverts the optimistic change and shows a short message.
- Keyboard and touch both work. Respect `prefers-reduced-motion`.
