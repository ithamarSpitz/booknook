import assert from "node:assert/strict";
import test from "node:test";

import { nameSoundScore } from "../../public/js/names.js";

const LOW = [
  ["שרי טפר", ["Sheri S. Tepper"], 0.9],
  ["אורסולה לה גווין", ["Ursula K. Le Guin"], 0.66],
  ["ג'ורג' מרטין", ["George R. R. Martin"], 0.9],
];
const ONE = [
  ["שרי ס. טפר", ["Sheri S. Tepper"]],
  ["ג'יי קיי רולינג", ["J.K. Rowling"]],
  ["ג'ורג' ר. ר. מרטין", ["George R. R. Martin"]],
  ["רוברט מ. פירסיג", ["Robert M. Pirsig"]],
];

test("Latin middle initial missing from Hebrew name is ignored", () => {
  for (const [he, la, min] of LOW) assert.ok(nameSoundScore(he, la) >= min, he);
});

test("initials present on both sides still score 1", () => {
  for (const [he, la] of ONE) assert.equal(nameSoundScore(he, la), 1, he);
});

test("different people stay apart", () => {
  assert.ok(nameSoundScore("מילן קונדרה", ["Louis Sachar"]) <= 0.3);
});
