import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyOptimisticBookMove,
  applyOptimisticRating,
  applyOptimisticShelfMove,
  bookDropIndexFromCenters,
  bookTilesWithoutPlus,
  cloneLibrary,
  shelfIndexById,
} from "../../public/js/data.js";
import { createRouter } from "../../public/js/router.js";
import { ROUTES } from "../../public/js/contract.js";
import { localizeRecommendations } from "../../public/js/recs.js";

describe("layout helpers (data.js)", () => {
  it("bookTilesWithoutPlus skips plus tiles and dragged book", () => {
    const tiles = [{ id: 1 }, { id: 2 }, { id: 3, isPlus: true }];
    assert.equal(bookTilesWithoutPlus(tiles, 1).length, 1);
    assert.equal(bookTilesWithoutPlus(tiles, 1)[0].id, 2);
  });

  it("bookDropIndexFromCenters uses RTL midpoint rule", () => {
    assert.equal(bookDropIndexFromCenters([120, 60], 130), 0);
    assert.equal(bookDropIndexFromCenters([120, 60], 90), 1);
    assert.equal(bookDropIndexFromCenters([120, 60], 50), 2);
    assert.equal(bookDropIndexFromCenters([], 10), 0);
  });

  it("shelfIndexById finds shelf position", () => {
    assert.equal(shelfIndexById(["a", "b", "c"], "b"), 1);
    assert.equal(shelfIndexById(["a", "b", "c"], "missing"), -1);
  });
});

describe("optimistic move revert", () => {
  it("keeps a snapshot to restore after a failed write", () => {
    const state = {
      displayName: "",
      shelves: [
        {
          id: "a",
          name: "א",
          kind: "reading",
          position: 0,
          books: [{ simania_id: 1, shelf_id: "a", position: 0, title: "אחד" }],
        },
        { id: "b", name: "ב", kind: "read", position: 1, books: [] },
      ],
    };
    const snapshot = cloneLibrary(state);
    const moved = applyOptimisticBookMove(state, {
      simaniaId: 1,
      fromShelfId: "a",
      toShelfId: "b",
      toPosition: 0,
    });
    assert.equal(moved.shelves[1].books.length, 1);
    const reverted = snapshot;
    assert.equal(reverted.shelves[0].books.length, 1);
    assert.equal(reverted.shelves[1].books.length, 0);
  });

  it("reverts a shelf reorder the same way", () => {
    const state = {
      displayName: "",
      shelves: [
        { id: "a", name: "א", kind: "reading", position: 0, books: [] },
        { id: "b", name: "ב", kind: "read", position: 1, books: [] },
      ],
    };
    const snapshot = cloneLibrary(state);
    applyOptimisticShelfMove(state, { shelfId: "b", toPosition: 0 });
    assert.equal(snapshot.shelves[0].id, "a");
  });
});

describe("router", () => {
  it("normalize keeps known hashes and maps empty/unknown to library", () => {
    const router = createRouter({ onRoute() {} });
    assert.equal(router.normalize("#library"), ROUTES.LIBRARY);
    assert.equal(router.normalize("#recs"), ROUTES.RECOMMENDATIONS);
    assert.equal(router.normalize("#search"), ROUTES.SEARCH);
    assert.equal(router.normalize("#settings"), ROUTES.SETTINGS);
    assert.equal(router.normalize("#login"), ROUTES.LOGIN);
    assert.equal(router.normalize(""), ROUTES.LIBRARY);
    assert.equal(router.normalize("#nope"), ROUTES.LIBRARY);
  });
});

// --- genre recommendation shelves (library.js) -----------------------------

const library = await import("../../public/js/library.js");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(times = 6) {
  for (let i = 0; i < times; i += 1) await tick();
}

