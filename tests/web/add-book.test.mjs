import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  DUPLICATE_MSG,
  SEARCH_DEBOUNCE_MS,
  addBookToShelf,
  addErrorMessage,
  applyOptimisticAdd,
  createSearchGeneration,
  debounce,
  fillBookFromAddResponse,
  mapSearchBook,
  mapSearchBooksResponse,
  markPendingBooks,
  open,
  removePendingAdd,
  wireSearchInput,
} from "../../public/js/add-book.js";

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mockNode(extra = {}) {
  const listeners = new Map();
  return {
    innerHTML: "",
    dataset: {},
    value: "",
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener(type, fn) {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
    dispatch(type, event = {}) {
      listeners.get(type)?.(event);
    },
    ...extra,
  };
}

function sampleLibrary(books) {
  return {
    displayName: "איתמר",
    shelves: [
      {
        id: "s1",
        name: "קורא עכשיו",
        kind: "reading",
        position: 0,
        books: books.map((b, i) => ({
          simania_id: b.simania_id,
          title: b.title,
          author: b.author ?? null,
          shelf_id: "s1",
          shelf_name: "קורא עכשיו",
          shelf_kind: "reading",
          position: i,
          pending: b.pending ?? false,
        })),
      },
    ],
  };
}

function fakeCtx(initial) {
  const box = { lib: initial, toasts: [] };
  return {
    box,
    getLibrary: () => box.lib,
    setLibrary: (s) => {
      box.lib = s;
    },
    showToast: (m) => {
      box.toasts.push(m);
    },
    redrawLibrary: async () => {},
  };
}

describe("mapSearchBooksResponse", () => {
  it("maps contract search-books rows to display fields", () => {
    const hits = mapSearchBooksResponse({
      books: [
        {
          id: 42,
          title: "הנסיך הקטן",
          author: "סנט־אכזופרי",
          year: 2015,
          coverUrl: "https://example/c.jpg",
        },
      ],
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].simania_id, 42);
    assert.equal(hits[0].title, "הנסיך הקטן");
    assert.equal(hits[0].author, "סנט־אכזופרי");
    assert.equal(hits[0].year, 2015);
    assert.equal(hits[0].cover_url, "https://example/c.jpg");
  });

  it("returns an empty list for invalid payloads", () => {
    assert.deepEqual(mapSearchBooksResponse(null), []);
    assert.deepEqual(mapSearchBooksResponse({ books: "nope" }), []);
  });

  it("mapSearchBook accepts bookId alias", () => {
    const one = mapSearchBook({ bookId: 9, title: "טסט" });
    assert.equal(one.simania_id, 9);
    assert.equal(one.title, "טסט");
  });
});

describe("debounce", () => {
  it(`waits ${SEARCH_DEBOUNCE_MS}ms before running`, async () => {
    let calls = 0;
    const run = debounce(SEARCH_DEBOUNCE_MS, () => {
      calls += 1;
    });
    run();
    run();
    assert.equal(calls, 0);
    await delay(SEARCH_DEBOUNCE_MS - 20);
    assert.equal(calls, 0);
    await delay(40);
    assert.equal(calls, 1);
  });

  it("cancel prevents a pending call from running", async () => {
    let calls = 0;
    const run = debounce(SEARCH_DEBOUNCE_MS, () => {
      calls += 1;
    });
    run();
    run.cancel();
    await delay(SEARCH_DEBOUNCE_MS + 40);
    assert.equal(calls, 0);
  });
});

describe("wireSearchInput stale responses", () => {
  it("drops an older payload that arrives after a newer search", async () => {
    const input = mockNode();
    const panel = mockNode();
    /** @type {(value: unknown) => void} */
    let resolveFirst;
    /** @type {(value: unknown) => void} */
    let resolveSecond;
    const first = new Promise((r) => {
      resolveFirst = r;
    });
    const second = new Promise((r) => {
      resolveSecond = r;
    });
    let calls = 0;
    const callSearch = async () => {
      calls += 1;
      return calls === 1 ? first : second;
    };

    wireSearchInput({ input, panel, callSearch, onPick() {} });

    input.value = "אב";
    input.dispatch("input");
    await delay(SEARCH_DEBOUNCE_MS + 25);

    input.value = "אבגד";
    input.dispatch("input");
    await delay(SEARCH_DEBOUNCE_MS + 25);

    assert.equal(calls, 2);
    assert.equal(panel.dataset.status, "loading");

    resolveSecond({ books: [{ id: 2, title: "חדש", author: "ב", year: 2001, coverUrl: null }] });
    await delay(20);
    assert.equal(panel.innerHTML.includes("חדש"), true);

    resolveFirst({ books: [{ id: 1, title: "ישן", author: "א", year: 2000, coverUrl: null }] });
    await delay(20);
    assert.equal(panel.innerHTML.includes("חדש"), true);
    assert.equal(panel.innerHTML.includes("ישן"), false);
  });

  it("ignores a stale error after a newer success", async () => {
    const input = mockNode();
    const panel = mockNode();
    /** @type {(err: Error) => void} */
    let rejectFirst;
    /** @type {(value: unknown) => void} */
    let resolveSecond;
    const first = new Promise((_, reject) => {
      rejectFirst = reject;
    });
    const second = new Promise((r) => {
      resolveSecond = r;
    });
    let calls = 0;
    const callSearch = async () => {
      calls += 1;
      return calls === 1 ? first : second;
    };

    wireSearchInput({ input, panel, callSearch, onPick() {} });

    input.value = "אב";
    input.dispatch("input");
    await delay(SEARCH_DEBOUNCE_MS + 25);
    input.value = "אבגד";
    input.dispatch("input");
    await delay(SEARCH_DEBOUNCE_MS + 25);

    resolveSecond({ books: [{ id: 2, title: "חדש", author: "ב", year: 2001, coverUrl: null }] });
    await delay(20);
    rejectFirst(new Error("ישן נכשל"));
    await delay(20);

    assert.equal(panel.innerHTML.includes("חדש"), true);
    assert.equal(panel.innerHTML.includes("ישן נכשל"), false);
  });

  it("abort ignores an in-flight search after the picker is closed and reopened", async () => {
    const input = mockNode();
    const panel = mockNode();
    /** @type {(value: unknown) => void} */
    let resolveFirst;
    const first = new Promise((r) => {
      resolveFirst = r;
    });
    const callSearch = async () => first;

    const session = wireSearchInput({ input, panel, callSearch, onPick() {} });

    input.value = "אב";
    input.dispatch("input");
    await delay(SEARCH_DEBOUNCE_MS + 25);
    assert.equal(panel.dataset.status, "loading");

    session.abort();
    input.value = "";
    panel.innerHTML = "";
    panel.dataset.status = "idle";

    resolveFirst({ books: [{ id: 1, title: "ישן", author: "א", year: 2000, coverUrl: null }] });
    await delay(20);
    assert.equal(panel.innerHTML.includes("ישן"), false);
    assert.equal(panel.innerHTML.includes("טוען"), false);
    assert.equal(panel.dataset.status, "idle");
  });

  it("cleanup invalidates the previous session when search is rebound on the same panel", async () => {
    const input = mockNode();
    const panel = mockNode();
    /** @type {(value: unknown) => void} */
    let resolveFirst;
    const first = new Promise((r) => {
      resolveFirst = r;
    });
    let calls = 0;
    const callSearch = async () => {
      calls += 1;
      return first;
    };

    const firstSession = wireSearchInput({ input, panel, callSearch, onPick() {} });
    input.value = "אב";
    input.dispatch("input");
    await delay(SEARCH_DEBOUNCE_MS + 25);
    assert.equal(calls, 1);

    firstSession();
    input.value = "";
    panel.innerHTML = "";
    panel.dataset.status = "idle";
    wireSearchInput({
      input,
      panel,
      callSearch: async () => ({ books: [] }),
      onPick() {},
    });

    resolveFirst({ books: [{ id: 1, title: "ישן", author: "א", year: 2000, coverUrl: null }] });
    await delay(20);
    assert.equal(panel.innerHTML.includes("ישן"), false);
    assert.equal(panel.dataset.status, "idle");
  });

  it("cleanup cancels a pending debounce so a new empty session does not flash loading", async () => {
    const input = mockNode();
    const panel = mockNode();
    const unbind = wireSearchInput({
      input,
      panel,
      callSearch: async () => ({ books: [{ id: 1, title: "ישן", author: "א", year: 2000, coverUrl: null }] }),
      onPick() {},
    });

    input.value = "אב";
    input.dispatch("input");
    unbind();
    input.value = "";
    panel.innerHTML = "";
    panel.dataset.status = "idle";

    await delay(SEARCH_DEBOUNCE_MS + 40);
    assert.notEqual(panel.dataset.status, "loading");
    assert.equal(panel.innerHTML.includes("טוען"), false);
    assert.equal(panel.innerHTML.includes("ישן"), false);
  });
});

describe("stale search generation", () => {
  it("drops outdated responses when a newer search starts", () => {
    const gen = createSearchGeneration();
    const first = gen.next();
    const second = gen.next();
    assert.ok(gen.isLatest(second));
    assert.ok(!gen.isLatest(first));
  });
});

describe("optimistic add and revert", () => {
  const existing = { simania_id: 42, title: "קיים", author: "א" };
  const hit = { simania_id: 42, title: "חדש", author: "ב", year: 2015, cover_url: null };

  it("applyOptimisticAdd appends a pending card", () => {
    const next = applyOptimisticAdd(sampleLibrary([existing]), "s1", {
      simania_id: 99,
      title: "חדש",
      author: "ב",
      year: 2015,
      cover_url: null,
    });
    const added = next.shelves[0].books.at(-1);
    assert.equal(added.simania_id, 99);
    assert.equal(added.pending, true);
    assert.equal(added.resolve_status, "pending");
    assert.equal(next.shelves[0].books[0].title, "קיים");
  });

  it("409 removes only the pending row and keeps the existing edition", () => {
    const pending = applyOptimisticAdd(sampleLibrary([existing]), "s1", hit, "k1");
    assert.equal(pending.shelves[0].books.length, 2);
    const reverted = removePendingAdd(pending, "k1");
    assert.equal(reverted.shelves[0].books.length, 1);
    assert.equal(reverted.shelves[0].books[0].simania_id, 42);
    assert.equal(reverted.shelves[0].books[0].title, "קיים");
  });

  it("fillBookFromAddResponse replaces the pending row", () => {
    const pending = applyOptimisticAdd(
      sampleLibrary([]),
      "s1",
      { simania_id: 7, title: "זמני", author: null, year: null, cover_url: null },
      "k7",
    );
    const filled = fillBookFromAddResponse(pending, "s1", "k7", {
      simania_id: 7,
      title: "מהשרת",
      author: "ג",
    });
    assert.equal(filled.shelves[0].books[0].title, "מהשרת");
    assert.equal(filled.shelves[0].books[0].pending, false);
  });

  it("addErrorMessage distinguishes 409 from generic errors", () => {
    assert.equal(addErrorMessage({ status: 409 }), DUPLICATE_MSG);
    assert.equal(addErrorMessage(new Error("הרשת נפלה")), "הרשת נפלה");
  });
});

describe("markPendingBooks", () => {
  function mockTile(simaniaId) {
    const classes = new Set();
    return {
      dataset: { simaniaId: String(simaniaId) },
      classList: {
        add(name) {
          classes.add(name);
        },
        contains(name) {
          return classes.has(name);
        },
      },
    };
  }

  function mockLibRoot(shelfId, tiles) {
    const shelfEl = {
      dataset: { shelfId },
      querySelectorAll(sel) {
        if (sel === ".book:not(.plus)") return tiles;
        return [];
      },
    };
    return {
      querySelector(sel) {
        if (String(sel).includes(`data-shelf-id="${shelfId}"`)) return shelfEl;
        const idMatch = /data-simania-id="([^"]+)"/.exec(String(sel));
        if (idMatch) return tiles.find((t) => t.dataset.simaniaId === idMatch[1]) ?? null;
        return null;
      },
    };
  }

  it("dims the pending duplicate row, not the existing copy of the same edition", () => {
    const existingTile = mockTile(42);
    const pendingTile = mockTile(42);
    const libRoot = mockLibRoot("s1", [existingTile, pendingTile]);
    const pending = applyOptimisticAdd(sampleLibrary([{ simania_id: 42, title: "קיים", author: "א" }]), "s1", {
      simania_id: 42,
      title: "חדש",
      author: "ב",
      year: 2015,
      cover_url: null,
    });

    markPendingBooks(libRoot, pending);

    assert.equal(existingTile.classList.contains("pending"), false);
    assert.equal(pendingTile.classList.contains("pending"), true);
  });
});

