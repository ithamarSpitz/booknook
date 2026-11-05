import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  hebrewSkeleton,
  latinSkeleton,
  nameSoundScore,
} from "../../scripts/lib/names.ts";

Deno.test("hebrewSkeleton maps letters and drops vowel letters", () => {
  assertEquals(hebrewSkeleton("סטיבן קינג"), "stbnkng");
  assertEquals(hebrewSkeleton("אבי חימנז"), "bhmnz");
  assertEquals(hebrewSkeleton("ג'ון"), "jvn");
  assertEquals(hebrewSkeleton("צ׳רלס"), "chrls");
  assertEquals(hebrewSkeleton(""), "");
});

Deno.test("latinSkeleton applies digraphs and drops vowels and y", () => {
  assertEquals(latinSkeleton("Stephen King"), "stfnkng");
  assertEquals(latinSkeleton("Cecilia Edward"), "ssldwrd");
  assertEquals(latinSkeleton("Rufi Thorpe"), "rftrp");
  assertEquals(latinSkeleton("Abby Jimenez"), "bbjmnz");
  assertEquals(latinSkeleton("Jiménez"), "jmnz");
});

const SAME_PERSON: Array<[string, string]> = [
  ["סטיבן קינג", "Stephen King"],
  ["פרידה מקפדן", "Freida McFadden"],
  ["ססיליה אדוארד", "Cecilia Edward"],
  ["רופי תורפ", "Rufi Thorpe"],
  ["אבי חימנז", "Abby Jimenez"],
];

for (const [hebrew, latin] of SAME_PERSON) {
  Deno.test(`same person scores at least 0.5: ${latin}`, () => {
    const score = nameSoundScore(hebrew, [latin]);
    assert(score >= 0.5, `${hebrew} / ${latin} scored ${score}`);
    assert(score <= 1);
  });
}

Deno.test("measured same-person scores", () => {
  assertEquals(nameSoundScore("סטיבן קינג", ["Stephen King"]), 1);
  assertEquals(nameSoundScore("פרידה מקפדן", ["Freida McFadden"]), 1);
  assertEquals(nameSoundScore("ססיליה אדוארד", ["Cecilia Edward"]), 1);
  assertEquals(nameSoundScore("רופי תורפ", ["Rufi Thorpe"]), 6 / 9);
  assertEquals(nameSoundScore("אבי חימנז", ["Abby Jimenez"]), 0.5);
});

const OTHER_AUTHORS = [
  "Karin N. Mango",
  "Laura Van Wormer",
  "Judy Astley",
  "Melody Carlson",
  "Jenna Rutland",
  "Sue Moorcroft",
];

for (const latin of OTHER_AUTHORS) {
  Deno.test(`different person scores below 0.5: ${latin}`, () => {
    const score = nameSoundScore("אבי חימנז", [latin]);
    assert(score < 0.5, `אבי חימנז / ${latin} scored ${score}`);
    assert(score >= 0);
  });
}

Deno.test("score is the maximum over latinNames", () => {
  const single = nameSoundScore("רופי תורפ", ["Rufi Thorpe"]);
  assertEquals(
    nameSoundScore("רופי תורפ", ["Someone Else", "Rufi Thorpe"]),
    single,
  );
  assertEquals(
    nameSoundScore("אבי חימנז", [...OTHER_AUTHORS, "Abby Jimenez"]),
    nameSoundScore("אבי חימנז", ["Abby Jimenez"]),
  );
});

Deno.test("empty input gives 0", () => {
  assertEquals(nameSoundScore("", ["Stephen King"]), 0);
  assertEquals(nameSoundScore("סטיבן קינג", []), 0);
  assertEquals(nameSoundScore("סטיבן קינג", [""]), 0);
});

Deno.test("score is deterministic", () => {
  const first = nameSoundScore("אבי חימנז", OTHER_AUTHORS);
  for (let i = 0; i < 5; i++) {
    assertEquals(nameSoundScore("אבי חימנז", OTHER_AUTHORS), first);
  }
});
