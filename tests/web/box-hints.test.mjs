import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasHebrewBoxWord,
  matchHebrewBook,
  simaniaIdOf,
  stripHebrewBoxWords,
} from "../../public/js/simania.js";
import { localizeRecommendations } from "../../public/js/recs.js";

function fakeFetch(results) {
  return async () => {
    const envelope = {
      result: {
        content: [{ type: "text", text: JSON.stringify({ books: results }) }],
      },
    };
    return new Response(`event: message\ndata: ${JSON.stringify(envelope)}\n\n`, { status: 200 });
  };
}

const results = [
  { id: 980165, title: "טרילוגיית משחקי הרעב", author: "סוזן קולינס" },
  { id: 937027, title: "משחקי הרעב", author: "סוזן קולינס" },
];

test("hasHebrewBoxWord detects whole box words only", () => {
  assert.equal(hasHebrewBoxWord("טרילוגיית משחקי הרעב"), true);
  assert.equal(hasHebrewBoxWord("מארז דיגיטלי – מורשת הותורן"), true);
  assert.equal(hasHebrewBoxWord("סטודיו"), false);
  assert.equal(hasHebrewBoxWord("משחקי הרעב"), false);
});

test("stripHebrewBoxWords removes box words", () => {
  assert.equal(stripHebrewBoxWords("טרילוגיית משחקי הרעב"), "משחקי הרעב");
});

test("matchHebrewBook ignores box sets unless the hint names one", async () => {
  const plain = await matchHebrewBook("משחקי הרעב", "סוזן קולינס", fakeFetch(results));
  assert.equal(simaniaIdOf(plain), 937027);
  const box = await matchHebrewBook("טרילוגיית משחקי הרעב", "סוזן קולינס", fakeFetch(results));
  assert.equal(simaniaIdOf(box), 980165);
});

async function runLocalize(title) {
  const calls = [];
  const rec = {
    work_id: "w1",
    title,
    author: "Suzanne Collins",
    english_only: true,
    simania_id: null,
    hebrew_hint: { title: "טרילוגיית משחקי הרעב", author: "סוזן קולינס" },
  };
  await localizeRecommendations([rec], {
    callFunction: async () => null,
    onLinked: () => {},
    isCurrent: () => true,
    match: async (hintTitle) => {
      calls.push(hintTitle);
      return null;
    },
    searchBooks: async () => [],
    searchByAuthor: async () => [],
  });
  return calls;
}

test("localize strips Hebrew box words from the hint for a single book", async () => {
  assert.deepEqual(await runLocalize("The Hunger Games"), ["משחקי הרעב"]);
});

test("localize keeps the hint when the card is itself a box set", async () => {
  assert.deepEqual(await runLocalize("The Hunger Games Trilogy"), ["טרילוגיית משחקי הרעב"]);
});