function createGenreOverlay() {
  const inserted = [];
  const parentElement = {
    firstChild: null,
    insertBefore(node) {
      inserted.unshift(node);
      node.remove = () => {
        const index = inserted.indexOf(node);
        if (index >= 0) inserted.splice(index, 1);
      };
    },
  };
  const doc = {
    createElement: () => ({ setAttribute() {}, remove() {}, className: "", textContent: "" }),
  };
  const listeners = [];
  const select = {
    ownerDocument: doc,
    value: "",
    disabled: false,
    firstChild: null,
    options: [],
    insertBefore() {},
  };
  const removeBtn = {
    ownerDocument: doc,
    textContent: "הסר מהספרייה",
    hidden: false,
    disabled: false,
    parentElement,
    contains: (t) => t === removeBtn,
  };
  const moveLabel = { ownerDocument: doc, childNodes: [], hidden: false };
  const nodes = new Map([
    [".bk-move", moveLabel],
    [".bk-move select", select],
    [".bk-remove", removeBtn],
  ]);
  let open = false;
  const observers = [];
  return {
    ownerDocument: doc,
    listeners,
    _select: select,
    _remove: removeBtn,
    _setOpen(value) {
      open = value;
      for (const callback of observers) callback();
    },
    _observe(callback) { observers.push(callback); },
    classList: { contains: (name) => name === "on" && open },
    querySelector: (sel) => sel === ".bk-rec-reason"
      ? inserted.find((node) => node.className === "bk-rec-reason") ?? null
      : nodes.get(sel) ?? null,
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture: Boolean(capture) }),
    removeEventListener: (type, fn) => {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
}

function installFakeDom(overlay) {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    addEventListener: globalThis.addEventListener,
    MutationObserver: globalThis.MutationObserver,
    localStorage: globalThis.localStorage,
  };
  const docListeners = [];
  globalThis.document = {
    body: { style: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false } },
    documentElement: { clientWidth: 1000 },
    getElementById: (id) => (id === "bk" ? overlay : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, fn) => docListeners.push({ type, fn }),
    dispatchEvent: (event) => {
      for (const l of docListeners.filter((x) => x.type === event.type)) l.fn(event);
      return true;
    },
  };
  globalThis.window = { scrollY: 0, scrollTo() {} };
  globalThis.addEventListener = () => {};
  globalThis.MutationObserver = class {
    constructor(callback) { this.callback = callback; }
    observe(target) { target._observe(this.callback); }
    disconnect() {}
  };
  globalThis.localStorage = {
    getItem: (key) => key === library.GENRE_LOCALIZE_TRIED_KEY
      ? JSON.stringify({ w2: new Date().toISOString() })
      : null,
    setItem() {},
  };
  return () => {
    globalThis.document = previous.document;
    globalThis.window = previous.window;
    globalThis.addEventListener = previous.addEventListener;
    globalThis.MutationObserver = previous.MutationObserver;
    globalThis.localStorage = previous.localStorage;
  };
}

function createLibraryRoot() {
  const caseEl = { innerHTML: "" };
  const listeners = [];
  return {
    hidden: false,
    dataset: {},
    caseEl,
    listeners,
    querySelector: (sel) => (sel === "#case" ? caseEl : null),
    querySelectorAll: () => [],
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture: Boolean(capture) }),
  };
}

function click(root, target) {
  const event = { target, stopPropagation() {}, preventDefault() {} };
  const clicks = root.listeners.filter((l) => l.type === "click");
  for (const l of [...clicks.filter((l) => l.capture), ...clicks.filter((l) => !l.capture)]) l.fn(event);
}

function genreBookEl(workId) {
  const el = {
    dataset: { workId },
    closest: (sel) => (sel === ".genre-shelf .book" || sel === ".genre-shelf" ? el : null),
  };
  return el;
}

const readerShelves = [
  {
    id: "reading",
    name: "קורא עכשיו",
    kind: "reading",
    position: 0,
    books: [{ simania_id: 1, shelf_id: "reading", position: 0, title: "אחד", author: null, cover_url: null }],
  },
  { id: "read", name: "קראתי", kind: "read", position: 1, books: [] },
];

