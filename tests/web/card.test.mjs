import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCard } from "../../public/js/card.js";

function element() {
  return {
    textContent: "",
    innerHTML: "",
    hidden: false,
    attrs: {},
    style: {},
    classList: {
      add() {},
      remove() {},
      contains() { return false; },
      toggle() {},
    },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    querySelectorAll() { return []; },
    focus() {},
  };
}

function setupCard() {
  const nodes = new Map([
    [".bk-cover", element()],
    [".bk-title", element()],
    [".bk-author", element()],
    [".bk-shelf", element()],
    [".bk-rating", element()],
    [".bk-meta", element()],
    [".bk-desc", element()],
    [".bk-body", element()],
    [".bk-card", element()],
    [".bk-x", element()],
  ]);
  const overlay = element();
  overlay.querySelector = (selector) => nodes.get(selector) ?? null;
  overlay.addEventListener = () => {};

  const previousDocument = globalThis.document;
  const previousAddEventListener = globalThis.addEventListener;
  globalThis.document = { body: { style: {} } };
  globalThis.addEventListener = () => {};

  const card = createCard(overlay, {
    api: { getClient: () => { throw new Error("not used"); } },
    data: {},
    showToast() {},
    async onLibraryChange() {},
  });

  return {
    card,
    nodes,
    restore() {
      globalThis.document = previousDocument;
      globalThis.addEventListener = previousAddEventListener;
    },
  };
}

function book(patch = {}) {
  return {
    simania_id: 123,
    title: "כותרת",
    author: "מחבר",
    description: "תיאור",
    simania_rating: 4.2,
    simania_rating_count: 10,
    shelf_id: null,
    ...patch,
  };
}

describe("book card editions", () => {
  it("uses Hardcover labels and automatic text direction for an English edition", () => {
    const { card, nodes, restore } = setupCard();
    try {
      card.open(book({
        simania_id: -383752,
        english_edition: true,
        title: "Spin",
        author: "Robert Charles Wilson",
        description: "A science-fiction novel.",
      }), []);

      assert.match(nodes.get(".bk-rating").innerHTML, /דירוגים ב־Hardcover/);
      assert.equal(nodes.get(".bk-title").attrs.dir, "auto");
      assert.equal(nodes.get(".bk-author").attrs.dir, "auto");
      assert.equal(nodes.get(".bk-desc").attrs.dir, "auto");
    } finally {
      restore();
    }
  });

  it("uses the Hardcover empty state", () => {
    const { card, nodes, restore } = setupCard();
    try {
      card.open(book({ simania_id: -383752, simania_rating_count: 0 }), []);
      assert.equal(
        nodes.get(".bk-rating").innerHTML,
        "<small>אין עדיין דירוגים ב־Hardcover</small>",
      );
    } finally {
      restore();
    }
  });

  it("keeps the Simania label for a normal edition", () => {
    const { card, nodes, restore } = setupCard();
    try {
      card.open(book(), []);
      assert.match(nodes.get(".bk-rating").innerHTML, /דירוגים בסימניה/);
      assert.doesNotMatch(nodes.get(".bk-rating").innerHTML, /Hardcover/);
    } finally {
      restore();
    }
  });

  it("keeps the Simania empty state for a normal edition", () => {
    const { card, nodes, restore } = setupCard();
    try {
      card.open(book({ simania_rating_count: 0 }), []);
      assert.equal(
        nodes.get(".bk-rating").innerHTML,
        "<small>אין עדיין דירוגים בסימניה</small>",
      );
    } finally {
      restore();
    }
  });

  it("recognizes negative simania_id as an English edition without explicit flag", () => {
    const { card, nodes, restore } = setupCard();
    try {
      card.open(book({
        simania_id: -123,
        title: "Spin",
        author: "Robert Charles Wilson",
      }), []);
      assert.match(nodes.get(".bk-rating").innerHTML, /דירוגים ב־Hardcover/);
      assert.equal(nodes.get(".bk-title").attrs.dir, "auto");
      assert.equal(nodes.get(".bk-author").attrs.dir, "auto");
      assert.equal(nodes.get(".bk-desc").attrs.dir, "auto");
    } finally {
      restore();
    }
  });
});
