import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  ProviderError,
  wikidataEnglishAuthor,
  wikidataOriginal,
} from "../../supabase/functions/_shared/bridges.ts";
import { ensureResolved } from "../../supabase/functions/_shared/catalog.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";
import { edition, FakeDb } from "./helpers/fake-db.ts";

function withFetch(
  fetcher: typeof fetch,
  run: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetcher;
  return run().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

Deno.test("wikidataOriginal throws ProviderError for a Wikidata error body", () =>
  withFetch(
    () => Promise.resolve(new Response('{"error":{"code":"maxlag"}}')),
    async () => {
      await assertRejects(() => wikidataOriginal("ספר"), ProviderError);
    },
  ));

Deno.test("wikidataOriginal throws ProviderError when an entity response omits entities", () =>
  withFetch(
    (input) => {
      const action = new URL(String(input)).searchParams.get("action");
      const body = action === "wbsearchentities"
        ? '{"search":[{"id":"Q1","label":"Book"}]}'
        : "{}";
      return Promise.resolve(new Response(body));
    },
    async () => {
      await assertRejects(() => wikidataOriginal("ספר"), ProviderError);
    },
  ));

Deno.test("wikidataEnglishAuthor propagates provider errors but returns null for no match", async () => {
  await withFetch(
    () => Promise.resolve(new Response('{"error":{"code":"maxlag"}}')),
    async () => {
      await assertRejects(() => wikidataEnglishAuthor("סופר"), ProviderError);
    },
  );
  await withFetch(
    () => Promise.resolve(new Response('{"search":[]}')),
    async () => {
      assertEquals(await wikidataEnglishAuthor("סופר"), null);
    },
  );
});

for (const failedAction of ["wbsearchentities", "wbgetentities"]) {
  Deno.test(`wikidataEnglishAuthor propagates HTTP errors from ${failedAction}`, () =>
    withFetch(
      (input) => {
        const action = new URL(String(input)).searchParams.get("action");
        return Promise.resolve(action === failedAction
          ? new Response("Bad request", { status: 400 })
          : new Response('{"search":[{"id":"Q1"}]}'));
      },
      async () => {
        await assertRejects(
          () => wikidataEnglishAuthor("Author"),
          ProviderError,
          "www.wikidata.org returned 400",
        );
      },
    ));
}

Deno.test("ensureResolved stays pending after Wikidata failures and still tries the NLI creator", async () => {
  const current = edition() as EditionRow;
  const db = new FakeDb({ editions: [current] });
  const hardcoverHints: Array<string | undefined> = [];
  const result = await ensureResolved(db, current, {
    now: () => new Date("2026-11-02T10:00:00.000Z"),
    wikidataOriginal: async () => {
      throw new ProviderError("Wikidata search failed");
    },
    nliOriginal: async () => ({
      title: "Original title",
      author: "NLI creator",
      source: "NLI",
    }),
    wikidataEnglishAuthor: async () => {
      throw new ProviderError("Wikidata author search failed");
    },
    findHardcoverBook: async (_title, author) => {
      hardcoverHints.push(author);
      return null;
    },
  });

  assertEquals(hardcoverHints[0], "NLI creator");
  assertEquals(result.resolve_status, "pending");
  assertEquals(result.resolved_at, null);
  assertEquals(result.work_id, null);
});

Deno.test("FakeDb gives inserted works unique generated ids", async () => {
  const db = new FakeDb();
  const first = await db.from("works").insert({ original_title: "First" })
    .select().single();
  const second = await db.from("works").insert({ original_title: "Second" })
    .select().single();

  assertEquals(first.data.id, "work-1");
  assertEquals(second.data.id, "work-2");
  assertEquals(db.tables.works.map((work) => work.id), ["work-1", "work-2"]);
});
