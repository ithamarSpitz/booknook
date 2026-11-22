import { assertEquals } from "jsr:@std/assert@1";
import {
  dictionaryVerdict,
  pickByDictionary,
  wordForms,
} from "../../scripts/lib/dictionary.ts";

function glossesFor(
  words: Record<string, string[]>,
): (word: string) => Promise<string[]> {
  const answers: Record<string, string[]> = {};
  for (const [word, answer] of Object.entries(words)) {
    for (const form of wordForms(word)) answers[form] = [];
    answers[word] = answer;
  }
  return (word) => Promise.resolve(answers[word] ?? []);
}

Deno.test("dictionary contradictions reject green Mars and accept red Mars", async () => {
  const glosses = glossesFor({
    מאדים: ["Mars"],
    ירוק: ["green"],
    אדום: ["red"],
  });
  assertEquals(await dictionaryVerdict("מאדים הירוק", "Red Mars", glosses), {
    english: 0.5,
    hebrew: 0.5,
    contradicted: 1,
  });
  assertEquals(
    await pickByDictionary("Red Mars", [
      { simania_id: 1, title: "מאדים הירוק" },
    ], glosses),
    null,
  );
  assertEquals(
    await pickByDictionary("Red Mars", [
      { simania_id: 2, title: "מאדים האדום" },
    ], glosses),
    { simania_id: 2, title: "מאדים האדום" },
  );
});

Deno.test("dictionary unknown words lower Hebrew coverage without contradicting", async () => {
  const glosses = glossesFor({
    הנסיכה: [],
    נסיכה: ["princess"],
    מתגעגעת: [],
  });
  assertEquals(
    await dictionaryVerdict("הנסיכה מתגעגעת", "The Princess Diaries", glosses),
    { english: 0.5, hebrew: 0.5, contradicted: 0 },
  );
  assertEquals(
    await pickByDictionary("The Princess Diaries", [
      { simania_id: 3, title: "הנסיכה מתגעגעת" },
    ], glosses),
    null,
  );
});

Deno.test("dictionary accepts a complete one-word translation", async () => {
  assertEquals(
    await pickByDictionary("Grass", [
      { simania_id: 4, title: "עשב" },
    ], glossesFor({ עשב: ["grass"] })),
    { simania_id: 4, title: "עשב" },
  );
});

Deno.test("dictionary rejects two qualifying candidates with the same score", async () => {
  assertEquals(
    await pickByDictionary("Grass", [
      { simania_id: 5, title: "עשב" },
      { simania_id: 6, title: "דשא" },
    ], glossesFor({ עשב: ["grass"], דשא: ["grass"] })),
    null,
  );
});
