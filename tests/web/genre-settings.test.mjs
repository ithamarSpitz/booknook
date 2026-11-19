import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { ROUTES } from "../../public/js/contract.js";
import { RECS_INPUTS_CHANGED } from "../../public/js/events.js";
import {
  GENRES_EMPTY,
  SAVED_TOAST,
  buildGenreRows,
  genreListHtml,
  mount,
} from "../../public/js/genre-settings.js";

const readerGenres = [
  { genre_key: "b", label: "פנטזיה", seed_count: 3, candidate_count: 9, position: 1 },
  { genre_key: "a", label: "מדע בדיוני", seed_count: 5, candidate_count: 12, position: 0 },
];
const prefs = [
  { genre_key: "z", label: "אימה", state: "hidden", pin_order: null },
  { genre_key: "b", label: "פנטזיה", state: "pinned", pin_order: 0 },
];

describe("genre settings page", () => {
  it("orders rows by union, with counts and the shown tag", () => {
    const rows = buildGenreRows(readerGenres, prefs, ["a"]);
    assert.deepEqual(rows.map((r) => r.genre_key), ["a", "b", "z"]);
    assert.deepEqual(rows.map((r) => r.state), ["auto", "pinned", "hidden"]);
    const html = genreListHtml(rows, 10);
    assert.match(html, /5 ספרים שלך · 12 ספרים מתאימים/);
    assert.equal(html.match(/מוצג עכשיו/g).length, 1);
    assert.ok(html.indexOf("מדע בדיוני") < html.indexOf("פנטזיה"));
    assert.ok(html.indexOf("פנטזיה") < html.indexOf("אימה"));
    assert.equal(html.match(/ספרים שלך/g).length, 2);
  });

  it("saves each option, fires the event once on success, and rolls back on failure", async () => {
    const h = createHarness();
    const cleanup = await mount(h.root, h.ctx);
    for (const state of ["pinned", "hidden", "auto"]) {
      h.events.length = 0;
      await h.clickOption("a", state);
      assert.deepEqual(h.rpcCalls.at(-1), [
        "set_genre_preference",
        { p_genre_key: "a", p_label: "מדע בדיוני", p_state: state },
      ]);
      assert.equal(h.events.length, 1);
      assert.equal(h.toasts.at(-1), SAVED_TOAST);
      assert.match(h.content.innerHTML, new RegExp(`data-state="${state}" aria-pressed="true"`));
    }

    h.events.length = 0;
    h.rpcError = new Error("נכשל");
    await h.clickOption("a", "hidden");
    assert.equal(h.events.length, 0);
    assert.equal(h.toasts.at(-1), "נכשל");
    assert.match(h.content.innerHTML, /data-state="auto" aria-pressed="true"/);
    cleanup();
  });

  it("changes the shelf count through set_genre_shelf_count", async () => {
    const h = createHarness();
    const cleanup = await mount(h.root, h.ctx);
    assert.match(h.content.innerHTML, /<option value="10" selected>/);
    await h.change("7");
    assert.deepEqual(h.rpcCalls.at(-1), ["set_genre_shelf_count", { p_count: 7 }]);
    assert.equal(h.events.length, 1);
    assert.match(h.content.innerHTML, /<option value="7" selected>/);
    cleanup();
  });

  it("disables pinning on unpinned rows at N - 1 pins and shows the note", async () => {
    const h = createHarness({ count: 2 });
    const cleanup = await mount(h.root, h.ctx);
    const html = h.content.innerHTML;
    assert.match(html, /אפשר לנעוץ עד 1 מדפים, כדי שיישאר מקום לז'אנר חדש/);
    const rowHtml = (key) => html.split("<li ").find((s) => s.includes(`data-genre-key="${key}"`));
    assert.match(rowHtml("a"), /data-state="pinned"[^>]* disabled/);
    assert.doesNotMatch(rowHtml("b"), /data-state="pinned"[^>]* disabled/);
    const before = h.rpcCalls.length;
    await h.clickOption("a", "pinned");
    assert.equal(h.rpcCalls.length, before);

    const roomy = genreListHtml(buildGenreRows(readerGenres, prefs, []), 10);
    assert.doesNotMatch(roomy, /אפשר לנעוץ/);
    cleanup();
  });

  it("shows the empty state", async () => {
    const h = createHarness({ genres: [], prefs: [] });
    const cleanup = await mount(h.root, h.ctx);
    assert.match(h.content.innerHTML, new RegExp(GENRES_EMPTY));
    cleanup();
  });

  it("registers #genres and links it after the removed books item", async () => {
    assert.equal(ROUTES.GENRES, "#genres");
    const html = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
    const removed = html.indexOf('href="#removed"');
    const genres = html.indexOf('href="#genres"');
    const search = html.indexOf('href="#search"');
    assert.ok(removed >= 0 && genres > removed && search > genres);
    assert.match(html, /href="#genres"[^>]*>.*הגדרות מדפי המלצות/s);
    assert.match(html, /data-route="genres"/);
    assert.match(html, /css\/genre-settings\.css/);
  });
});

function createHarness({ count = 1 + 9, genres = readerGenres, prefs: prefRows = prefs } = {}) {
  const handlers = {};
  const rpcCalls = [];
  const toasts = [];
  const events = [];
  const target = new EventTarget();
  globalThis.document = target;
  target.addEventListener(RECS_INPUTS_CHANGED, () => events.push(1));

  const content = { innerHTML: "" };
  const inner = {
    innerHTML: "",
    querySelector: (s) => (s === ".genre-content" ? content : null),
    addEventListener: (type, fn) => { handlers[type] = fn; },
    removeEventListener() {},
  };
  const result = (data) => {
    const p = Promise.resolve({ data, error: null });
    p.order = () => p;
    p.maybeSingle = () => p;
    return p;
  };
  const tables = {
    profiles: { genre_shelf_count: count },
    reader_genres: genres,
    genre_preferences: prefRows,
    genre_recommendations: [{ genre_key: "a" }, { genre_key: "a" }],
  };
  const h = {
    rpcError: null,
    rpcCalls,
    toasts,
    events,
    content,
    root: { querySelector: () => inner },
    ctx: {
      api: {
        getClient: () => ({
          from: (table) => ({ select: () => result(tables[table]) }),
          async rpc(name, params) {
            rpcCalls.push([name, params]);
            return { error: h.rpcError };
          },
        }),
      },
      showToast: (m) => toasts.push(m),
    },
    clickOption(key, state) {
      const row = { dataset: { genreKey: key } };
      const button = {
        dataset: { state },
        disabled: new RegExp(`data-genre-key="${key}"[\\s\\S]*?data-state="${state}"[^>]* disabled`)
          .test(content.innerHTML.split("<li ").find((s) => s.includes(`data-genre-key="${key}"`)) ?? "")
          && state === "pinned",
        closest: (s) => (s === ".genre-opt" ? button : s === ".genre-row" ? row : null),
      };
      return handlers.click({ target: button });
    },
    change(value) {
      const select = { value, closest: (s) => (s === ".genre-count" ? select : null) };
      return handlers.change({ target: select });
    },
  };
  return h;
}
