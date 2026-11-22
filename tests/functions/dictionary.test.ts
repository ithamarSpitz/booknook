import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  dictionaryScore,
  pickByDictionary,
  wordForms,
} from "../../scripts/lib/dictionary.ts";
import {
  ProviderError,
  wiktionaryGlosses,
} from "../../supabase/functions/_shared/bridges.ts";

const glosses = (answers: Record<string, string[]>) => (word: string) =>
  Promise.resolve(answers[word] ?? []);

Deno.test("dictionaryScore covers a translated content word", async () => {
  assertEquals(
    await dictionaryScore("עשב", "Grass", glosses({ עשב: ["grass"] })),
    1,
  );
});

Deno.test("pickByDictionary picks the unique score above the threshold", async () => {
  assertEquals(
    await pickByDictionary("Thinner", [
      { simania_id: 1, title: "רזה" },
      { simania_id: 2, title: "זה" },
      { simania_id: 3, title: "הניצוץ" },
    ], glosses({ רזה: ["thin, lean"] })),
    { simania_id: 1, title: "רזה" },
  );
  assertEquals(
    await pickByDictionary("The Nickel Boys", [
      { simania_id: 4, title: "נערי ניקל" },
      { simania_id: 5, title: "מחתרת המסילה" },
    ], glosses({ נער: ["boy, youth"] })),
    null,
  );
});

Deno.test("pickByDictionary rejects ties and scores below one half", async () => {
  assertEquals(
    await pickByDictionary("Grass", [
      { simania_id: 1, title: "עשב" },
      { simania_id: 2, title: "דשא" },
    ], glosses({ עשב: ["grass"], דשא: ["grass"] })),
    null,
  );
  assertEquals(
    await pickByDictionary("One Two Three Four Five", [
      { simania_id: 3, title: "כותרת" },
    ], glosses({ כותרת: ["one two"] })),
    null,
  );
});

Deno.test("wordForms removes a leading conjunction and article", () => {
  assert(wordForms("והבית").includes("בית"));
});

async function withFetch(
  fetcher: typeof fetch,
  run: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("wiktionaryGlosses handles missing pages and reads only Hebrew definitions", async () => {
  await withFetch(
    () => Promise.resolve(new Response("missing", { status: 404 })),
    async () => assertEquals(await wiktionaryGlosses("לאקיים"), []),
  );
  await withFetch(
    (input) => {
      assert(String(input).endsWith(`/${encodeURIComponent("עשב")}`));
      return Promise.resolve(
        new Response(JSON.stringify({
          en: [{ definitions: [{ definition: "weed" }] }],
          he: [
            { definitions: [{ definition: "<b>Grass</b>" }] },
            { definitions: [{ definition: "HERB" }] },
          ],
        })),
      );
    },
    async () => assertEquals(await wiktionaryGlosses("עשב"), ["grass", "herb"]),
  );
});

Deno.test("wiktionaryGlosses retries a server error then throws ProviderError", async () => {
  let calls = 0;
  await withFetch(
    () => {
      calls++;
      return Promise.resolve(new Response("down", { status: 500 }));
    },
    async () => {
      await assertRejects(() => wiktionaryGlosses("עשב"), ProviderError);
    },
  );
  assertEquals(calls, 2);
});
