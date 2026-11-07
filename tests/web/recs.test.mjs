import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { SHELF_KINDS } from "../../public/js/contract.js";
import {
  ENGLISH_ONLY_NOTE,
  LIBRARY_MOVE_LABEL,
  LIBRARY_REMOVE_LABEL,
  RECS_MOVE_LABEL,
  RECS_REMOVE_LABEL,
  addBookRequestForRecommendation,
  applyRecsCardChrome,
  applyRecommendationRefresh,
  bindRecsCardActions,
  buildReasonLine,
  canCompleteRecsWrite,
  hasRecommendationSeeds,
  mapStoredRecommendationRow,
  openRecommendationCard,
  removeRecommendationByWorkId,
  restoreRecsCardChrome,
  revertFailedShelfPick,
  shelfChoicesForAdd,
  shouldShowRecsEmptyState,
  sortRecommendations,
  visibleRecommendations,
  localizeRecommendations,
  localizeFallback,
  recommendationFromApiCard,
  verifyTitleMatch,
} from "../../public/js/recs.js";

const recsCss = readFileSync(new URL("../../public/css/recs.css", import.meta.url), "utf8");

describe("buildReasonLine", () => {
  it("formats one seed title", () => {
    assert.equal(buildReasonLine(["פרנהייט 451"], []), "דומה ל־פרנהייט 451");
  });

  it("formats two seed titles with ו", () => {
    assert.equal(
      buildReasonLine(["א", "ב"], []),
      "דומה ל־א ו־ב",
    );
  });

  it("formats three or more seed titles", () => {
    assert.equal(
      buildReasonLine(["א", "ב", "ג"], []),
      "דומה ל־א, ב ו־ג",
    );
  });

  it("falls back to shared tags", () => {
    assert.equal(buildReasonLine([], ["fantasy", "reflective"]), "fantasy, reflective");
  });

  it("returns empty when no explanation data", () => {
    assert.equal(buildReasonLine([], []), "");
  });
});

describe("recommendation list helpers", () => {
  const sample = [
    { work_id: "b", score: 1, dismissed: false },
    { work_id: "a", score: 2, dismissed: true },
    { work_id: "c", score: 1.5, dismissed: false },
  ];

  it("sortRecommendations orders by score descending", () => {
    const sorted = sortRecommendations(sample);
    assert.deepEqual(sorted.map((r) => r.work_id), ["a", "c", "b"]);
  });

  it("visibleRecommendations drops dismissed rows and keeps the others", () => {
    assert.deepEqual(
      visibleRecommendations(sample).map((r) => r.work_id),
      ["b", "c"],
    );
  });

  it("removeRecommendationByWorkId filters one work", () => {
    const next = removeRecommendationByWorkId(sample, "c");
    assert.deepEqual(next.map((r) => r.work_id), ["b", "a"]);
  });
});

describe("applyRecommendationRefresh", () => {
  const incoming = [
    { work_id: "keep", score: 2, dismissed: false },
    { work_id: "shelved", score: 3, dismissed: false },
    { work_id: "dismissed", score: 4, dismissed: true },
    { work_id: "also-dismissed-locally", score: 1, dismissed: false },
  ];

  it("does not restore works added or dismissed while refresh was in flight", () => {
    let items = incoming.filter((r) => r.work_id !== "dismissed");
    const excluded = new Set();
    items = removeRecommendationByWorkId(items, "shelved");
    excluded.add("shelved");
    items = removeRecommendationByWorkId(items, "also-dismissed-locally");
    excluded.add("also-dismissed-locally");

    const next = applyRecommendationRefresh(incoming, excluded);
    assert.deepEqual(next.map((r) => r.work_id), ["keep"]);
    assert.equal(next.some((r) => r.work_id === "shelved"), false);
  });
});

describe("hasRecommendationSeeds", () => {
  it("is false without reading/read books with work_id", () => {
    const state = {
      displayName: "",
      shelves: [
        { kind: SHELF_KINDS.WANT, books: [{ work_id: "x" }] },
        { kind: SHELF_KINDS.READING, books: [{ work_id: null }] },
      ],
    };
    assert.equal(hasRecommendationSeeds(state), false);
  });

  it("is true when a read shelf book has work_id", () => {
    const state = {
      displayName: "",
      shelves: [{ kind: SHELF_KINDS.READ, books: [{ work_id: "uuid-1" }] }],
    };
    assert.equal(hasRecommendationSeeds(state), true);
  });
});

describe("shouldShowRecsEmptyState", () => {
  it("does not treat a missing in-memory library as empty", () => {
    assert.equal(shouldShowRecsEmptyState(null, false), false);
    assert.equal(shouldShowRecsEmptyState(undefined, false), false);
    assert.equal(shouldShowRecsEmptyState(null, true), false);
  });

  it("is true only after the library is loaded and has no seeds", () => {
    const empty = { displayName: "", shelves: [] };
    assert.equal(shouldShowRecsEmptyState(empty, true), true);
    assert.equal(
      shouldShowRecsEmptyState(
        { displayName: "", shelves: [{ kind: SHELF_KINDS.READ, books: [{ work_id: "w" }] }] },
        true,
      ),
      false,
    );
  });
});

describe("shelfChoicesForAdd", () => {
  it("puts a blank placeholder first so the first shelf emits change", () => {
    const choices = shelfChoicesForAdd([
      { id: "reading", name: "קורא עכשיו" },
      { id: "read", name: "קראתי" },
    ]);
    assert.equal(choices[0].id, "");
    assert.equal(choices[1].id, "reading");
    assert.equal(choices[1].name, "קורא עכשיו");
  });
});