describe("addBookToShelf", () => {
  const existing = { simania_id: 42, title: "קיים", author: "א" };

  it("on 409 restores the pre-add library and does not delete the existing copy", async () => {
    const ctx = fakeCtx(sampleLibrary([existing]));
    await addBookToShelf(
      { simania_id: 42, title: "חדש", author: "ב", year: 2015, cover_url: null },
      "s1",
      {
        ctx,
        add: async () => {
          const err = new Error("conflict");
          err.status = 409;
          throw err;
        },
      },
    );
    const books = ctx.getLibrary().shelves[0].books;
    assert.equal(books.length, 1);
    assert.equal(books[0].simania_id, 42);
    assert.equal(books[0].title, "קיים");
    assert.equal(ctx.box.toasts[0], DUPLICATE_MSG);
  });

  it("on a generic error restores the snapshot and shows the error", async () => {
    const ctx = fakeCtx(sampleLibrary([existing]));
    await addBookToShelf(
      { simania_id: 99, title: "חדש", author: "ב", year: 2015, cover_url: null },
      "s1",
      {
        ctx,
        add: async () => {
          throw new Error("הרשת נפלה");
        },
      },
    );
    const books = ctx.getLibrary().shelves[0].books;
    assert.equal(books.length, 1);
    assert.equal(books[0].simania_id, 42);
    assert.equal(ctx.box.toasts[0], "הרשת נפלה");
  });

  it("fills the pending card from a successful add-book response", async () => {
    const ctx = fakeCtx(sampleLibrary([]));
    await addBookToShelf(
      { simania_id: 7, title: "זמני", author: null, year: null, cover_url: null },
      "s1",
      {
        ctx,
        add: async () => ({
          book: { simania_id: 7, title: "מהשרת", author: "ג", resolve_status: "not_found" },
        }),
      },
    );
    const book = ctx.getLibrary().shelves[0].books[0];
    assert.equal(book.title, "מהשרת");
    assert.equal(book.pending, false);
  });
});

