import assert from "node:assert/strict";
import { test } from "node:test";
import { localizeRecommendations } from "../../public/js/recs.js";

const ALT_BOOK = { id: 994102, title: "בית כברות לחיות", author: "סטיבן קינג" };

function makeRec(hint) {
  return {
    work_id: "w1",
    title: "Pet Sematary",
    author: "Stephen King",
    english_only: true,
    simania_id: null,
    hebrew_author: "סטיבן קינג",
    hebrew_hint: hint,
  };
}

async function run(hint, matchImpl) {
  const matchCalls = [];
  const linkCalls = [];
  await localizeRecommendations([makeRec(hint)], {
    callFunction: async (name, body) => {
      if (name === "link-edition") {
        linkCalls.push(body);
        return { simania_id: body.simania_id, title: "x", author: null, cover_url: null };
      }
      return null;
    },
    onLinked: () => {},
    isCurrent: () => true,
    match: async (title, author) => {
      matchCalls.push([title, author]);
      return matchImpl(title);
    },
    searchBooks: async () => [],
    searchByAuthor: async () => [],
    fetchPayload: async () => ({ details: { author: "סטיבן קינג" } }),
  });
  return { matchCalls, linkCalls };
}

const hint = {
  source: "wikidata",
  title: "בית קברות לחיות",
  author: "סטיבן קינג",
  alternate: "בית כברות לחיות",
};

test("alternate is tried when the main title misses, and links with source nli", async () => {
  const { matchCalls, linkCalls } = await run(hint, (t) => (t === hint.alternate ? ALT_BOOK : null));
  assert.equal(matchCalls.length, 2);
  assert.equal(matchCalls[1][0], "בית כברות לחיות");
  assert.equal(matchCalls[1][1], "סטיבן קינג");
  assert.equal(linkCalls.length, 1);
  assert.equal(linkCalls[0].simania_id, 994102);
  assert.equal(linkCalls[0].source, "nli");
});

test("alternate is not tried when the main title matches", async () => {
  const { matchCalls, linkCalls } = await run(hint, () => ({ ...ALT_BOOK, id: 111 }));
  assert.equal(matchCalls.length, 1);
  assert.equal(linkCalls.length, 1);
  assert.equal(linkCalls[0].simania_id, 111);
});

test("without alternate, behavior is unchanged", async () => {
  const { alternate: _alt, ...plain } = hint;
  const { matchCalls, linkCalls } = await run(plain, () => null);
  assert.equal(matchCalls.length, 1);
  assert.equal(linkCalls.length, 0);
});
