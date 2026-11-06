import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCard } from "../../public/js/card.js";

function element() {
  const classes = new Set();
  const listeners = new Map();
  return {
    textContent: "",
    innerHTML: "",
    hidden: false,
    attrs: {},
    style: { transform: "" },
    scrollTop: 0,
    children: [],
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        if (force === true || (force === undefined && !classes.has(name))) classes.add(name);
        else if (force === false || force === undefined) classes.delete(name);
      },
    },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    querySelectorAll() { return []; },
    replaceChildren(...children) { this.children = children; },
    append(child) { this.children.push(child); },
    addEventListener(type, handler, options = {}) {
      const entries = listeners.get(type) ?? [];
      entries.push({ handler, once: Boolean(options.once) });
      listeners.set(type, entries);
    },
    dispatch(type, event = {}) {
      event.target ??= this;
      for (const entry of [...(listeners.get(type) ?? [])]) {
        entry.handler(event);
        if (entry.once) {
          listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== entry));
        }
      }
    },
    focus() {},
  };
}

function setupCard({ phone = true, reducedMotion = false } = {}) {
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
    [".bk-move select", element()],
  ]);
  const overlay = element();
  overlay.querySelector = (selector) => nodes.get(selector) ?? null;

  const previousDocument = globalThis.document;
  const previousAddEventListener = globalThis.addEventListener;
  const previousMatchMedia = globalThis.matchMedia;
  globalThis.document = { body: { style: {} } };
  globalThis.addEventListener = () => {};
  globalThis.matchMedia = (query) => ({
    matches: query.includes("max-width") ? phone : reducedMotion,
  });

  const card = createCard(overlay, {
    api: { getClient: () => { throw new Error("not used"); } },
    data: {},
    showToast() {},
    async onLibraryChange() {},
  });

  return {
    card,
    nodes,
    overlay,
    restore() {
      globalThis.document = previousDocument;
      globalThis.addEventListener = previousAddEventListener;
      globalThis.matchMedia = previousMatchMedia;
    },
  };
}

function touch(identifier, clientX, clientY) {
  return { identifier, clientX, clientY };
}

