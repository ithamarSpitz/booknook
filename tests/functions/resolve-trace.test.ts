import { assertEquals } from "jsr:@std/assert@1";
import {
  resolveMatch,
  type ResolveTraceEvent,
  type ResolveTraceStop,
} from "../../supabase/functions/_shared/catalog.ts";
import type { HardcoverBook } from "../../supabase/functions/_shared/hardcover.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";
import { edition, FakeDb } from "./helpers/fake-db.ts";

Deno.env.set("HARDCOVER_API_KEY", "test-token");

const noBridge = async () => null;

function book(id: number, title: string, author: string): HardcoverBook {
  return {
    id,
    title,
    users_read_count: 10,
    cached_contributors: [{ author: { name: author } }],
  };
}

function withHardcoverSearch(
  results: (query: string) => HardcoverBook[],
  run: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input, init) => {
    const graphql = JSON.parse(String(init?.body)).query as string;
    const query = graphql.match(/search\(query: "([^"]*)"/)?.[1] ?? "";
    const found = results(query);
    return Promise.resolve(Response.json({
      data: {
        search: {
          ids: found.map(({ id }) => id),
          results: {
            hits: found.map((entry) => ({
              document: {
                id: String(entry.id),
                title: entry.title,
                users_read_count: entry.users_read_count,
                contributions: entry.cached_contributors,
              },
            })),
          },
        },
      },
    }));
  };
  return run().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

function setup(author = "מחבר אחר") {
  const row = edition({
    simania_id: 45,
    title: "כותר עברי",
    author,
  }) as EditionRow;
  return { row, db: new FakeDb({ editions: [row] }) };
}

async function traceMissing(
  stop: ResolveTraceStop,
  options: {
    bridge?: { title: string; author?: string; source: "Wikidata" } | null;
    results?: (query: string) => HardcoverBook[];
  } = {},
): Promise<ResolveTraceEvent[]> {
  const events: ResolveTraceEvent[] = [];
  const { row, db } = setup();
  await withHardcoverSearch(options.results ?? (() => []), async () => {
    const result = await resolveMatch(db, row, {
      wikidataOriginal: async () => options.bridge ?? null,
      nliOriginal: noBridge,
      wikidataEnglishAuthor: noBridge,
      trace: (event) => events.push(event),
    });
    assertEquals(result.found, null);
  });
  assertEquals(
    events.filter((event) => event.type === "stop"),
    [{ type: "stop", stop }],
  );
  return events;
}

Deno.test("resolve trace reports no_original", async () => {
  await traceMissing("no_original");
});

Deno.test("resolve trace reports no_english_author", async () => {
  await traceMissing("no_english_author", {
    bridge: { title: "Wanted Book", source: "Wikidata" },
  });
});

Deno.test("resolve trace reports no_hardcover_result", async () => {
  const events = await traceMissing("no_hardcover_result", {
    bridge: {
      title: "Wanted Book",
      author: "Wanted Author",
      source: "Wikidata",
    },
  });
  assertEquals(events.slice(0, 2), [
    { type: "original", title: "Wanted Book", source: "Wikidata" },
    {
      type: "english_author",
      name: "Wanted Author",
      source: "Wikidata",
    },
  ]);
});

Deno.test("resolve trace reports the real candidate below threshold", async () => {
  const candidate = book(1, "Completely Different", "Wanted Author");
  const events = await traceMissing("title_below_threshold", {
    bridge: {
      title: "Wanted Book",
      author: "Wanted Author",
      source: "Wikidata",
    },
    results: () => [candidate],
  });
  const query = events.find((event) => event.type === "hardcover_query");
  assertEquals(query?.results, 1);
  assertEquals(query?.best_title, "Completely Different");
});

Deno.test("resolve trace counts search candidates before details fallback", async () => {
  const events: ResolveTraceEvent[] = [];
  const { row, db } = setup();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input, init) => {
    const graphql = JSON.parse(String(init?.body)).query as string;
    if (graphql.includes("search(query:")) {
      return Promise.resolve(Response.json({
        data: {
          search: { ids: [1, 2], results: { hits: [] } },
        },
      }));
    }
    return Promise.resolve(Response.json({
      data: { books: [book(1, "Completely Different", "Wanted Author")] },
    }));
  };
  try {
    const result = await resolveMatch(db, row, {
      wikidataOriginal: async () => ({
        title: "Wanted Book",
        author: "Wanted Author",
        source: "Wikidata",
      }),
      nliOriginal: noBridge,
      wikidataEnglishAuthor: noBridge,
      trace: (event) => events.push(event),
    });
    assertEquals(result.found, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const query = events.find((event) => event.type === "hardcover_query");
  assertEquals(query?.results, 2);
  assertEquals(query?.best_title, "Completely Different");
});

Deno.test("resolve trace reports the best candidate rejected by guards", async () => {
  const guarded = book(1, "Wanted Book Companion", "Wanted Author");
  const events = await traceMissing("author_mismatch", {
    bridge: {
      title: "Wanted Book",
      author: "Wanted Author",
      source: "Wikidata",
    },
    results: () => [guarded],
  });
  const query = events.find((event) => event.type === "hardcover_query");
  assertEquals(query?.results, 1);
  assertEquals(query?.best_title, "Wanted Book Companion");
  assertEquals(query?.best_score, 0.8);
});

Deno.test("resolve trace reports author_mismatch", async () => {
  const candidates = [
    book(1, "Wanted Book", "Wrong One"),
    book(2, "Wanted Book", "Wrong Two"),
  ];
  await traceMissing("author_mismatch", {
    bridge: {
      title: "Wanted Book",
      author: "Wanted Author",
      source: "Wikidata",
    },
    results: () => candidates,
  });
});

Deno.test("resolve trace reports guard_rejected", async () => {
  await traceMissing("guard_rejected", {
    bridge: {
      title: "Wanted Book",
      author: "Wrong Author",
      source: "Wikidata",
    },
    results: () => [book(1, "Wanted Book", "Wrong Author")],
  });
});

Deno.test("resolve trace reports both searches in an author retry", async () => {
  const events: ResolveTraceEvent[] = [];
  const { row, db } = setup("Wanted Author");
  await withHardcoverSearch(
    (query) =>
      query === "Wanted Book Wanted Author"
        ? [book(3, "Wanted Book", "Wanted Author")]
        : [
          book(1, "Wanted Book", "Wrong One"),
          book(2, "Wanted Book", "Wrong Two"),
        ],
    async () => {
      const result = await resolveMatch(db, row, {
        wikidataOriginal: async () => ({
          title: "Wanted Book",
          author: "Wanted Author",
          source: "Wikidata",
        }),
        nliOriginal: noBridge,
        wikidataEnglishAuthor: noBridge,
        trace: (event) => events.push(event),
      });
      assertEquals(result.found?.book.id, 3);
    },
  );
  assertEquals(
    events.filter((event) => event.type === "hardcover_query").map((event) =>
      event.query
    ),
    ["Wanted Book", "Wanted Book Wanted Author"],
  );
});