describe("reader shelf tile ratings", () => {
  const book = {
    simania_id: 17,
    title: "ספר",
    author: "סופרת",
    cover_url: null,
    rating: 4,
  };

  it("renders a rated book as five SVG stars filled from the right", () => {
    const html = library.bookTile(book);
    assert.equal((html.match(/<span class="tile-stars"/g) ?? []).length, 1);
    assert.equal((html.match(/<svg/g) ?? []).length, 5);
    assert.equal((html.match(/class="on"/g) ?? []).length, 4);
    assert.match(html, /aria-label="דירוג: 4 מתוך 5"/);
    assert.ok(html.indexOf("tile-stars") < html.indexOf("cover"), "stars precede the cover");
  });

  it("renders no star element for null or otherwise invalid ratings", () => {
    for (const rating of [null, 0, 2.5, 6, "4", undefined]) {
      assert.equal(library.bookTile({ ...book, rating }).includes("tile-stars"), false);
    }
  });

  it("does not add stars to genre or plus tiles", () => {
    const genreHtml = library.genreShelfSection({
      genre: "מתח",
      books: [{ work_id: "w", title: "ספר", author: null, cover_url: null, rating: 5 }],
    });
    const ownEmptyShelf = library.shelfSection({
      id: "s",
      name: "מדף",
      kind: "reading",
      books: [],
    });
    assert.equal(genreHtml.includes("tile-stars"), false);
    assert.match(ownEmptyShelf, /class="book plus"/);
    assert.equal(ownEmptyShelf.includes("tile-stars"), false);
  });

  it("reflects an optimistic rating on the next repaint", () => {
    const state = {
      displayName: "",
      shelves: [{ id: "s", name: "מדף", kind: "reading", position: 0, books: [{ ...book, rating: 1 }] }],
    };
    const before = library.shelfSection(state.shelves[0]);
    const next = applyOptimisticRating(state, book.simania_id, 5);
    const after = library.shelfSection(next.shelves[0]);
    assert.equal((before.match(/class="on"/g) ?? []).length, 1);
    assert.equal((after.match(/class="on"/g) ?? []).length, 5);
    assert.match(after, /aria-label="דירוג: 5 מתוך 5"/);
  });
});

const genreShelves = [
  {
    genre: "מדע בדיוני",
    books: [
      { work_id: "w1", hardcover_id: 11, simania_id: 501, title: "סחרור", author: "וילסון", cover_url: null, english_only: false, because: [101], because_titles: ["החברה הגאונה"] },
      { work_id: "w2", hardcover_id: 12, simania_id: null, title: "Spin", author: "Robert Charles Wilson", cover_url: "https://x/c.jpg", english_only: true, because: [], because_titles: [] },
    ],
  },
  {
    genre: "פנטזיה",
    books: [
      { work_id: "w3", hardcover_id: 13, simania_id: 503, title: "ההוביט", author: null, cover_url: null, english_only: false, because: [], because_titles: [] },
    ],
  },
];

function createLibraryCtx(lib) {
  let state = cloneLibrary(lib);
  const calls = { loadGenreShelves: 0, functions: [], cardOpens: [] };
  const ctx = {
    api: {
      getClient: () => ({}),
      callFunction: async (name, body) => {
        calls.functions.push([name, body]);
        return { book: { simania_id: body.simania_id ?? -body.hardcover_id, title: "x" } };
      },
    },
    data: {
      loadLibrary: async () => cloneLibrary(lib),
      loadGenreShelves: async () => {
        calls.loadGenreShelves += 1;
        return structuredClone(genreShelves);
      },
    },
    card: {
      open: (book, shelves) => calls.cardOpens.push({ book, shelves }),
      close: () => {},
    },
    getLibrary: () => state,
    setLibrary: (s) => {
      state = s;
    },
    showToast: () => {},
    router: { go() {} },
  };
  return { ctx, calls };
}