describe("overlapping adds", () => {
  it("a failed add does not drop another add that the server accepted", async () => {
    const ctx = fakeCtx(sampleLibrary([]));
    let failA;
    let succeedB;
    const a = addBookToShelf({ simania_id: 1, title: "א", author: null, year: null, cover_url: null }, "s1", {
      ctx,
      add: () => new Promise((_, reject) => (failA = reject)),
    });
    const b = addBookToShelf({ simania_id: 2, title: "ב", author: null, year: null, cover_url: null }, "s1", {
      ctx,
      add: () => new Promise((resolve) => (succeedB = resolve)),
    });
    await delay(0);
    assert.equal(ctx.getLibrary().shelves[0].books.length, 2);

    failA(new Error("הרשת נפלה"));
    await a;
    const afterFail = ctx.getLibrary().shelves[0].books;
    assert.equal(afterFail.length, 1);
    assert.equal(afterFail[0].simania_id, 2);
    assert.equal(afterFail[0].pending, true);
    assert.equal(afterFail[0].title, "ב");

    succeedB({ book: { simania_id: 2, title: "ב מהשרת", author: "ג" } });
    await b;

    const books = ctx.getLibrary().shelves[0].books;
    assert.deepEqual(
      books.map((x) => [x.simania_id, x.pending]),
      [[2, false]],
    );
    assert.equal(books[0].title, "ב מהשרת");
  });

  it("a successful add still shows the book if its pending row is gone", () => {
    const filled = fillBookFromAddResponse(sampleLibrary([]), "s1", "missing", { simania_id: 5, title: "חדש" });
    assert.equal(filled.shelves[0].books.length, 1);
    assert.equal(filled.shelves[0].books[0].simania_id, 5);
  });
});

describe("the + tile path", () => {
  it("library.js passes the app ctx to open", () => {
    const src = readFileSync(new URL("../../public/js/library.js", import.meta.url), "utf8");
    assert.match(src, /addBook\.open\(shelfId, ctx\)/);
  });

  it("open(shelfId, ctx) makes later adds use that same app ctx", async () => {
    const ctx = fakeCtx(sampleLibrary([]));
    await open("s1", ctx);
    await addBookToShelf({ simania_id: 8, title: "ח", author: null, year: null, cover_url: null }, "s1", {
      add: async () => ({ book: { simania_id: 8, title: "ח מהשרת" } }),
    });
    const books = ctx.getLibrary().shelves[0].books;
    assert.equal(books.length, 1);
    assert.equal(books[0].title, "ח מהשרת");
  });
});
