import { assert, assertEquals } from "jsr:@std/assert@1";
import { nameSoundScore } from "../../supabase/functions/_shared/names.ts";

const LOW: [string, string[], number][] = [
  ["שרי טפר", ["Sheri S. Tepper"], 0.9],
  ["אורסולה לה גווין", ["Ursula K. Le Guin"], 0.66],
  ["ג'ורג' מרטין", ["George R. R. Martin"], 0.9],
];
const ONE: [string, string[]][] = [
  ["שרי ס. טפר", ["Sheri S. Tepper"]],
  ["ג'יי קיי רולינג", ["J.K. Rowling"]],
  ["ג'ורג' ר. ר. מרטין", ["George R. R. Martin"]],
  ["רוברט מ. פירסיג", ["Robert M. Pirsig"]],
];

Deno.test("Latin middle initial missing from Hebrew name is ignored", () => {
  for (const [he, la, min] of LOW) {
    assert(nameSoundScore(he, la) >= min, he);
  }
});

Deno.test("initials present on both sides still score 1", () => {
  for (const [he, la] of ONE) assertEquals(nameSoundScore(he, la), 1, he);
});

Deno.test("different people stay apart", () => {
  assert(nameSoundScore("מילן קונדרה", ["Louis Sachar"]) <= 0.3);
});