describe("genre shelves on the library screen", async () => {
  const { SHELVES_CHANGED } = await import("../../public/js/events.js");
  const lib = { displayName: "", shelves: readerShelves };

  it("renders genre shelves after the reader's shelves and the new-shelf control", async () => {
    const restore = installFakeDom(createGenreOverlay());
    const root = createLibraryRoot();
    const { ctx } = createLibraryCtx(lib);
    try {
      const cleanup = await library.mount(root, ctx);
      await settle();
      const html = root.caseEl.innerHTML;
      const addSlot = html.indexOf('id="add-shelf"');
      const lastOwn = html.lastIndexOf('data-shelf-id="read"');
      const firstGenre = html.indexOf('class="shelf genre-shelf"');
      assert.ok(lastOwn >= 0 && addSlot > lastOwn && firstGenre > addSlot, "after own shelves and + מדף חדש");
      assert.ok(html.indexOf("פנטזיה") > html.indexOf("מדע בדיוני"));
      const genreHtml = html.slice(firstGenre);
      assert.match(genreHtml, /<h2>מדע בדיוני<\/h2><span>מומלצים בשבילך<\/span>/);
      assert.match(genreHtml, /<h2>פנטזיה<\/h2><span>מומלצים בשבילך<\/span>/);
      assert.equal(/class="book plus"/.test(genreHtml), false, "no + tile");
      assert.equal(/class="edit"|shelf-delete/.test(genreHtml), false, "no edit/delete buttons");
      assert.equal(/data-shelf-id/.test(genreHtml), false, "not a reader shelf");
      assert.match(genreHtml, /<span class="cover cover-fallback" dir="auto">סחרור<\/span>/);
      assert.match(genreHtml, /<img class="cover" src="https:\/\/x\/c.jpg"/);
      assert.match(genreHtml, /<b dir="auto">Spin<\/b>/);
      cleanup();
    } finally {
      restore();
    }
  });

  it("shows nothing for genre shelves when loading fails or is empty", async () => {
    const loaders = [
      async () => {
        throw new Error("boom");
      },
      async () => [],
    ];
    for (const loadGenreShelves of loaders) {
      const restore = installFakeDom(createGenreOverlay());
      const root = createLibraryRoot();
      const { ctx } = createLibraryCtx(lib);
      ctx.data.loadGenreShelves = loadGenreShelves;
      try {
        const cleanup = await library.mount(root, ctx);
        await settle();
        assert.equal(root.caseEl.innerHTML.includes("genre-shelf"), false);
        assert.ok(root.caseEl.innerHTML.includes('id="add-shelf"'));
        cleanup();
      } finally {
        restore();
      }
    }
  });

  it("loads genre shelves exactly once per mount despite redraws and refresh events", async () => {
    const restore = installFakeDom(createGenreOverlay());
    const root = createLibraryRoot();
    const { ctx, calls } = createLibraryCtx(lib);
    try {
      const cleanup = await library.mount(root, ctx);
      await settle();
      assert.equal(calls.loadGenreShelves, 1);
      // Redraws (shelf changes, book moves, settings) call mount again while open.
      await library.mount(root, ctx);
      ctx.setLibrary(cloneLibrary(lib));
      await library.mount(root, ctx);
      document.dispatchEvent({ type: SHELVES_CHANGED });
      document.dispatchEvent({ type: "visibilitychange" });
      await settle();
      assert.equal(calls.loadGenreShelves, 1);
      // Redrawn from the data loaded at mount.
      assert.match(root.caseEl.innerHTML, /<h2>מדע בדיוני<\/h2>/);
      cleanup();
      // The next screen visit is a new mount.
      const cleanup2 = await library.mount(root, ctx);
      await settle();
      assert.equal(calls.loadGenreShelves, 2);
      cleanup2();
    } finally {
      restore();
    }
  });

  it("opens a genre book with its recommendation reason and removes it on close", async () => {
    const overlay = createGenreOverlay();
    const restore = installFakeDom(overlay);
    const root = createLibraryRoot();
    const { ctx, calls } = createLibraryCtx(lib);
    const recordOpen = ctx.card.open;
    ctx.card.open = (...args) => {
      recordOpen(...args);
      overlay._setOpen(true);
    };
    ctx.card.close = () => overlay._setOpen(false);
    try {
      const cleanup = await library.mount(root, ctx);
      await settle();
      click(root, genreBookEl("w1"));
      await settle();
      assert.deepEqual(calls.functions, [["book-details", { simania_id: 501 }]]);
      assert.equal(calls.cardOpens.length, 1);
      assert.deepEqual(calls.cardOpens[0].shelves.map((s) => s.id), ["reading", "read"]);
      assert.equal(overlay._remove.hidden, true);
      assert.match(overlay.querySelector(".bk-rec-reason")?.textContent ?? "", /החברה הגאונה/);
      ctx.card.close();
      assert.equal(overlay.querySelector(".bk-rec-reason"), null);
      cleanup();
      assert.equal(overlay._remove.hidden, false, "library card chrome restored");
    } finally {
      restore();
    }
  });

  it("removes a book added from a genre shelf locally without reloading genre shelves", async () => {
    const overlay = createGenreOverlay();
    const restore = installFakeDom(overlay);
    const root = createLibraryRoot();
    let reloads = 0;
    const { ctx, calls } = createLibraryCtx(lib);
    ctx.reloadLibrary = async () => {
      reloads += 1;
      ctx.setLibrary(cloneLibrary(lib));
      await library.mount(root, ctx);
    };
    try {
      const cleanup = await library.mount(root, ctx);
      await settle();
      assert.ok(root.caseEl.innerHTML.includes('data-work-id="w2"'));
      click(root, genreBookEl("w2"));
      await settle();
      overlay._select.value = "reading";
      const change = { target: overlay._select, stopImmediatePropagation() {} };
      for (const l of overlay.listeners.filter((x) => x.type === "change" && x.capture)) l.fn(change);
      await settle();
      assert.deepEqual(calls.functions, [
        ["book-details", { simania_id: -12 }],
        ["add-book", { hardcover_id: 12, shelf_id: "reading" }],
      ]);
      const html = root.caseEl.innerHTML;
      assert.equal(html.includes('data-work-id="w2"'), false);
      assert.ok(html.includes('data-work-id="w1"'));
      assert.ok(html.includes('data-work-id="w3"'));
      assert.equal(reloads, 1);
      assert.equal(calls.loadGenreShelves, 1);
      cleanup();
    } finally {
      restore();
    }
  });

  it("removeGenreBook drops the work and empty shelves", () => {
    const next = library.removeGenreBook(genreShelves, "w3");
    assert.deepEqual(next.map((s) => s.genre), ["מדע בדיוני"]);
    assert.equal(genreShelves[1].books.length, 1, "input not mutated");
  });
});

