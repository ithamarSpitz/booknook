import {
  assert,
  assertEquals,
  assertFalse,
} from "jsr:@std/assert@1";
import {
  hebrewAuthorBySound,
  hebrewSpellings,
  sameAuthor,
  surnameSpellings,
} from "../../supabase/functions/_shared/author-sound.ts";

Deno.test("sameAuthor accepts known Hebrew spellings", () => {
  const cases = [
    ["ג'וליה קווין", "Julia Quinn"],
    ["כריסטין האנה", "Kristin Hannah"],
    ["דין קונץ", "Dean Koontz"],
    ["קייט די קמילו", "Kate DiCamillo"],
    ["קייט די-קמילו", "Kate DiCamillo"],
    ["ג׳וליה וולטון", "Julia Walton"],
    ["אשכר ארבליך-בריפמן", "Eshkar Erblich-Brifman"],
    ["ורוניקה רוֹת", "Veronica Roth"],
    ["סטיפן קינג", "Stephen King"],
    ["א.ד. מילר", "A.D. Miller"],
  ];
  for (const [hebrew, english] of cases) {
    assert(sameAuthor(hebrew, english), `${hebrew} / ${english}`);
  }
});

Deno.test("sameAuthor rejects different people with similar names", () => {
  const cases = [
    ["בריאן רוט", "Veronica Roth"],
    ["ג׳קלין מוריארטי", "Liane Moriarty"],
    ["אליה שוסטרמן", "Neal Shusterman"],
    ["רוי אדמס", "Sarah Adams"],
    ["הנרי פילדינג", "Helen Fielding"],
    ["אמה צ׳יצ׳סטר קלרק", "Amy Suiter Clarke"],
    ["הנרי מילר", "A.D. Miller"],
    ["פנינה", "A.J. Finn"],
    ["סטיבן קונץ", "Dean Koontz"],
    ["אורסולה ג'ונס", "Ursula K. Le Guin"],
  ];
  for (const [hebrew, english] of cases) {
    assertFalse(sameAuthor(hebrew, english), `${hebrew} / ${english}`);
  }
});

Deno.test("hebrewSpellings generates ordered Hebrew transliterations", () => {
  assert(hebrewSpellings("Burgess").includes("ברג'ס"));
  assertEquals(hebrewSpellings("Julia", 4)[0], "ג'וליה");
  assert(surnameSpellings("DiCamillo").includes("די קמילו"));
});

Deno.test("hebrewAuthorBySound skips search for surnames without Latin letters", async () => {
  let calls = 0;
  const fake = () => {
    calls++;
    return Promise.resolve([]);
  };
  assertEquals(await hebrewAuthorBySound("Фёдор Достоевский", fake), null);
  assertEquals(await hebrewAuthorBySound("Иванов", fake), null);
  assertEquals(calls, 0);
  await hebrewAuthorBySound("Stephen King", fake);
  assert(calls > 0);
});
