import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { ROUTES } from "../../public/js/contract.js";
import {
  REMOVED_EMPTY,
  RESTORED_TOAST,
  mapRemovedRows,
  mount,
  removedListHtml,
} from "../../public/js/removed.js";

const rawRows = [
  {
    work_id: "english",
    kind: "hide",
    dismissed_at: "2026-11-17T10:00:00Z",
    works: {
      original_title: "English title",
      original_authors: ["English author", "Second author"],
      hardcover_cover_url: "english.jpg",
      editions: [{ simania_id: -44, title: "Generated English edition" }],
    },
  },
  {
    work_id: "hebrew",
    kind: "not_my_type",
    dismissed_at: "2026-11-18T10:00:00Z",
    works: {
      original_title: "Original title",
      original_authors: ["Original author"],
      hardcover_cover_url: "original.jpg",
      editions: [
        { simania_id: 20, title: "עברית שנייה", author: "מחבר שני", cover_url: "two.jpg" },
        { simania_id: 10, title: "עברית ראשונה", author: "מחבר ראשון", cover_url: "one.jpg" },
      ],
    },
  },
];

describe("removed books page", () => {
  it("maps newest first, preferring the lowest Hebrew edition and using work fallback", () => {
    const rows = mapRemovedRows(rawRows);
    assert.deepEqual(rows.map((row) => row.work_id), ["hebrew", "english"]);
    assert.deepEqual(
      rows.map(({ title, author, cover_url }) => ({ title, author, cover_url })),
      [
        { title: "עברית ראשונה", author: "מחבר ראשון", cover_url: "one.jpg" },
        { title: "English title", author: "English author", cover_url: "english.jpg" },
      ],
    );
    const html = removedListHtml(rows);
    assert.ok(html.indexOf("עברית ראשונה") < html.indexOf("English title"));
    assert.match(html, /לא הסגנון שלי/);
    assert.match(html, /הוסר/);
  });

  it("shows the exact empty state", () => {
    assert.match(removedListHtml([]), new RegExp(REMOVED_EMPTY));
  });

  it("restores with p_work_id, removes a successful row and keeps a failed row", async () => {
    const success = createMountHarness({ rpcError: null });
    const cleanupSuccess = await mount(success.root, success.ctx);
    await success.click();
    assert.deepEqual(success.rpcCalls, [
      ["restore_work", { p_work_id: "hebrew" }],
    ]);
    assert.equal(success.row.removed, true);
    assert.match(success.content.innerHTML, new RegExp(REMOVED_EMPTY));
    assert.deepEqual(success.toasts, [RESTORED_TOAST]);
    cleanupSuccess();

    const failure = createMountHarness({ rpcError: new Error("החזרה נכשלה") });
    const cleanupFailure = await mount(failure.root, failure.ctx);
    await failure.click();
    assert.equal(failure.row.removed, false);
    assert.equal(failure.button.disabled, false);
    assert.deepEqual(failure.toasts, ["החזרה נכשלה"]);
    cleanupFailure();
  });

  it("registers #removed and puts its menu link after recommendations", async () => {
    assert.equal(ROUTES.REMOVED, "#removed");
    const html = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
    const recs = html.indexOf('href="#recs"');
    const removed = html.indexOf('href="#removed"');
    const search = html.indexOf('href="#search"');
    assert.ok(recs >= 0 && removed > recs && search > removed);
    assert.match(html, /href="#removed"[^>]*>.*ספרים שהסרתי/s);
  });
});

function createMountHarness({ rpcError }) {
  let clickHandler = null;
  const rpcCalls = [];
  const toasts = [];
  const row = {
    dataset: { workId: "hebrew" },
    removed: false,
    remove() { this.removed = true; },
  };
  const button = {
    disabled: false,
    closest(selector) {
      return selector === ".removed-restore" ? this : selector === ".removed-row" ? row : null;
    },
  };
  const content = {
    innerHTML: "",
    querySelector(selector) {
      return selector === ".removed-row" && !row.removed ? row : null;
    },
  };
  const inner = {
    innerHTML: "",
    querySelector(selector) {
      return selector === ".removed-content" ? content : null;
    },
    addEventListener(type, handler) {
      if (type === "click") clickHandler = handler;
    },
    removeEventListener() {},
    contains(node) { return node === button; },
  };
  const client = {
    from() {
      return {
        select() {
          return {
            async order() { return { data: [rawRows[1]], error: null }; },
          };
        },
      };
    },
    async rpc(name, params) {
      rpcCalls.push([name, params]);
      return { error: rpcError };
    },
  };

  return {
    root: { querySelector: () => inner },
    ctx: {
      api: { getClient: () => client },
      showToast: (message) => toasts.push(message),
    },
    row,
    button,
    content,
    rpcCalls,
    toasts,
    click: () => clickHandler({ target: button }),
  };
}
