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
  applyRecsCardChrome,
  applyRecommendationRefresh,
  bindRecsCardActions,
  buildReasonLine,
  canCompleteRecsWrite,
  hasRecommendationSeeds,
  mapStoredRecommendationRow,
  removeRecommendationByWorkId,
  restoreRecsCardChrome,
  revertFailedShelfPick,
  shelfChoicesForAdd,
  shouldShowRecsEmptyState,
  sortRecommendations,
  visibleRecommendations,
} from "../../public/js/recs.js";

const recsCss = readFileSync(new URL("../../public/css/recs.css", import.meta.url), "utf8");

describe("buildReasonLine", () => {
  it("formats one seed title", () => {
    assert.equal(buildReasonLine(["פרנהייט 451"], []), "בגלל שקראת פרנהייט 451");
  });

  it("formats two seed titles with ו", () => {
    assert.equal(
      buildReasonLine(["א", "ב"], []),
      "בגלל שקראת א וב",
    );
  });

  it("formats three or more seed titles", () => {
    assert.equal(
      buildReasonLine(["א", "ב", "ג"], []),
      "בגלל שקראת א, ב וג",
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
          original_title: "Piranesi",
          original_authors: ["Susanna Clarke"],
          hardcover_cover_url: "https://hc",
        },
      },
      new Map(),
    );
    assert.equal(card.english_only, true);
    assert.equal(card.can_add, false);
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

  it("hides add-to-shelf for English-only and removes the note on restore", () => {
    const overlay = createFakeOverlay();
    const session = applyRecsCardChrome(overlay, {
      work_id: "en",
      simania_id: null,
      english_only: true,
      can_add: false,
    });
    assert.equal(overlay._move.hidden, true);
    assert.equal(overlay._select.disabled, true);
    assert.equal(overlay.querySelector(".bk-rec-note")?.textContent, ENGLISH_ONLY_NOTE);
    restoreRecsCardChrome(session);
    assert.equal(overlay._move.hidden, false);
    assert.equal(overlay.querySelector(".bk-rec-note"), null);
    assert.equal(overlay._remove.textContent, LIBRARY_REMOVE_LABEL);
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