function touchEvent({ touches = [], changedTouches = [], timeStamp = 0, target } = {}) {
  return {
    touches,
    changedTouches,
    timeStamp,
    target,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
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

describe("phone swipe to close", () => {
  it("closes after a 120px downward drag from the top", () => {
    const { card, nodes, overlay, restore } = setupCard();
    try {
      card.open(book(), []);
      const sheet = nodes.get(".bk-card");
      const finger = touch(1, 20, 20);
      sheet.dispatch("touchstart", touchEvent({ touches: [finger], timeStamp: 0 }));
      const move = touchEvent({ touches: [touch(1, 20, 140)], timeStamp: 150 });
      sheet.dispatch("touchmove", move);

      assert.equal(move.defaultPrevented, true);
      assert.equal(sheet.style.transform, "translateY(120px)");
      sheet.dispatch("touchend", touchEvent({ changedTouches: [touch(1, 20, 140)], timeStamp: 300 }));
      assert.equal(overlay.classList.contains("on"), false);
      assert.equal(nodes.get(".bk-card").style.transform, "");
      assert.equal(nodes.get(".bk-card").classList.contains("bk-dragging"), false);
    } finally {
      restore();
    }
  });

  it("springs back after a slow 40px drag and stays open", () => {
    const { card, nodes, overlay, restore } = setupCard();
    try {
      card.open(book(), []);
      const sheet = nodes.get(".bk-card");
      sheet.dispatch("touchstart", touchEvent({ touches: [touch(2, 10, 10)], timeStamp: 0 }));
      sheet.dispatch("touchmove", touchEvent({ touches: [touch(2, 10, 50)], timeStamp: 100 }));
      sheet.dispatch("touchend", touchEvent({ changedTouches: [touch(2, 10, 50)], timeStamp: 200 }));

      assert.equal(sheet.style.transform, "translateY(0px)");
      assert.equal(sheet.classList.contains("bk-springing"), true);
      assert.equal(overlay.classList.contains("on"), true);
      assert.equal(nodes.get(".bk-card").classList.contains("bk-dragging"), false);
      sheet.dispatch("transitionend", { target: sheet, propertyName: "transform" });
      assert.equal(sheet.style.transform, "");
      assert.equal(sheet.classList.contains("bk-springing"), false);
    } finally {
      restore();
    }
  });

  it("closes after a fast 40px flick", () => {
    const { card, nodes, overlay, restore } = setupCard();
    try {
      card.open(book(), []);
      const sheet = nodes.get(".bk-card");
      sheet.dispatch("touchstart", touchEvent({ touches: [touch(3, 0, 0)], timeStamp: 0 }));
      sheet.dispatch("touchmove", touchEvent({ touches: [touch(3, 0, 40)], timeStamp: 40 }));
      sheet.dispatch("touchend", touchEvent({ changedTouches: [touch(3, 0, 40)], timeStamp: 60 }));

      assert.equal(sheet.style.transform, "");
      assert.equal(overlay.classList.contains("on"), false);
      assert.equal(document.body.style.overflow, "");
    } finally {
      restore();
    }
  });

  it("uses the release position when it crosses the close distance", () => {
    const { card, nodes, overlay, restore } = setupCard();
    try {
      card.open(book(), []);
      const sheet = nodes.get(".bk-card");
      sheet.dispatch("touchstart", touchEvent({ touches: [touch(8, 0, 0)], timeStamp: 0 }));
      sheet.dispatch("touchmove", touchEvent({ touches: [touch(8, 0, 85)], timeStamp: 200 }));
      sheet.dispatch("touchend", touchEvent({ changedTouches: [touch(8, 0, 95)], timeStamp: 300 }));

      assert.equal(overlay.classList.contains("on"), false);
      assert.equal(sheet.style.transform, "");
    } finally {
      restore();
    }
  });

  it("uses the release position to detect a fast flick", () => {
    const { card, nodes, overlay, restore } = setupCard();
    try {
      card.open(book(), []);
      const sheet = nodes.get(".bk-card");
      sheet.dispatch("touchstart", touchEvent({ touches: [touch(9, 0, 0)], timeStamp: 0 }));
      sheet.dispatch("touchmove", touchEvent({ touches: [touch(9, 0, 25)], timeStamp: 30 }));
      sheet.dispatch("touchend", touchEvent({ changedTouches: [touch(9, 0, 40)], timeStamp: 60 }));

      assert.equal(overlay.classList.contains("on"), false);
      assert.equal(sheet.style.transform, "");
    } finally {
      restore();
    }
  });

  it("does nothing when the drag starts below the scroll top", () => {
    const { card, nodes, restore } = setupCard();
    try {
      card.open(book(), []);
      const sheet = nodes.get(".bk-card");
      sheet.scrollTop = 20;
      sheet.dispatch("touchstart", touchEvent({ touches: [touch(4, 0, 0)], timeStamp: 0 }));
      const move = touchEvent({ touches: [touch(4, 0, 140)], timeStamp: 100 });
      sheet.dispatch("touchmove", move);
      sheet.dispatch("touchend", touchEvent({ changedTouches: [touch(4, 0, 140)], timeStamp: 120 }));

      assert.equal(move.defaultPrevented, false);
      assert.equal(sheet.style.transform, "");
      assert.equal(document.body.style.overflow, "hidden");
    } finally {
      restore();
    }
  });

  it("does nothing at desktop width", () => {
    const { card, nodes, restore } = setupCard({ phone: false });
    try {
      card.open(book(), []);
      const sheet = nodes.get(".bk-card");
      sheet.dispatch("touchstart", touchEvent({ touches: [touch(5, 0, 0)], timeStamp: 0 }));
      const move = touchEvent({ touches: [touch(5, 0, 140)], timeStamp: 50 });
      sheet.dispatch("touchmove", move);
      sheet.dispatch("touchend", touchEvent({ changedTouches: [touch(5, 0, 140)], timeStamp: 60 }));

      assert.equal(move.defaultPrevented, false);
      assert.equal(sheet.style.transform, "");
      assert.equal(document.body.style.overflow, "hidden");
    } finally {
      restore();
    }
  });

  it("ignores a mostly horizontal move and a tap on the select", () => {
    const { card, nodes, restore } = setupCard();
    try {
      card.open(book(), []);
      const sheet = nodes.get(".bk-card");
      sheet.dispatch("touchstart", touchEvent({ touches: [touch(6, 0, 0)], timeStamp: 0 }));
      const horizontal = touchEvent({ touches: [touch(6, 80, 20)], timeStamp: 50 });
      sheet.dispatch("touchmove", horizontal);
      sheet.dispatch("touchend", touchEvent({ changedTouches: [touch(6, 80, 20)], timeStamp: 60 }));
      assert.equal(horizontal.defaultPrevented, false);
      assert.equal(sheet.style.transform, "");

      const select = nodes.get(".bk-move select");
      sheet.dispatch("touchstart", touchEvent({ touches: [touch(7, 5, 5)], timeStamp: 100, target: select }));
      sheet.dispatch("touchend", touchEvent({ changedTouches: [touch(7, 5, 5)], timeStamp: 120, target: select }));
      assert.equal(sheet.style.transform, "");
      assert.equal(document.body.style.overflow, "hidden");
    } finally {
      restore();
    }
  });
});
