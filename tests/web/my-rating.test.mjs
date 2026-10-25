import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyOptimisticRating, setRating } from "../../public/js/data.js";
import { shouldPromptRating } from "../../public/js/my-rating.js";

function library() {
  return {
    displayName: "x",
    shelves: [
      { id: "s1", name: "קראתי", kind: "read", position: 0, books: [{ simania_id: 1, rating: null }, { simania_id: 2, rating: 4 }] },
    ],
  };
}

describe("my rating", () => {
  it("asks for a rating only when a book reaches read unrated", () => {
    assert.equal(shouldPromptRating("read", null), true);
    assert.equal(shouldPromptRating("read", undefined), true);
    assert.equal(shouldPromptRating("read", 3), false);
    assert.equal(shouldPromptRating("reading", null), false);
    assert.equal(shouldPromptRating("want", null), false);
  });

  it("updates one book's rating without touching the original state", () => {
    const state = library();
    const next = applyOptimisticRating(state, 1, 5);
    assert.equal(next.shelves[0].books[0].rating, 5);
    assert.equal(state.shelves[0].books[0].rating, null);
    assert.equal(applyOptimisticRating(next, 2, null).shelves[0].books[1].rating, null);
  });

  it("calls the set_rating RPC and throws its error", async () => {
    const calls = [];
    const ok = { rpc: async (name, args) => (calls.push([name, args]), { error: null }) };
    await setRating(ok, 7, 3);
    assert.deepEqual(calls, [["set_rating", { p_simania_id: 7, p_rating: 3 }]]);
    const failing = { rpc: async () => ({ error: new Error("rating must be 1 to 5") }) };
    await assert.rejects(setRating(failing, 7, 9), /1 to 5/);
  });
});
