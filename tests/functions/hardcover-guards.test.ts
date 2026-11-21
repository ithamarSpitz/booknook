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

function stub(books: HardcoverBook[]) {
  const original = globalThis.fetch;
  globalThis.fetch = (_input, init) => {
    const query = JSON.parse(String(init?.body)).query as string;
    if (query.includes("search(")) {
      return Promise.resolve(
        Response.json({ data: { search: { ids: books.map((b) => b.id) } } }),
      );
    }
    if (query.includes("books(")) {
      const ids = JSON.parse(query.match(/id:\{_in:(\[[^\]]*\])\}/)?.[1] ?? "[]") as number[];
      return Promise.resolve(
        Response.json({ data: { books: books.filter((b) => ids.includes(b.id)) } }),
      );
    }
    return Promise.resolve(Response.json({ data: {} }));
  };
  return () => (globalThis.fetch = original);
}

Deno.env.set("HARDCOVER_API_KEY", "test-token");

const RIGGS = "Ransom Riggs";
const art = book(609448, "The Art of Miss Peregrine's Home for Peculiar Children", RIGGS, 3);
const boxed = book(609447, "Miss Peregrine's Peculiar Children Boxed Set: 3 Novels", RIGGS, 4);
const real = book(438396, "Miss Peregrine's Home for Peculiar Children", RIGGS, 20000);
const QUERY = "Miss Peregrine's Home of Peculiar Children";

Deno.test("box set and companion are dropped for a single book", async () => {
  const restore = stub([art, boxed, real]);
  try {
    assertEquals((await findHardcoverBook(QUERY, RIGGS))?.id, 438396);
  } finally {
    restore();
  }
});

Deno.test("without the real book nothing is returned", async () => {
  const restore = stub([art, boxed]);
  try {
    assertEquals(await findHardcoverBook(QUERY, RIGGS), null);
  } finally {
    restore();
  }
});

Deno.test("query containing the companion phrase keeps the book", async () => {
  const racing = book(1, "The Art of Racing in the Rain", "Garth Stein", 100);
  const restore = stub([racing]);
  try {
    assertEquals((await findHardcoverBook("The Art of Racing in the Rain", "Garth Stein"))?.id, 1);
  } finally {
    restore();
  }
});

Deno.test("boxTitle still accepts a trilogy", async () => {
  const trilogy = book(593165, "The Hunger Games Trilogy", "Suzanne Collins", 100);
  const restore = stub([trilogy]);
  try {
    const found = await findHardcoverBook("The Hunger Games Trilogy", "Suzanne Collins", {
      boxTitle: true,
    });
    assertEquals(found?.id, 593165);
  } finally {
    restore();
  }
});

Deno.test("world companion is dropped for A Game of Thrones", async () => {
  const martin = "George R. R. Martin";
  const companion = book(
    2,
    "The World of Ice and Fire: The Untold History of Westeros and the Game of Thrones",
    martin,
    50000,
  );
  const got = book(3, "A Game of Thrones", martin, 100);
  const restore = stub([companion, got]);
  try {
    assertEquals((await findHardcoverBook("A Game of Thrones", martin))?.id, 3);
  } finally {
    restore();
  }
});