describe("mapStoredRecommendationRow", () => {
  it("maps Hebrew edition fields and because titles", () => {
    const titles = new Map([[10, "ספר א"], [20, "ספר ב"]]);
    const card = mapStoredRecommendationRow(
      {
        work_id: "w1",
        simania_id: 5,
        score: 2,
        because: [10, 20],
        shared_tags: ["fantasy"],
        dismissed: false,
        generated_at: "2026-01-01T00:00:00Z",
        editions: { title: "כותרת", author: "מחבר", cover_url: "https://c" },
      },
      titles,
    );
    assert.equal(card.title, "כותרת");
    assert.equal(card.can_add, true);
    assert.equal(card.english_only, false);
    assert.deepEqual(card.because_titles, ["ספר א", "ספר ב"]);
  });

  it("maps English-only from works", () => {
    const card = mapStoredRecommendationRow(
      {
        work_id: "w2",
        simania_id: null,
        score: 1,
        because: [],
        shared_tags: [],
        dismissed: false,
        generated_at: "2026-01-01T00:00:00Z",
        works: {
          hardcover_id: 123,
          original_title: "Piranesi",
          original_authors: ["Susanna Clarke"],
          hardcover_cover_url: "https://hc",
        },
      },
      new Map(),
    );
    assert.equal(card.english_only, true);
    assert.equal(card.can_add, true);
    assert.equal(card.hardcover_id, 123);
    assert.equal(card.title, "Piranesi");
    assert.equal(card.author, "Susanna Clarke");
    assert.equal(card.cover_url, "https://hc");
  });
});

function createText(text) {
  return { nodeType: 3, textContent: text };
}

function createEl(tag, className = "") {
  const el = {
    tagName: String(tag).toUpperCase(),
    className,
    hidden: false,
    disabled: false,
    textContent: "",
    value: "",
    selected: false,
    childNodes: [],
    children: [],
    firstChild: null,
    parentElement: null,
    dataset: {},
    attrs: {},
    listeners: [],
    ownerDocument: null,
    classList: {
      contains(name) {
        return el.className.split(/\s+/).includes(name);
      },
    },
    setAttribute(name, value) {
      el.attrs[name] = value;
    },
    contains(node) {
      if (node === el) return true;
      return el.childNodes.some((c) => c === node || c.contains?.(node));
    },
    addEventListener(type, fn, opts) {
      el.listeners.push({ type, fn, capture: opts === true || opts?.capture === true });
    },
    removeEventListener(type, fn, opts) {
      const capture = opts === true || opts?.capture === true;
      el.listeners = el.listeners.filter(
        (l) => !(l.type === type && l.fn === fn && l.capture === capture),
      );
    },
    cloneNode() {
      throw new Error("cloneNode must not run on shared card controls");
    },
    replaceWith() {
      throw new Error("replaceWith must not run on shared card controls");
    },
    append(...nodes) {
      for (const node of nodes) {
        node.parentElement = el;
        el.childNodes.push(node);
      }
      syncKids(el);
    },
    insertBefore(node, ref) {
      node.parentElement = el;
      const i = ref ? el.childNodes.indexOf(ref) : -1;
      if (i < 0) el.childNodes.push(node);
      else el.childNodes.splice(i, 0, node);
      syncKids(el);
      return node;
    },
    remove() {
      const p = el.parentElement;
      if (!p) return;
      p.childNodes = p.childNodes.filter((c) => c !== el);
      syncKids(p);
      el.parentElement = null;
    },
    querySelector(sel) {
      return query(el, sel);
    },
  };
  Object.defineProperty(el, "textContent", {
    get() {
      if (el.childNodes.length) {
        return el.childNodes.map((c) => c.textContent ?? "").join("");
      }
      return el._text ?? "";
    },
    set(v) {
      if (el.childNodes.some((c) => c.nodeType === 3) && el.childNodes.some((c) => c.nodeType !== 3)) {
        const tn = el.childNodes.find((c) => c.nodeType === 3);
        if (tn) tn.textContent = v;
        return;
      }
      if (el.childNodes.length && el.childNodes.every((c) => c.nodeType === 3)) {
        el.childNodes = [createText(v)];
        syncKids(el);
        return;
      }
      el._text = v;
    },
    configurable: true,
  });
  el._text = "";
  return el;
}

function syncKids(el) {
  el.children = el.childNodes.filter((c) => c.nodeType !== 3);
  el.firstChild = el.childNodes[0] ?? null;
}

function query(root, sel) {
  const parts = sel.trim().split(/\s+/);
  if (parts.length > 1) {
    const first = query(root, parts[0]);
    return first ? query(first, parts.slice(1).join(" ")) : null;
  }
  if (match(root, sel)) return root;
  for (const child of root.childNodes || []) {
    if (child.nodeType === 3) continue;
    const found = query(child, sel);
    if (found) return found;
  }
  return null;
}

function match(node, sel) {
  if (!node || node.nodeType === 3) return false;
  if (sel.startsWith(".")) return node.className === sel.slice(1);
  return node.tagName === sel.toUpperCase();
}

function createFakeOverlay(shelves = [{ id: "reading", name: "קורא עכשיו" }]) {
  const doc = {
    createElement(tag) {
      const node = createEl(tag);
      node.ownerDocument = doc;
      return node;
    },
  };
  const overlay = createEl("div", "bk");
  overlay.ownerDocument = doc;
  const actions = createEl("div", "bk-actions");
  actions.ownerDocument = doc;
  const moveLabel = createEl("label", "bk-move");
  moveLabel.ownerDocument = doc;
  moveLabel.childNodes.push(createText(` ${LIBRARY_MOVE_LABEL} `));
  const select = createEl("select");
  select.ownerDocument = doc;
  for (const shelf of shelves) {
    const opt = createEl("option");
    opt.ownerDocument = doc;
    opt.value = shelf.id;
    opt.textContent = shelf.name;
    select.append(opt);
  }
  if (select.children[0]) {
    select.children[0].selected = true;
    select.value = select.children[0].value;
  }
  moveLabel.append(select);
  const removeBtn = createEl("button", "bk-remove");
  removeBtn.ownerDocument = doc;
  removeBtn.textContent = LIBRARY_REMOVE_LABEL;
  actions.append(moveLabel, removeBtn);
  overlay.append(actions);
  overlay._select = select;
  overlay._move = moveLabel;
  overlay._remove = removeBtn;
  return overlay;
}

function dispatch(overlay, type, event) {
  for (const l of overlay.listeners.filter((x) => x.type === type && x.capture)) {
    l.fn(event);
  }
}

