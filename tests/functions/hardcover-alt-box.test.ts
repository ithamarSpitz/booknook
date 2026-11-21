import { assertEquals } from "jsr:@std/assert@1";
import {
  findHardcoverBook,
  type HardcoverBook,
} from "../../supabase/functions/_shared/hardcover.ts";

function book(id: number, title: string, author: string, readers: number): HardcoverBook {
  return {
    id,
    title,
    users_read_count: readers,
    cached_contributors: [{ author: { name: author } }],
  };
}

function stub(books: HardcoverBook[], alternatives: Record<number, string[]> = {}, withResults = true) {
  const original = globalThis.fetch;
  const queries: string[] = [];
  globalThis.fetch = (_input, init) => {
    const query = JSON.parse(String(init?.body)).query as string;
    if (query.includes("search(")) {
      queries.push(query);
      const search: Record<string, unknown> = { ids: books.map((b) => b.id) };
      if (withResults && query.includes("ids results")) {
        search.results = {
          found: books.length,
          hits: books.map((b) => ({
            document: {
              id: String(b.id),
              title: b.title,
              ...(alternatives[b.id] ? { alternative_titles: alternatives[b.id] } : {}),
            },
          })),
        };
      }
      return Promise.resolve(Response.json({ data: { search } }));
    }
    if (query.includes("books(")) {
      const ids = JSON.parse(query.match(/id:\{_in:(\[[^\]]*\])\}/)?.[1] ?? "[]") as number[];
      return Promise.resolve(
        Response.json({ data: { books: books.filter((b) => ids.includes(b.id)) } }),
      );
    }
    return Promise.resolve(Response.json({ data: {} }));
  };
  return { queries, restore: () => (globalThis.fetch = original) };
}

Deno.env.set("HARDCOVER_API_KEY", "test-token");

Deno.test("alternative titles pick The Rebel for L'Homme révolté", async () => {
  const s = stub([
    book(1851773, "La révolte: La peste, Les Justes, L'homme révolté", "Albert Camus", 1),
    book(488917, "The Rebel", "Albert Camus", 407),
  ], { 488917: ["L'Homme révolté", "Man in Revolt"] });
  try {
    const result = await findHardcoverBook("L'Homme révolté", "Albert Camus");
    assertEquals(result?.id, 488917);
    assertEquals(s.queries.every((q) => q.includes("ids results")), true);
  } finally {
    s.restore();
  }
});

const hunger = [
  book(88639, "The Hunger Games", "Suzanne Collins", 13743),
  book(593165, "The Hunger Games Trilogy", "Suzanne Collins", 423),
];

Deno.test("boxTitle picks the box book", async () => {
  const s = stub(hunger);
  try {
    const result = await findHardcoverBook("The Hunger Games Trilogy", "Suzanne Collins", {
      boxTitle: true,
    });
    assertEquals(result?.id, 593165);
  } finally {
    s.restore();
  }
});

Deno.test("boxTitle returns null without a box book", async () => {
  const s = stub([hunger[0]]);
  try {
    assertEquals(
      await findHardcoverBook("The Hunger Games Trilogy", "Suzanne Collins", { boxTitle: true }),
      null,
    );
  } finally {
    s.restore();
  }
});

Deno.test("boxTitle returns null for a box book by another author", async () => {
  const s = stub([book(5, "The Hunger Games Trilogy", "Someone Else", 10)]);
  try {
    assertEquals(
      await findHardcoverBook("The Hunger Games Trilogy", "Suzanne Collins", { boxTitle: true }),
      null,
    );
  } finally {
    s.restore();
  }
});

Deno.test("missing results behaves as before S31", async () => {
  const s = stub([
    book(1, "Aurora", "David Koepp", 50),
    book(2, "Aurora", "Other Person", 40),
  ], {}, false);
  try {
    assertEquals((await findHardcoverBook("Aurora", "David Koepp"))?.id, 1);
    assertEquals(await findHardcoverBook("Aurora", ""), null);
  } finally {
    s.restore();
  }
});

Deno.test("missing results keeps Paris Apartment pick", async () => {
  const s = stub([
    book(1, "The Paris Apartment", "Lucy Foley", 100),
    book(2, "The Paris Apartment", "Kelly Bowen", 90),
  ], {}, false);
  try {
    assertEquals((await findHardcoverBook("Paris apartment", "Lucy Foley"))?.id, 1);
  } finally {
    s.restore();
  }
});