function englishGenreShelves(count) {
  const books = Array.from({ length: count }, (_, index) => ({
    work_id: `english-${index + 1}`,
    hardcover_id: index + 1,
    simania_id: null,
    title: `English ${index + 1}`,
    author: "Author",
    cover_url: `https://example.test/${index + 1}.jpg`,
    english_only: true,
    because: [],
    because_titles: [],
  }));
  return [
    { genre: "ראשון", books: books.slice(0, 7) },
    { genre: "שני", books: books.slice(7) },
  ];
}

describe("genre shelf localization", () => {
  it("links a genre book through the catalog fallback after the existing paths miss", async () => {
    const linked = [];
    const calls = [];
    await library.localizeGenreBooks(englishGenreShelves(1), {
      storage: null,
      isCurrent: () => true,
      callFunction: async (name, body) => {
        calls.push(name);
        if (name === "genre-hint") {
          return { hebrew_hint: { source: "nli", title: "כותרת ישנה", author: null }, hebrew_author: null };
        }
        if (name === "hebrew-candidates") {
          return {
            work_id: body.work_id,
            candidates: [{ title: "כותרת נכונה", author: "מחבר", rule: "A" }],
            english_names: [],
          };
        }
        return { simania_id: 765, title: "כותרת נכונה", author: "מחבר", cover_url: null };
      },
      localize: (items, deps) => localizeRecommendations(items, {
        ...deps,
        match: async () => null,
        searchByAuthor: async () => [],
        searchBooks: async () => [{ id: 765, title: "כותרת נכונה", author: "מחבר" }],
        fetchPayload: async () => ({ details: { title: "כותרת נכונה" }, rating: null }),
      }),
      onLinked: (...args) => linked.push(args),
    });

    assert.deepEqual(calls, ["genre-hint", "hebrew-candidates", "link-edition"]);
    assert.equal(linked[0][0], "english-1");
    assert.equal(linked[0][1].simania_id, 765);
  });

  it("attempts at most 12 English books in shelf and position order, two at a time", async () => {
    const attempts = [];
    let active = 0;
    let maximumActive = 0;
    await library.localizeGenreBooks(englishGenreShelves(14), {
      storage: null,
      isCurrent: () => true,
      onLinked() {},
      callFunction: async (name, body) => {
        assert.equal(name, "genre-hint");
        attempts.push(body.work_id);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await tick();
        active -= 1;
        return { hebrew_hint: null, hebrew_author: null };
      },
    });
    assert.deepEqual(attempts, Array.from({ length: 12 }, (_, index) => `english-${index + 1}`));
    assert.equal(maximumActive, 2);
  });

  it("skips a work tried within 14 days, while throwing storage skips and records nothing", async () => {
    const now = Date.parse("2026-11-07T12:00:00.000Z");
    const storedAttempts = [];
    const storage = {
      getItem: () => JSON.stringify({
        "english-1": new Date(now - 13 * 24 * 60 * 60 * 1000).toISOString(),
        "english-2": new Date(now - 15 * 24 * 60 * 60 * 1000).toISOString(),
      }),
      setItem() {},
    };
    await library.localizeGenreBooks(englishGenreShelves(3), {
      storage,
      now: () => now,
      isCurrent: () => true,
      onLinked() {},
      callFunction: async (_name, body) => {
        storedAttempts.push(body.work_id);
        return {};
      },
    });
    assert.deepEqual(storedAttempts, ["english-2", "english-3"]);

    const throwingAttempts = [];
    let writes = 0;
    await library.localizeGenreBooks(englishGenreShelves(3), {
      storage: {
        getItem() { throw new Error("blocked"); },
        setItem() { writes += 1; throw new Error("blocked"); },
      },
      now: () => now,
      isCurrent: () => true,
      onLinked() {},
      callFunction: async (_name, body) => {
        throwingAttempts.push(body.work_id);
        return {};
      },
    });
    assert.deepEqual(throwingAttempts, ["english-1", "english-2", "english-3"]);
    assert.equal(writes, 0);
  });

  it("updates only a linked book's tile and keeps its work id", async () => {
    const shelves = englishGenreShelves(2);
    const session = { shelves };
    const firstTile = { dataset: { workId: "english-1" }, innerHTML: "first-before" };
    const secondTile = { dataset: { workId: "english-2" }, innerHTML: "second-before" };
    const root = { querySelectorAll: () => [firstTile, secondTile] };
    await library.localizeGenreBooks(shelves, {
      storage: null,
      isCurrent: () => true,
      callFunction: async (_name, body) => body.work_id === "english-1"
        ? { hebrew_hint: { title: "כותרת", author: "מחבר" }, hebrew_author: "מחבר" }
        : {},
      localize: async (items, deps) => {
        deps.onLinked(items[0].work_id, {
          simania_id: 987746,
          title: "אלינור אוליפנט ממש בסדר",
          author: "גייל הונימן",
          cover_url: "https://example.test/hebrew.jpg",
        });
      },
      onLinked: (workId, linkedPatch) => library.updateGenreBookInPlace(root, session, workId, linkedPatch),
    });
    assert.equal(firstTile.dataset.workId, "english-1");
    assert.match(firstTile.innerHTML, /אלינור אוליפנט ממש בסדר/);
    assert.match(firstTile.innerHTML, /https:\/\/example\.test\/hebrew\.jpg/);
    assert.equal(secondTile.innerHTML, "second-before");
    assert.deepEqual(shelves[0].books[0], {
      ...englishGenreShelves(2)[0].books[0],
      simania_id: 987746,
      title: "אלינור אוליפנט ממש בסדר",
      author: "גייל הונימן",
      cover_url: "https://example.test/hebrew.jpg",
      english_only: false,
    });
  });

  it("stops scheduling further attempts after unmount", async () => {
    let current = true;
    const attempts = [];
    const releases = [];
    const running = library.localizeGenreBooks(englishGenreShelves(6), {
      storage: null,
      isCurrent: () => current,
      onLinked() {},
      callFunction: (_name, body) => {
        attempts.push(body.work_id);
        return new Promise((resolve) => releases.push(() => resolve({})));
      },
    });
    await tick();
    assert.deepEqual(attempts, ["english-1", "english-2"]);
    current = false;
    releases.forEach((release) => release());
    await running;
    assert.deepEqual(attempts, ["english-1", "english-2"]);
  });

  it("warns on a rejected genre hint and continues with the next book", async () => {
    const attempts = [];
    const warnings = [];
    const previousWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
      await library.localizeGenreBooks(englishGenreShelves(3), {
        storage: null,
        isCurrent: () => true,
        onLinked() {},
        callFunction: async (_name, body) => {
          attempts.push(body.work_id);
          if (body.work_id === "english-1") throw new Error("hint failed");
          return {};
        },
      });
    } finally {
      console.warn = previousWarn;
    }
    assert.deepEqual(attempts, ["english-1", "english-2", "english-3"]);
    assert.equal(warnings.length, 1);
  });
});