describe("shared card chrome", () => {
  const rec = {
    work_id: "w1",
    simania_id: 9,
    english_only: false,
    can_add: true,
  };

  it("does not replace card nodes and restores library labels", () => {
    const overlay = createFakeOverlay();
    const select = overlay._select;
    const removeBtn = overlay._remove;
    const session = applyRecsCardChrome(overlay, rec);

    assert.equal(overlay.querySelector(".bk-move select"), select);
    assert.equal(overlay.querySelector(".bk-remove"), removeBtn);
    assert.equal(firstText(overlay._move), RECS_MOVE_LABEL);
    assert.equal(removeBtn.textContent, RECS_REMOVE_LABEL);
    assert.equal(select.childNodes[0].value, "");
    assert.equal(select.value, "");

    restoreRecsCardChrome(session);
    assert.equal(overlay.querySelector(".bk-move select"), select);
    assert.equal(overlay.querySelector(".bk-remove"), removeBtn);
    assert.equal(firstText(overlay._move), LIBRARY_MOVE_LABEL);
    assert.equal(removeBtn.textContent, LIBRARY_REMOVE_LABEL);
    assert.equal(overlay._move.hidden, false);
    assert.equal(overlay.querySelector(".bk-rec-note"), null);
  });

  it("shows the full reason in the card and removes it on restore", () => {
    const overlay = createFakeOverlay();
    const session = applyRecsCardChrome(overlay, {
      ...rec,
      because_titles: ["הנסיך הקטן", "1984", "חוות החיות"],
      shared_tags: [],
    });
    assert.equal(
      overlay.querySelector(".bk-rec-reason")?.textContent,
      "דומה ל־הנסיך הקטן, 1984 ו־חוות החיות",
    );
    restoreRecsCardChrome(session);
    assert.equal(overlay.querySelector(".bk-rec-reason"), null);
  });

  it("shows add-to-shelf for English-only and removes the note on restore", () => {
    const overlay = createFakeOverlay();
    const session = applyRecsCardChrome(overlay, {
      work_id: "en",
      hardcover_id: 123,
      simania_id: null,
      english_only: true,
      can_add: true,
    });
    assert.equal(overlay._move.hidden, false);
    assert.equal(overlay._select.disabled, false);
    assert.equal(overlay._select.childNodes[0].value, "");
    assert.equal(overlay.querySelector(".bk-rec-note")?.textContent, ENGLISH_ONLY_NOTE);
    restoreRecsCardChrome(session);
    assert.equal(overlay._move.hidden, false);
    assert.equal(overlay.querySelector(".bk-rec-note"), null);
    assert.equal(overlay._remove.textContent, LIBRARY_REMOVE_LABEL);
  });

  it("builds the provider-specific add-book payload", () => {
    assert.deepEqual(
      addBookRequestForRecommendation(
        { simania_id: null, hardcover_id: 383752 },
        "want",
      ),
      { hardcover_id: 383752, shelf_id: "want" },
    );
    assert.deepEqual(
      addBookRequestForRecommendation(
        { simania_id: 97171, hardcover_id: 383752 },
        "reading",
      ),
      { simania_id: 97171, shelf_id: "reading" },
    );
  });

  it("posts hardcover_id without Simania data when an English-only card is added", async () => {
    const overlay = createFakeOverlay();
    const calls = [];
    let addedBook;
    let added;
    const addedDone = new Promise((resolve) => { added = resolve; });
    await openRecommendationCard(overlay, {
      work_id: "english-work",
      hardcover_id: 383752,
      simania_id: null,
      title: "Spin",
      author: "Robert Charles Wilson",
      cover_url: null,
      english_only: true,
      can_add: true,
    }, {
      api: {
        callFunction: async (name, body) => {
          calls.push([name, body]);
          return { book: { simania_id: -383752, title: "Spin" } };
        },
        getClient: () => null,
      },
      getLibrary: () => ({ shelves: [{ id: "want", name: "רוצה לקרוא" }] }),
      showToast: () => {},
      card: { open: () => {}, close: () => {} },
      onDismissed: () => {},
      onAdded: async (_workId, _shelfId, book) => {
        addedBook = book;
        added();
      },
      restorePrevious: () => {},
      beginSession: () => {},
      isCurrent: () => true,
    });

    overlay._select.value = "want";
    dispatch(overlay, "change", {
      target: overlay._select,
      stopImmediatePropagation() {},
    });
    await addedDone;
    assert.deepEqual(calls, [[
      "add-book",
      { hardcover_id: 383752, shelf_id: "want" },
    ]]);
    assert.deepEqual(addedBook, { simania_id: -383752, title: "Spin" });
  });

  it("posts simania_id when a localized card is added", async () => {
    const overlay = createFakeOverlay();
    const calls = [];
    let addedBook;
    let added;
    const addedDone = new Promise((resolve) => { added = resolve; });
    await openRecommendationCard(overlay, {
      work_id: "localized-work",
      hardcover_id: 383752,
      simania_id: 97171,
      title: "סחרור",
      author: "רוברט צ'ארלס וילסון",
      cover_url: null,
      english_only: false,
      can_add: true,
    }, {
      api: {
        callFunction: async (name, body) => {
          calls.push([name, body]);
          if (name === "book-details") {
            return { book: { simania_id: 97171, title: "סחרור" } };
          }
          return { book: { simania_id: 97171, title: "סחרור" } };
        },
        getClient: () => null,
      },
      getLibrary: () => ({ shelves: [{ id: "reading", name: "קורא עכשיו" }] }),
      showToast: () => {},
      card: { open: () => {}, close: () => {} },
      onDismissed: () => {},
      onAdded: async (_workId, _shelfId, book) => {
        addedBook = book;
        added();
      },
      restorePrevious: () => {},
      beginSession: () => {},
      isCurrent: () => true,
    });

    overlay._select.value = "reading";
    dispatch(overlay, "change", {
      target: overlay._select,
      stopImmediatePropagation() {},
    });
    await addedDone;
    assert.deepEqual(calls, [
      ["book-details", { simania_id: 97171 }],
      ["add-book", { simania_id: 97171, shelf_id: "reading" }],
    ]);
    assert.deepEqual(addedBook, { simania_id: 97171, title: "סחרור" });
  });

  function bareBookCardDeps(callFunction, overrides = {}) {
    return {
      api: { callFunction, getClient: () => null },
      getLibrary: () => ({ shelves: [] }),
      showToast: () => {},
      card: { open: () => {}, close: () => {} },
      onDismissed: () => {},
      onAdded: async () => {},
      restorePrevious: () => {},
      beginSession: () => {},
      isCurrent: () => true,
      ...overrides,
    };
  }

  const bareRec = {
    work_id: "bare-work",
    hardcover_id: 123,
    simania_id: 1024882,
    title: "Bare Hebrew edition",
    author: "Author",
    cover_url: null,
    english_only: false,
    can_add: true,
  };

  it("enriches a bare positive edition and opens the second book-details result", async () => {
    const overlay = createFakeOverlay();
    const payload = { details: { title: bareRec.title }, rating: { rating: 4.2 } };
    const firstBook = {
      simania_id: bareRec.simania_id,
      title: bareRec.title,
      cover_url: null,
      description: null,
      simania_rating: null,
    };
    const enrichedBook = { ...firstBook, cover_url: "https://example.test/hebrew-cover.jpg" };
    const calls = [];
    const opened = [];
    const deps = bareBookCardDeps(async (name, body) => {
      calls.push([name, body]);
      return { book: calls.length === 1 ? firstBook : enrichedBook };
    }, {
      fetchPayload: async (simaniaId) => {
        assert.equal(simaniaId, bareRec.simania_id);
        return payload;
      },
      card: { open: (book) => opened.push(book), close: () => {} },
    });

    await openRecommendationCard(overlay, bareRec, deps);

    assert.deepEqual(calls, [
      ["book-details", { simania_id: bareRec.simania_id }],
      ["book-details", { simania_id: bareRec.simania_id, simania: payload }],
    ]);
    assert.deepEqual(opened, [enrichedBook]);
  });

  it("does not fetch Simania when book-details returns any display detail", async () => {
    const overlay = createFakeOverlay();
    const calls = [];
    let payloadFetches = 0;
    const book = {
      simania_id: bareRec.simania_id,
      title: bareRec.title,
      cover_url: "https://example.test/existing-cover.jpg",
      description: null,
      simania_rating: null,
    };
    const deps = bareBookCardDeps(async (name, body) => {
      calls.push([name, body]);
      return { book };
    }, {
      fetchPayload: async () => {
        payloadFetches += 1;
        return null;
      },
    });

    await openRecommendationCard(overlay, bareRec, deps);

    assert.equal(payloadFetches, 0);
    assert.deepEqual(calls, [["book-details", { simania_id: bareRec.simania_id }]]);
  });

  it("opens the first result silently when browser-side Simania fetch fails", async () => {
    const overlay = createFakeOverlay();
    const firstBook = {
      simania_id: bareRec.simania_id,
      title: bareRec.title,
      cover_url: null,
      description: null,
      simania_rating: null,
    };
    const opened = [];
    const toasts = [];
    const deps = bareBookCardDeps(async () => ({ book: firstBook }), {
      fetchPayload: async () => { throw new Error("Simania unavailable"); },
      showToast: (message) => toasts.push(message),
      card: { open: (book) => opened.push(book), close: () => {} },
    });

    await openRecommendationCard(overlay, bareRec, deps);

    assert.deepEqual(opened, [firstBook]);
    assert.deepEqual(toasts, []);
  });

  it("does not open a replaced card while its Simania payload is loading", async () => {
    const overlay = createFakeOverlay();
    const firstBook = {
      simania_id: bareRec.simania_id,
      title: bareRec.title,
      cover_url: null,
      description: null,
      simania_rating: null,
    };
    let current = true;
    let resolvePayload;
    let payloadStarted;
    const started = new Promise((resolve) => { payloadStarted = resolve; });
    const payloadPending = new Promise((resolve) => { resolvePayload = resolve; });
    const opened = [];
    const deps = bareBookCardDeps(async () => ({ book: firstBook }), {
      fetchPayload: async () => {
        payloadStarted();
        return payloadPending;
      },
      isCurrent: () => current,
      card: { open: (book) => opened.push(book), close: () => {} },
    });

    const opening = openRecommendationCard(overlay, bareRec, deps);
    await started;
    current = false;
    resolvePayload({ details: { title: bareRec.title }, rating: null });
    await opening;

    assert.deepEqual(opened, []);
  });

  function reusableCardDeps(calls, onAdded) {
    let session = null;
    return {
      api: {
        callFunction: async (name, body) => {
          calls.push([name, body]);
          return { book: { simania_id: body.simania_id ?? -body.hardcover_id, title: "Spin" } };
        },
        getClient: () => ({
          from() {
            calls.push(["dismiss"]);
            return { update: () => ({ eq: async () => ({ error: null }) }) };
          },
        }),
      },
      getLibrary: () => ({ shelves: [{ id: "want", name: "רוצה לקרוא" }] }),
      showToast: () => {},
      card: { open: () => {}, close: () => {} },
      onDismissed: () => calls.push(["onDismissed"]),
      onAdded,
      restorePrevious: () => restoreRecsCardChrome(session),
      beginSession: (s) => {
        session = s;
      },
      isCurrent: () => true,
      session: () => session,
    };
  }

  const genreItem = {
    work_id: "genre-work",
    hardcover_id: 383752,
    simania_id: null,
    title: "Spin",
    author: "Robert Charles Wilson",
    cover_url: null,
    english_only: true,
    can_add: true,
  };

  it("allowDismiss: false hides the dismiss button, ignores it, and restores it", async () => {
    const overlay = createFakeOverlay();
    const calls = [];
    const deps = reusableCardDeps(calls, async () => {});
    await openRecommendationCard(overlay, genreItem, deps, { allowDismiss: false });
    assert.equal(overlay._remove.hidden, true);
    assert.equal(overlay._move.hidden, false);
    dispatch(overlay, "click", {
      target: overlay._remove,
      stopImmediatePropagation() {},
      preventDefault() {},
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls.some(([name]) => name === "dismiss" || name === "onDismissed"), false);
    restoreRecsCardChrome(deps.session());
    assert.equal(overlay._remove.hidden, false);
    assert.equal(overlay._remove.textContent, LIBRARY_REMOVE_LABEL);
  });

  it("the recommendations path still shows the dismiss button by default", async () => {
    const overlay = createFakeOverlay();
    const calls = [];
    await openRecommendationCard(overlay, genreItem, reusableCardDeps(calls, async () => {}));
    assert.equal(overlay._remove.hidden, false);
    assert.equal(overlay._remove.textContent, RECS_REMOVE_LABEL);
    assert.deepEqual(calls, [], "English-only recommendation cards open without book-details");
  });

  it("the reusable path adds an English-only item by hardcover_id", async () => {
    const overlay = createFakeOverlay([{ id: "want", name: "רוצה לקרוא" }]);
    const calls = [];
    let added;
    const addedDone = new Promise((resolve) => { added = resolve; });
    const deps = reusableCardDeps(calls, async (workId, shelfId) => added([workId, shelfId]));
    await openRecommendationCard(overlay, genreItem, deps, { allowDismiss: false, englishDetails: true });
    overlay._select.value = "want";
    dispatch(overlay, "change", { target: overlay._select, stopImmediatePropagation() {} });
    assert.deepEqual(await addedDone, ["genre-work", "want"]);
    assert.deepEqual(calls, [
      ["book-details", { simania_id: -383752 }],
      ["add-book", { hardcover_id: 383752, shelf_id: "want" }],
    ]);
  });

  it("recs.css hides [hidden] .bk-move despite display:flex in base", () => {
    assert.match(recsCss, /\.bk-move\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
  });

  it("recs covers use the same --per / --gap flex basis as shelf tiles", () => {
    assert.match(recsCss, /--per:\s*6\.5/);
    assert.match(recsCss, /max-width:\s*900px\)[\s\S]*--per:\s*4\.5/);
    assert.match(recsCss, /max-width:\s*560px\)[\s\S]*--per:\s*3\.5/);
    assert.match(
      recsCss,
      /flex:\s*0 0 calc\(\(100% - var\(--gap\) \* \(var\(--per\) - \.5\)\) \/ var\(--per\)\)/,
    );
    assert.equal(/minmax\(\s*108px/i.test(recsCss), false);
    assert.equal(/minmax\(\s*128px/i.test(recsCss), false);
  });

  it("revertFailedShelfPick clears the chosen shelf so the same option can retry", () => {
    const overlay = createFakeOverlay();
    applyRecsCardChrome(overlay, rec);
    overlay._select.value = "reading";
    overlay._select.disabled = true;
    revertFailedShelfPick(overlay._select);
    assert.equal(overlay._select.disabled, false);
    assert.equal(overlay._select.value, "");
    assert.equal(overlay._select.childNodes[0].selected, true);
  });

  it("canCompleteRecsWrite ignores a restored or stale card session", () => {
    const overlay = createFakeOverlay();
    const session = applyRecsCardChrome(overlay, rec);
    assert.equal(canCompleteRecsWrite(session, true), true);
    assert.equal(canCompleteRecsWrite(session, false), false);
    restoreRecsCardChrome(session);
    assert.equal(canCompleteRecsWrite(session, true), false);
  });

  it("lets the same shelf be chosen again after a failed add", () => {
    const overlay = createFakeOverlay();
    const session = applyRecsCardChrome(overlay, rec);
    const picked = [];
    bindRecsCardActions(session, rec, {
      onPickShelf: (id) => picked.push(id),
      onDismiss: () => {},
    });
    overlay._select.value = "reading";
    dispatch(overlay, "change", {
      target: overlay._select,
      stopImmediatePropagation() {},
    });
    assert.deepEqual(picked, ["reading"]);
    revertFailedShelfPick(overlay._select);
    overlay._select.value = "reading";
    dispatch(overlay, "change", {
      target: overlay._select,
      stopImmediatePropagation() {},
    });
    assert.deepEqual(picked, ["reading", "reading"]);
  });

  it("fires add for the first shelf after the placeholder, and dismiss", () => {
    const overlay = createFakeOverlay();
    const session = applyRecsCardChrome(overlay, rec);
    const picked = [];
    let dismissed = 0;
    bindRecsCardActions(session, rec, {
      onPickShelf: (id) => picked.push(id),
      onDismiss: () => {
        dismissed += 1;
      },
    });

    overlay._select.value = "";
    dispatch(overlay, "change", {
      target: overlay._select,
      stopImmediatePropagation() {
        this.stopped = true;
      },
    });
    assert.deepEqual(picked, []);

    overlay._select.value = "reading";
    const change = {
      target: overlay._select,
      stopped: false,
      stopImmediatePropagation() {
        this.stopped = true;
      },
    };
    dispatch(overlay, "change", change);
    assert.deepEqual(picked, ["reading"]);
    assert.equal(change.stopped, true);

    const click = {
      target: overlay._remove,
      stopped: false,
      stopImmediatePropagation() {
        this.stopped = true;
      },
      preventDefault() {},
    };
    dispatch(overlay, "click", click);
    assert.equal(dismissed, 1);

    restoreRecsCardChrome(session);
    overlay._select.value = "reading";
    dispatch(overlay, "change", {
      target: overlay._select,
      stopImmediatePropagation() {},
    });
    assert.deepEqual(picked, ["reading"]);
  });
});

function firstText(el) {
  const node = el.childNodes.find((c) => c.nodeType === 3 && String(c.textContent).trim());
  return String(node?.textContent ?? "").trim();
}

describe("localizeRecommendations author path", () => {
  const base = (workId, extra = {}) => ({
    work_id: workId,
    title: "Spin",
    english_only: true,
    can_add: false,
    hebrew_hint: null,
    hebrew_author: null,
    ...extra,
  });

  it("does not use the author path when the title match succeeds", async () => {
    const sent = [];
    await localizeRecommendations([
      base("w1", {
        hebrew_hint: { source: "wikidata", title: "סחרור", author: wilsonAuthor() },
        hebrew_author: wilsonAuthor(),
      }),
    ], {
      match: async () => ({ id: 97171, title: "סחרור", author: wilsonAuthor() }),
      searchByAuthor: async () => assert.fail("author search must not run"),
      fetchPayload: async () => ({ details: { title: "סחרור" }, rating: null }),
      callFunction: async (name, body) => {
        sent.push([name, body]);
        return { simania_id: body.simania_id, title: "סחרור", author: null, cover_url: null };
      },
      onLinked: () => {},
      isCurrent: () => true,
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0][0], "link-edition");
    assert.deepEqual(sent[0][1].source, "wikidata");
    assert.equal(sent.some(([name]) => name === "hebrew-candidates"), false);
  });

  it("links a mismatched title result only when match-by-author confirms it", async () => {
    const sent = [];
    await localizeRecommendations([
      base("verified", {
        hebrew_hint: { source: "nli", title: "title", author: "hint author" },
        hebrew_author: "expected author",
      }),
    ], {
      match: async () => ({ id: 42, title: "title", author: "different author" }),
      searchByAuthor: async () => assert.fail("author search must not run"),
      fetchPayload: async () => ({ details: { title: "title" }, rating: null }),
      callFunction: async (name, body) => {
        sent.push([name, body]);
        if (name === "match-by-author") return { simania_id: 42, resolve_status: "wikidata" };
        return { simania_id: 42, title: "title", author: null, cover_url: null };
      },
      onLinked: () => {},
      isCurrent: () => true,
    });

    assert.deepEqual(sent[0], [
      "match-by-author",
      {
        work_id: "verified",
        candidates: [{ simania_id: 42, title: "title", author: "different author" }],
      },
    ]);
    assert.equal(sent[1][0], "link-edition");
    assert.equal(sent[1][1].source, "wikidata");
  });

  it("falls through to the author path when title verification rejects the book", async () => {
    const sent = [];
    const candidates = [{ simania_id: 71, title: "right title", author: "expected author" }];
    await localizeRecommendations([
      base("fallback", {
        hebrew_hint: { source: "nli", title: "wrong title", author: null },
        hebrew_author: "expected author",
      }),
    ], {
      match: async () => ({ id: 99, title: "wrong title", author: "different author" }),
      searchByAuthor: async () => candidates,
      fetchPayload: async () => ({ details: { title: "right title" }, rating: null }),
      callFunction: async (name, body) => {
        sent.push([name, body]);
        if (name === "match-by-author" && body.candidates[0].simania_id === 99) {
          return { simania_id: null, resolve_status: null };
        }
        if (name === "match-by-author") return { simania_id: 71, resolve_status: "wikidata" };
        return { simania_id: 71, title: "right title", author: "expected author", cover_url: null };
      },
      onLinked: () => {},
      isCurrent: () => true,
    });

    assert.deepEqual(sent[0][1].candidates, [
      { simania_id: 99, title: "wrong title", author: "different author" },
    ]);
    assert.deepEqual(sent[1], ["match-by-author", { work_id: "fallback", candidates }]);
    assert.equal(sent[2][0], "link-edition");
  });

  it("lets match-by-author decide title matches without hebrew_author", async () => {
    const sent = [];
    await localizeRecommendations([
      base("no-author", {
        hebrew_hint: { source: "wikidata", title: "title", author: null },
      }),
    ], {
      match: async () => ({ id: 8, title: "title" }),
      searchByAuthor: async () => assert.fail("author search must not run"),
      fetchPayload: async () => ({ details: { title: "title" }, rating: null }),
      callFunction: async (name, body) => {
        sent.push([name, body]);
        if (name === "match-by-author") return { simania_id: 8, resolve_status: "fuzzy" };
        return { simania_id: 8, title: "title", author: null, cover_url: null };
      },
      onLinked: () => {},
      isCurrent: () => true,
    });

    assert.deepEqual(sent[0], [
      "match-by-author",
      { work_id: "no-author", candidates: [{ simania_id: 8, title: "title", author: null }] },
    ]);
    assert.equal(sent[1][1].source, "nli");
  });

  it("runs match-by-author then link-edition when the title misses", async () => {
    const sent = [];
    const linked = [];
    const candidates = [{ simania_id: 97171, title: "סחרור", author: wilsonAuthor() }];
    await localizeRecommendations([
      base("w2", {
        hebrew_hint: { source: "nli", title: "סחרור", author: wilsonAuthor() },
        hebrew_author: wilsonAuthor(),
      }),
    ], {
      match: async () => null,
      searchByAuthor: async () => candidates,
      fetchPayload: async () => ({ details: { title: "סחרור" }, rating: null }),
      callFunction: async (name, body) => {
        sent.push([name, body]);
        if (name === "match-by-author") {
          return { simania_id: 97171, resolve_status: "wikidata" };
        }
        return { simania_id: 97171, title: "סחרור", author: wilsonAuthor(), cover_url: null };
      },
      onLinked: (workId, patch) => linked.push([workId, patch]),
      isCurrent: () => true,
    });
    assert.deepEqual(sent[0], ["match-by-author", { work_id: "w2", candidates }]);
    assert.deepEqual(sent[1][0], "link-edition");
    assert.equal(sent[1][1].source, "wikidata");
    assert.deepEqual(linked, [["w2", { simania_id: 97171, title: "סחרור", author: wilsonAuthor(), cover_url: null }]]);
  });

  it("skips link-edition when match-by-author returns null", async () => {
    const sent = [];
    await localizeRecommendations([
      base("w3", { hebrew_author: wilsonAuthor() }),
    ], {
      match: async () => null,
      searchByAuthor: async () => [{ simania_id: 1, title: "ס", author: "א" }],
      fetchPayload: async () => assert.fail("must not fetch"),
      callFunction: async (name) => {
        sent.push(name);
        return { simania_id: null, resolve_status: null };
      },
      onLinked: () => assert.fail("must not link"),
      isCurrent: () => true,
    });
    assert.deepEqual(sent, ["match-by-author", "hebrew-candidates"]);
  });

  it("localizes a card with only hebrew_author", async () => {
    const sent = [];
    await localizeRecommendations([base("w4", { hebrew_author: wilsonAuthor() })], {
      match: async () => assert.fail("title match must not run without hint"),
      searchByAuthor: async () => [{ simania_id: 7, title: "ס", author: wilsonAuthor() }],
      fetchPayload: async () => ({ details: { title: "ס" }, rating: null }),
      callFunction: async (name, body) => {
        sent.push(name);
        if (name === "match-by-author") return { simania_id: 7, resolve_status: "nli" };
        return { simania_id: 7, title: "ס", author: null, cover_url: null };
      },
      onLinked: () => {},
      isCurrent: () => true,
    });
    assert.deepEqual(sent, ["match-by-author", "link-edition"]);
  });

  it("maps fuzzy resolve_status to nli for link-edition", async () => {
    const sent = [];
    await localizeRecommendations([base("w5", { hebrew_author: wilsonAuthor() })], {
      match: async () => null,
      searchByAuthor: async () => [{ simania_id: 9, title: "ס", author: wilsonAuthor() }],
      fetchPayload: async () => ({ details: { title: "ס" }, rating: null }),
      callFunction: async (name, body) => {
        sent.push([name, body]);
        if (name === "match-by-author") return { simania_id: 9, resolve_status: "fuzzy" };
        return { simania_id: 9, title: "ס", author: null, cover_url: null };
      },
      onLinked: () => {},
      isCurrent: () => true,
    });
    assert.equal(sent[1][0], "link-edition");
    assert.equal(sent[1][1].source, "nli");
  });
});

describe("catalog fallback localization", () => {
  const rec = (extra = {}) => ({
    work_id: "fallback-work",
    simania_id: null,
    title: "Aurora",
    author: "Kim Stanley Robinson",
    english_only: true,
    can_add: false,
    hebrew_hint: null,
    hebrew_author: null,
    ...extra,
  });

  const candidateResponse = (candidates, english_names = []) => ({
    work_id: "fallback-work",
    candidates,
    english_names,
  });

  it("links a single rule-A winner with nli_author", async () => {
    const calls = [];
    const linked = [];
    await localizeRecommendations([rec()], {
      match: async () => assert.fail("no title hint"),
      searchByAuthor: async () => assert.fail("no Hebrew author"),
      searchBooks: async () => [{ id: 701, title: "אורורה", author: "קים סטנלי רובינסון" }],
      fetchPayload: async () => ({ details: { title: "אורורה" }, rating: null }),
      callFunction: async (name, body) => {
        calls.push([name, body]);
        if (name === "hebrew-candidates") {
          return candidateResponse([{ title: "אורורה", author: "קים סטנלי רובינסון", rule: "A" }]);
        }
        return { simania_id: 701, title: "אורורה", author: "קים סטנלי רובינסון", cover_url: null };
      },
      onLinked: (workId, patch) => linked.push([workId, patch]),
      isCurrent: () => true,
    });

    assert.equal(calls[0][0], "hebrew-candidates");
    assert.equal(calls[1][0], "link-edition");
    assert.equal(calls[1][1].source, "nli_author");
    assert.equal(calls[1][1].simania_id, 701);
    assert.equal(linked[0][1].simania_id, 701);
  });

  it("does not decide when one rule-A tier finds two Simania IDs", async () => {
    const result = await localizeFallback(rec(), {
      callFunction: async () => candidateResponse([
        { title: "ראשון", author: "קים סטנלי רובינסון", rule: "A" },
        { title: "שני", author: "קים סטנלי רובינסון", rule: "A" },
      ]),
      searchBooks: async (query) => query.startsWith("ראשון")
        ? [{ id: 11, title: "ראשון", author: "קים סטנלי רובינסון" }]
        : [{ id: 22, title: "שני", author: "קים סטנלי רובינסון" }],
      isCurrent: () => true,
    });
    assert.equal(result, null);
  });

  it("rejects rule E when the Simania author does not sound like the English author", async () => {
    const result = await localizeFallback(rec(), {
      callFunction: async () => candidateResponse([
        { title: "כיבוי אורות", author: null, rule: "E" },
      ]),
      searchBooks: async () => [{ id: 1013521, title: "כיבוי אורות", author: "דיוויד קופ" }],
      isCurrent: () => true,
    });
    assert.equal(result, null);
  });

  it("uses rule-G name hits only for a unique winner with at least two hits", async () => {
    const candidates = [
      { title: "ספר ראשון", author: "קים סטנלי רובינסון", rule: "G" },
      { title: "ספר שני", author: "קים סטנלי רובינסון", rule: "G" },
      { title: "ספר שלישי", author: "קים סטנלי רובינסון", rule: "G" },
    ];
    const books = new Map([
      ["ספר ראשון", { id: 31, title: "ספר ראשון", author: "קים סטנלי רובינסון" }],
      ["ספר שני", { id: 32, title: "ספר שני", author: "קים סטנלי רובינסון" }],
      ["ספר שלישי", { id: 33, title: "ספר שלישי", author: "קים סטנלי רובינסון" }],
    ]);
    const descriptions = new Map([
      [31, "אליס בוב דיוויד"],
      [32, "אליס"],
      [33, "בלי התאמות"],
    ]);
    let reads = 0;
    const deps = {
      callFunction: async () => candidateResponse(candidates, ["Alice", "Bob", "David"]),
      searchBooks: async (query) => [books.get([...books.keys()].find((title) => query.startsWith(title)))].filter(Boolean),
      fetchPayload: async (id) => {
        reads++;
        return { details: { description: descriptions.get(id) } };
      },
      isCurrent: () => true,
    };
    assert.equal(await localizeFallback(rec(), deps), 31);
    assert.equal(reads, 3);

    descriptions.set(31, "אליס בוב");
    descriptions.set(32, "טרישה איתן");
    assert.equal(await localizeFallback(rec(), {
      ...deps,
      callFunction: async () => candidateResponse(candidates, [
        "Alice",
        "Bob",
        "Tricia",
        "Ethan",
      ]),
    }), null, "2-2 distinctive tie");

    assert.equal(await localizeFallback(rec(), {
      ...deps,
      callFunction: async () => candidateResponse([candidates[0]], ["Alice"]),
      fetchPayload: async () => ({ details: { description: "אליס" } }),
    }), null, "one hit is insufficient");
  });

  it("does not link Pretty Girls when only Atlanta is distinctive", async () => {
    const candidates = [
      { title: "ספר א", author: "קארין סלוטר", rule: "G" },
      { title: "ספר ב", author: "קארין סלוטר", rule: "G" },
    ];
    const descriptions = new Map([
      [61, "ג'וליה ואטלנטה"],
      [62, "ג'וליה"],
    ]);
    const result = await localizeFallback(rec({ author: "Karin Slaughter" }), {
      callFunction: async () => candidateResponse(candidates, ["Julia", "Atlanta"]),
      searchBooks: async (query) => query.startsWith("ספר א")
        ? [{ id: 61, title: "ספר א", author: "קארין סלוטר" }]
        : [{ id: 62, title: "ספר ב", author: "קארין סלוטר" }],
      fetchPayload: async (id) => ({ details: { description: descriptions.get(id) } }),
      isCurrent: () => true,
    });
    assert.equal(result, null);
  });

  it("does not link Lathe when every edition shares Orr and Haber", async () => {
    const candidates = ["א", "ב", "ג"].map((suffix) => ({
      title: `ספר ${suffix}`,
      author: "אורסולה לה גווין",
      rule: "G",
    }));
    const result = await localizeFallback(rec({ author: "Ursula K. Le Guin" }), {
      callFunction: async () => candidateResponse(candidates, ["Orr", "Haber"]),
      searchBooks: async (query) => {
        const index = candidates.findIndex(({ title }) => query.startsWith(title));
        return [{ id: 71 + index, title: candidates[index].title, author: "אורסולה לה גווין" }];
      },
      fetchPayload: async () => ({ details: { description: "אור והאבר" } }),
      isCurrent: () => true,
    });
    assert.equal(result, null);
  });

  it("links Never Lie when Tricia and Ethan are distinctive", async () => {
    const candidates = ["א", "ב", "ג"].map((suffix) => ({
      title: `ספר ${suffix}`,
      author: "פרידה מקפדן",
      rule: "G",
    }));
    const result = await localizeFallback(rec({ author: "Freida McFadden" }), {
      callFunction: async () => candidateResponse(candidates, ["Tricia", "Ethan"]),
      searchBooks: async (query) => {
        const index = candidates.findIndex(({ title }) => query.startsWith(title));
        return [{ id: 81 + index, title: candidates[index].title, author: "פרידה מקפדן" }];
      },
      fetchPayload: async (id) => ({
        details: { description: id === 81 ? "טרישה ואית׳ן" : "בלי שמות" },
      }),
      isCurrent: () => true,
    });
    assert.equal(result, 81);
  });

  it("reuses the winning rule-G payload when linking", async () => {
    let reads = 0;
    const linked = [];
    await localizeRecommendations([rec()], {
      searchBooks: async () => [{ id: 41, title: "ספר", author: "קים סטנלי רובינסון" }],
      fetchPayload: async () => {
        reads++;
        return { details: { title: "ספר", description: "אליס בוב" }, rating: null };
      },
      callFunction: async (name, body) => name === "hebrew-candidates"
        ? candidateResponse([{ title: "ספר", author: "קים סטנלי רובינסון", rule: "G" }], ["Alice", "Bob"])
        : { simania_id: body.simania_id, title: "ספר", author: null, cover_url: null },
      onLinked: (...args) => linked.push(args),
      isCurrent: () => true,
    });
    assert.equal(reads, 1);
    assert.equal(linked.length, 1);
  });

  it("leaves the card English-only when link-edition returns 409", async () => {
    const linked = [];
    const previousWarn = console.warn;
    console.warn = () => {};
    try {
      await localizeRecommendations([rec()], {
        searchBooks: async () => [{ id: 51, title: "אורורה", author: "קים סטנלי רובינסון" }],
        fetchPayload: async () => ({ details: { title: "אורורה" }, rating: null }),
        callFunction: async (name) => {
          if (name === "hebrew-candidates") {
            return candidateResponse([{ title: "אורורה", author: "קים סטנלי רובינסון", rule: "A" }]);
          }
          const error = new Error("conflict");
          error.status = 409;
          throw error;
        },
        onLinked: (...args) => linked.push(args),
        isCurrent: () => true,
      });
    } finally {
      console.warn = previousWarn;
    }
    assert.deepEqual(linked, []);
  });

  it("sends a card with neither hint nor Hebrew author to hebrew-candidates", async () => {
    const calls = [];
    await localizeRecommendations([rec()], {
      callFunction: async (name) => {
        calls.push(name);
        return candidateResponse([]);
      },
      onLinked: () => assert.fail("must not link"),
      isCurrent: () => true,
    });
    assert.deepEqual(calls, ["hebrew-candidates"]);
  });

  it("never sends a card that already has a Hebrew edition to the fallback", async () => {
    let calls = 0;
    await localizeRecommendations([rec({ simania_id: 99, english_only: false })], {
      callFunction: async () => { calls++; },
      onLinked: () => assert.fail("must not link"),
      isCurrent: () => true,
    });
    assert.equal(calls, 0);
  });

  it("caps each card at 12 searches and 6 detail reads", async () => {
    const candidates = Array.from({ length: 6 }, (_, index) => ({
      title: `ספר ${index + 1}`,
      author: "קים סטנלי רובינסון",
      rule: "G",
    }));
    let searches = 0;
    let reads = 0;
    await localizeFallback(rec(), {
      callFunction: async () => candidateResponse(candidates, []),
      searchBooks: async (query) => {
        searches++;
        const exact = candidates.find((candidate) => candidate.title === query);
        return exact
          ? [{ id: Number(query.split(" ").pop()) + 100, title: exact.title, author: exact.author }]
          : [];
      },
      fetchPayload: async () => {
        reads++;
        return { details: { description: "" } };
      },
      isCurrent: () => true,
    });
    assert.equal(searches, 12);
    assert.equal(reads, 6);
  });
});

describe("verifyTitleMatch", () => {
  it("accepts a matching hebrew_author without a server call", async () => {
    let calls = 0;
    const result = await verifyTitleMatch(
      {
        work_id: "work",
        hebrew_hint: { source: "nli", title: "title", author: null },
        hebrew_author: "same author",
      },
      { id: 7, title: "title", author: "same author" },
      { callFunction: async () => { calls += 1; } },
    );

    assert.equal(calls, 0);
    assert.deepEqual(result, { simania_id: 7, resolve_status: "nli" });
  });
});

function wilsonAuthor() {
  return "רוברט צ'ארלס וילסון";
}

describe("recommendationFromApiCard hebrew_author", () => {
  it("keeps hebrew_author on English-only cards", () => {
    const card = recommendationFromApiCard({
      work_id: "w",
      simania_id: null,
      title: "Spin",
      hebrew_author: wilsonAuthor(),
    });
    assert.equal(card.hebrew_author, wilsonAuthor());
  });

  it("clears hebrew_author when simania_id is set", () => {
    const card = recommendationFromApiCard({
      work_id: "w",
      simania_id: 1,
      title: "ס",
      hebrew_author: wilsonAuthor(),
    });
    assert.equal(card.hebrew_author, null);
  });
});
