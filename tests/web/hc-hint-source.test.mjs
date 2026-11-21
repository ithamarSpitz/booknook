import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyTitleMatch } from "../../public/js/recs.js";

const book = { id: 123, title: "בית קברות לחיות", author: "סטיבן קינג" };

function rec(source) {
  return {
    work_id: "w1",
    author: "Stephen King",
    hebrew_author: null,
    hebrew_hint: { source, title: "בית קברות לחיות", author: null },
  };
}

const deps = { callFunction: async () => null };

test("a hardcover hint resolves with status hardcover", async () => {
  const out = await verifyTitleMatch(rec("hardcover"), book, deps);
  assert.deepEqual(out, { simania_id: 123, resolve_status: "hardcover" });
});

test("an nli hint still resolves with status nli", async () => {
  const out = await verifyTitleMatch(rec("nli"), book, deps);
  assert.deepEqual(out, { simania_id: 123, resolve_status: "nli" });
});
