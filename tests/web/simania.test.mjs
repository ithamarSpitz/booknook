import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchSimaniaPayload, matchHebrewBook, normalize, searchBooks, searchByAuthor, similarity, simaniaIdOf, stripHebrewPoints } from "../../public/js/simania.js";
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
  it("normalizes Hebrew points and maqaf without changing Latin accent handling", () => {
    assert.equal(similarity("אינטרמצו", "אִינְטֶרְמֶצּוֹ"), 1);
    assert.equal(normalize("אִינְטֶרְמֶצּוֹ"), normalize("אינטרמצו"));
    assert.equal(normalize("בית־ספר"), "בית ספר");
    assert.equal(stripHebrewPoints("שָׁלוֹם"), "שלום");
    assert.equal(normalize("Café"), "cafe");
  });

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

  it("does not fetch Simania payloads for negative English edition IDs", async () => {
    const calls = [];
    assert.equal(await fetchSimaniaPayload(-383752, fakeFetch({}, calls)), null);
    assert.equal(calls.length, 0);
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

  it("searches both queries for a one-word hint and can match the title search", async () => {
    const calls = [];
    const otherBooks = Array.from({ length: 6 }, (_, index) => ({
      id: index + 1,
      title: `ספר אחר ${index}`,
      author: "מחבר אחר",
    }));
    const match = await matchHebrewBook("זר", "סטיבן קינג", fakeFetch({
      books_search: ({ query }) => query === "זר סטיבן קינג"
        ? otherBooks
        : [{ id: 994441, title: "זר", author: "סטיבן קינג" }],
    }, calls));
    assert.equal(match.id, 994441);
    assert.deepEqual(calls.map((call) => call.args.query), ["זר סטיבן קינג", "זר"]);
  });

  it("does not search a two-word title alone when the first search has results", async () => {
    const calls = [];
    const match = await matchHebrewBook("הנסיך הקטן", "סנט אכזופרי", fakeFetch({
      books_search: [{ id: 2, title: "הנסיך הקטן", author: "סנט אכזופרי" }],
    }, calls));
    assert.equal(match.id, 2);
    assert.deepEqual(calls.map((call) => call.args.query), ["הנסיך הקטן סנט אכזופרי"]);
  });

  it("requires author Dice 0.6 before applying the word-subset boost", async () => {
    assert.ok(similarity("ג'יין אוסטן", "ג'יין מרי שלי") < 0.6);
    const match = await matchHebrewBook("גאווה ודעה קדומה", "ג'יין אוסטן", fakeFetch({
      books_search: [
        { id: 1, title: "כסף אהבה גאווה ודעה קדומה", author: "ג'יין מרי שלי" },
        { id: 2, title: "גאווה ודעה מהדורת 2009 חדשה", author: "ג'יין אוסטן" },
      ],
    }));
    assert.equal(match.id, 2);
  });

  it("breaks an old-score tie with the label-stripped title score", async () => {
    const match = await matchHebrewBook("ספר טוב", "מחבר", fakeFetch({
      books_search: [
        { id: 1, title: "ספר טוב מאוד חדש", author: "מחבר" },
        { id: 2, title: "ספר טוב [מהדורה מיוחדת]", author: "מחבר" },
      ],
    }));
    assert.equal(match.id, 2);
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
        if (name === "match-by-author") {
          const id = body.candidates?.[0]?.simania_id;
          return { simania_id: id, resolve_status: "nli" };
        }
        return { work_id: body.work_id, simania_id: body.simania_id, title: "עברית", author: null, cover_url: null };
      },
      onLinked: (workId, patch) => linked.push([workId, patch]),
      isCurrent: () => true,
    });
    assert.deepEqual(sent, [
      ["match-by-author", { work_id: "w1", candidates: [{ simania_id: 7, title: "עברית", author: null }] }],
      ["link-edition", { work_id: "w1", simania_id: 7, source: "nli", simania: { details: { title: "#7" }, rating: null } }],
    ]);
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
      callFunction: async (name, body) => {
        if (name === "match-by-author") {
          return { simania_id: body.candidates[0].simania_id, resolve_status: "wikidata" };
        }
        return { simania_id: body.simania_id, title: "ב" };
      },
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
