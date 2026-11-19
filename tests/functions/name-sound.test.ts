import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  hebrewSkeleton,
  latinSkeleton,
  nameSoundScore,
} from "../../scripts/lib/names.ts";
import { nameSoundScore as browserNameSoundScore } from "../../public/js/names.js";

Deno.test("hebrewSkeleton maps letters and drops vowel letters", () => {
  assertEquals(hebrewSkeleton("סטיבן קינג"), "stbnkng");
  assertEquals(hebrewSkeleton("אבי חימנז"), "bhmnz");
  assertEquals(hebrewSkeleton("ג'ון"), "jvn");
  assertEquals(hebrewSkeleton("צ׳רלס"), "chrls");
  assertEquals(hebrewSkeleton("קסנדרה"), "ksndr");
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
  assertEquals(nameSoundScore("רופי תורפ", ["Rufi Thorpe"]), 1);
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

const CONTRACT_SAME_PERSON: Array<[string, string]> = [
  ["ג'ו היל", "Joe Hill"],
  ["ג'וג'ו מויס", "Jojo Moyes"],
  ["רוברט מ. פירסיג", "Robert M. Pirsig"],
  ["רואלד דאל", "Roald Dahl"],
  ["אלדוס האקסלי", "Aldous Huxley"],
  ["פאולו קואלו", "Paulo Coelho"],
  ["אן פאצ'ט", "Ann Patchett"],
  ["צ'אק פלאניוק", "Chuck Palahniuk"],
  ["ג'ורג' אורוול", "George Orwell"],
  ["הרוקי מורקמי", "Haruki Murakami"],
  ["אליסון נואל", "Alyson Noël"],
  ["ניקולה יון", "Nicola Yoon"],
];

const CONTRACT_DIFFERENT_PERSON: Array<[string, string]> = [
  ["וויליאם פיטר בלאטי", "Kazue Kato"],
  ["מילן קונדרה", "Louis Sachar"],
  ["ד'ר ד.אשבל", "David Mitchell"],
  ["ליאת רוטנר", "Fanny Blake"],
  ["אריקה לאונרד ג'יימס", "Jasper Fforde"],
  ["אשכר ארבליך-בריפמן", "Boualem Sansal"],
  ["ג'קלין ווילסטון", "Pedro Mañas"],
];

for (const [hebrew, latin] of CONTRACT_SAME_PERSON) {
  Deno.test(`S21 same person scores at least 0.6: ${latin}`, () => {
    const score = nameSoundScore(hebrew, [latin]);
    assert(score >= 0.6, `${hebrew} / ${latin} scored ${score}`);
    assertEquals(browserNameSoundScore(hebrew, [latin]), score);
  });
}

for (const [hebrew, latin] of CONTRACT_DIFFERENT_PERSON) {
  Deno.test(`S21 different person scores at most 0.3: ${latin}`, () => {
    const score = nameSoundScore(hebrew, [latin]);
    assert(score <= 0.3, `${hebrew} / ${latin} scored ${score}`);
    assertEquals(browserNameSoundScore(hebrew, [latin]), score);
  });
}

Deno.test("alternate x reading preserves established ks matches", () => {
  const pairs: Array<[string, string]> = [
    ["קסנדרה", "Cassandra"],
    ["אריק קסלר", "Eric Kessler"],
    ["קסם", "Kasam"],
    ["קסנדרה קלייר", "Cassandra Clare"],
  ];
  for (const [hebrew, latin] of pairs) {
    assertEquals(nameSoundScore(hebrew, [latin]), 1);
    assertEquals(browserNameSoundScore(hebrew, [latin]), 1);
  }
});

Deno.test("vowel-aware vav reading stays disabled for short tokens", () => {
  const pairs: Array<[string, string]> = [
    ["קול", "Julia"],
    ["קוק", "Chicago"],
    ["קוק", "Cook"],
    ["דור", "Thoreau"],
  ];
  for (const [hebrew, latin] of pairs) {
    assertEquals(nameSoundScore(hebrew, [latin]), 0);
    assertEquals(browserNameSoundScore(hebrew, [latin]), 0);
  }
});

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
