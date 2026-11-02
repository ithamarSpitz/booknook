import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchSimaniaPayload, matchHebrewBook, searchBooks, searchByAuthor, simaniaIdOf } from "../../public/js/simania.js";
import { applyLocalizedRecommendation, localizeRecommendations } from "../../public/js/recs.js";

/** Fake Simania MCP endpoint answering each tool from a table, in SSE framing. */
function fakeFetch(answers, calls = []) {
  return async (url, init) => {
    const { params } = JSON.parse(init.body);
    calls.push({ url, name: params.name, args: params.arguments });
    const value = answers[params.name];
    if (value instanceof Error) return new Response("blocked", { status: 403 });
    const result = typeof value === "function" ? value(params.arguments) : value;
    const envelope = { result: { content: [{ type: "text", text: JSON.stringify(result) }] } };
    return new Response(`event: message\ndata: ${JSON.stringify(envelope)}\n\n`, { status: 200 });
  };
}

describe("browser Simania client", () => {
  it("searches books_search with limit 8 and unwraps the books envelope", async () => {
    const calls = [];
    const books = await searchBooks(" הנסיך ", 8, fakeFetch({ books_search: { books: [{ id: 5, title: "הנסיך הקטן" }] } }, calls));
    assert.deepEqual(books, [{ id: 5, title: "הנסיך הקטן" }]);
    assert.deepEqual(calls[0].args, { query: "הנסיך", limit: 8, offset: 0 });
    assert.equal(calls[0].url, "https://simania.co.il/api/mcp");
  });

  it("makes no call for a query under 2 characters", async () => {
    const calls = [];
    assert.deepEqual(await searchBooks("א", 8, fakeFetch({}, calls)), []);
    assert.equal(calls.length, 0);
  });

  it("reports an HTTP failure as an error", async () => {
    await assert.rejects(searchBooks("ספר", 8, fakeFetch({ books_search: new Error() })));
  });

  it("returns raw details and tolerates a rating failure", async () => {
    const payload = await fetchSimaniaPayload(9, fakeFetch({
      books_get_details: { book: { title: "ספר" } },
      books_get_rating: new Error(),
    }));
    assert.deepEqual(payload, { details: { title: "ספר" }, rating: null });
  });

  it("matches title plus author, falls back to the title alone, and enforces Dice 0.45", async () => {
    const calls = [];
    const match = await matchHebrewBook("הנסיך הקטן", "סנט", fakeFetch({
      books_search: ({ query }) => (query === "הנסיך הקטן סנט" ? [] : [{ id: 1, title: "משהו אחר" }, { id: 2, title: "הנסיך הקטן" }]),
    }, calls));
    assert.equal(match.id, 2);
    assert.deepEqual(calls.map((c) => c.args.query), ["הנסיך הקטן סנט", "הנסיך הקטן"]);
    assert.equal(await matchHebrewBook("הנסיך הקטן", "", fakeFetch({ books_search: [{ id: 1, title: "ספר אחר לגמרי" }] })), null);
  });

  it("reads numeric IDs only", () => {
    assert.equal(simaniaIdOf({ bookId: "12" }), 12);
    assert.equal(simaniaIdOf({ id: "x" }), null);
  });

  it("searchByAuthor uses first and last word, filters by author similarity and Hebrew title", async () => {
    const calls = [];
    const wilson = "רוברט צ'ארלס וילסון";
    const results = await searchByAuthor(wilson, fakeFetch({
      books_search: [
        { id: 97171, title: "סחרור", author: "רוברט צ'רלס וילסון" },
        { id: 2, title: "עונש מוות", author: "רוברט כהן" },
        { id: 3, title: "Spin", author: "רוברט צ'רלס וילסון" },
      ],
    }, calls));
    assert.deepEqual(calls[0].args, { query: "רוברט וילסון", limit: 50, offset: 0 });
    assert.deepEqual(results, [{ simania_id: 97171, title: "סחרור", author: "רוברט צ'רלס וילסון" }]);
    assert.equal(results.some((r) => r.title === "Spin"), false);
  });

  it("searchByAuthor makes no call for an empty name", async () => {
    const calls = [];
    assert.deepEqual(await searchByAuthor("  ", fakeFetch({}, calls)), []);
    assert.equal(calls.length, 0);
  });
});

describe("localizeRecommendations", () => {
  const english = (workId, hint) => ({ work_id: workId, title: "English", english_only: true, can_add: false, hebrew_hint: hint });

  it("links matched cards through link-edition and skips misses", async () => {
    const sent = [];
    const linked = [];
    await localizeRecommendations([
      english("w1", { source: "nli", title: "עברית", author: null }),
      english("w2", { source: "wikidata", title: "אין", author: null }),
      english("w3", null),
    ], {
      match: async (title) => (title === "עברית" ? { id: 7, title } : null),
      fetchPayload: async (id) => ({ details: { title: `#${id}` }, rating: null }),
      callFunction: async (name, body) => {
        sent.push([name, body]);
        return { work_id: body.work_id, simania_id: body.simania_id, title: "עברית", author: null, cover_url: null };
      },
      onLinked: (workId, patch) => linked.push([workId, patch]),
      isCurrent: () => true,
    });
    assert.deepEqual(sent, [["link-edition", { work_id: "w1", simania_id: 7, source: "nli", simania: { details: { title: "#7" }, rating: null } }]]);
    assert.deepEqual(linked, [["w1", { simania_id: 7, title: "עברית", author: null, cover_url: null }]]);
  });

  it("keeps going after one card fails and stops when the screen is gone", async () => {
    let current = true;
    const linked = [];
    await localizeRecommendations([english("w1", { source: "wikidata", title: "א", author: null }), english("w2", { source: "wikidata", title: "ב", author: null })], {
      concurrency: 1,
      match: async (title) => {
        if (title === "א") throw new Error("Simania down");
        return { id: 2, title };
      },
      fetchPayload: async () => ({ details: { title: "ב" }, rating: null }),
      callFunction: async (_n, body) => ({ simania_id: body.simania_id, title: "ב" }),
      onLinked: (workId) => linked.push(workId),
      isCurrent: () => current,
    });
    assert.deepEqual(linked, ["w2"]);
    current = false;
    await localizeRecommendations([english("w3", { source: "wikidata", title: "ג", author: null })], {
      match: async () => assert.fail("must not run after unmount"),
      callFunction: async () => ({}),
      onLinked: () => {},
      isCurrent: () => current,
    });
  });

  it("turns a linked card into an addable Hebrew card", () => {
    const [card] = applyLocalizedRecommendation([english("w1", { source: "nli", title: "x", author: null })], "w1", { simania_id: 7, title: "עברית", author: "מחבר", cover_url: null });
    assert.deepEqual([card.simania_id, card.title, card.english_only, card.can_add, card.hebrew_hint], [7, "עברית", false, true, null]);
  });
});
