import { assertEquals } from "jsr:@std/assert@1";
import {
  findHardcoverBook,
  type HardcoverBook,
} from "../../supabase/functions/_shared/hardcover.ts";

function book(
  id: number,
  title: string,
  author: string,
  readers: number,
): HardcoverBook {
  return {
    id,
    title,
    users_read_count: readers,
    cached_contributors: [{ author: { name: author } }],
  };
}

function stubHardcover(
  resultsByQuery: Record<string, HardcoverBook[]>,
  resultsPayload: Record<string, unknown> = {},
) {
  const originalFetch = globalThis.fetch;
  const allBooks = new Map(
    Object.values(resultsByQuery).flat().map((entry) => [entry.id, entry]),
  );
  let searchCount = 0;
  globalThis.fetch = (_input, init) => {
    const query = JSON.parse(String(init?.body)).query as string;
    if (query.includes("search(")) {
      searchCount++;
      const text = query.match(/search\(query: "([^"]*)"/)?.[1] ?? "";
      const ids = (resultsByQuery[text] ?? []).map((entry) => entry.id);
      const results = query.includes("ids results") ? resultsPayload[text] : undefined;
      return Promise.resolve(
        Response.json({ data: { search: { ids, ...(results ? { results } : {}) } } }),
      );
    }
    if (query.includes("books(")) {
      const encodedIds = query.match(/id:\{_in:(\[[^\]]*\])\}/)?.[1] ?? "[]";
      const books = (JSON.parse(encodedIds) as number[])
        .map((id) => allBooks.get(id))
        .filter((entry): entry is HardcoverBook => entry !== undefined);
      return Promise.resolve(Response.json({ data: { books } }));
    }
    return Promise.resolve(Response.json({ data: {} }));
  };
  return {
    searches: () => searchCount,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

Deno.env.set("HARDCOVER_API_KEY", "test-token");

const wildTitle = [
  book(1, "Wild", "Kristin Hannah", 100),
  book(2, "Wild", "Adrienne Wilder", 90),
  book(3, "Wild", "D.D. Prince", 80),
  book(4, "Wild", "Meghan O'Brien", 70),
  book(5, "Wild", "Sophie Jordan", 60),
  book(6, "Wild", "Renee Rose", 50),
  book(7, "Wild", "Jay Griffiths", 40),
  book(8, "Wild", "Hannah Moskowitz", 30),
];
const wildRetry = [
  book(779562, "Wild: by Cheryl Strayed", "Trivion Books", 6),
  book(
    52808,
    "Wild: From Lost to Found on the Pacific Crest Trail",
    "Cheryl Strayed",
    1259,
  ),
  book(
    2329653,
    "Wild: over jezelf verliezen, terugvinden & 1700 kilometer hiken",
    "Cheryl Strayed",
    1,
  ),
];

Deno.test("Wild retries with the Latin author and keeps legacy opt-in behavior", async () => {
  const results = {
    Wild: wildTitle,
    "Wild Cheryl Strayed": wildRetry,
  };
  const withoutRetry = stubHardcover(results);
  try {
    assertEquals(await findHardcoverBook("Wild", "Cheryl Strayed"), null);
    assertEquals(withoutRetry.searches(), 1);
  } finally {
    withoutRetry.restore();
  }

  const withRetry = stubHardcover(results);
  try {
    const result = await findHardcoverBook("Wild", "Cheryl Strayed", {
      retryWithAuthor: true,
    });
    assertEquals(result?.id, 52808);
    assertEquals(withRetry.searches(), 2);
  } finally {
    withRetry.restore();
  }
});

Deno.test("Night School retry prefers the exact author-backed title", async () => {
  const stub = stubHardcover({
    "Night School": [],
    "Night School C.J. Daugherty": [
      book(61420, "Night School", "C.J. Daugherty", 73),
      book(2222086, "Night School: The Short Stories", "C.J. Daugherty", 1),
    ],
  });
  try {
    const result = await findHardcoverBook("Night School", "C.J. Daugherty", {
      retryWithAuthor: true,
    });
    assertEquals(result?.id, 61420);
    assertEquals(stub.searches(), 2);
  } finally {
    stub.restore();
  }
});

Deno.test("a Hebrew-only author hint does not retry an ambiguous title", async () => {
  const stub = stubHardcover({
    Aurora: [
      book(372879, "Aurora", "Kim Stanley Robinson", 50_000),
      book(559469, "Aurora", "David Koepp", 200),
    ],
  });
  try {
    const result = await findHardcoverBook("Aurora", "קופ, דוד", {
      retryWithAuthor: true,
    });
    assertEquals(result, null);
    assertEquals(stub.searches(), 1);
  } finally {
    stub.restore();
  }
});

Deno.test("a first-pass hit is final when retry is enabled", async () => {
  const stub = stubHardcover({
    "The Paris Apartment": [
      book(601, "The Paris Apartment", "Lucy Foley", 40_000),
    ],
    "The Paris Apartment Lucy Foley": [
      book(999, "The Paris Apartment", "Someone Else", 1),
    ],
  });
  try {
    const result = await findHardcoverBook(
      "The Paris Apartment",
      "Lucy Foley",
      { retryWithAuthor: true },
    );
    assertEquals(result?.id, 601);
    assertEquals(stub.searches(), 1);
  } finally {
    stub.restore();
  }
});

const ferranteTitle = "Storia di chi fugge e di chi resta";
function ferranteStub(author: string, withResults: boolean) {
  const hit = book(101133, "Those Who Leave and Those Who Stay", author, 500);
  return stubHardcover(
    {
      [ferranteTitle]: [book(101133, "Those Who Leave and Those Who Stay", "Elena Ferrante", 500)],
      [`${ferranteTitle} Elena Ferrante`]: [hit],
    },
    withResults
      ? {
        [`${ferranteTitle} Elena Ferrante`]: {
          hits: [{ document: { id: "101133", alternative_titles: [ferranteTitle] } }],
        },
      }
      : {},
  );
}

Deno.test("alternative titles let the retry match Ferrante", async () => {
  const stub = ferranteStub("Elena Ferrante", true);
  try {
    const result = await findHardcoverBook(ferranteTitle, "Elena Ferrante", {
      retryWithAuthor: true,
    });
    assertEquals(result?.id, 101133);
  } finally {
    stub.restore();
  }
});

Deno.test("retry without results has no alternative titles", async () => {
  const stub = ferranteStub("Elena Ferrante", false);
  try {
    const result = await findHardcoverBook(ferranteTitle, "Elena Ferrante", {
      retryWithAuthor: true,
    });
    assertEquals(result, null);
  } finally {
    stub.restore();
  }
});

Deno.test("an alternative title still needs author evidence", async () => {
  const stub = ferranteStub("Someone Else", true);
  try {
    const result = await findHardcoverBook(ferranteTitle, "Elena Ferrante", {
      retryWithAuthor: true,
    });
    assertEquals(result, null);
  } finally {
    stub.restore();
  }
});

Deno.test("Survive uses the Hebrew author sound only when provided", async () => {
  const results = {
    Survive: [
      book(105197, "Survive", "Alex Morel", 6),
      book(999001, "Survive", "Other Writer", 50),
    ],
  };
  const withoutSound = stubHardcover(results);
  try {
    assertEquals(await findHardcoverBook("Survive", "מורל, אלכס"), null);
  } finally {
    withoutSound.restore();
  }

  const withSound = stubHardcover(results);
  try {
    const result = await findHardcoverBook("Survive", "מורל, אלכס", {
      soundAuthor: "אלכס מורל",
    });
    assertEquals(result?.id, 105197);
  } finally {
    withSound.restore();
  }
});

Deno.test("Regeneration uses parenthetical Hebrew spelling variants", async () => {
  const stub = stubHardcover({
    Regeneration: [
      book(435858, "Regeneration", "Pat Barker", 178),
      book(232435, "Regeneration", "Julie E. Czerneda", 16),
      book(469579, "Regeneration", "Stephanie Saulter", 5),
    ],
  });
  try {
    const result = await findHardcoverBook("Regeneration", "", {
      soundAuthor: "פאט (פט) בארקר (ברקר)",
    });
    assertEquals(result?.id, 435858);
  } finally {
    stub.restore();
  }
});

Deno.test("soundAuthor does not resolve books by unrelated authors", async () => {
  const stub = stubHardcover({
    Survive: [
      book(10, "Survive", "Bear Grylls", 100),
      book(11, "Survive", "Other Writer", 50),
    ],
  });
  try {
    const result = await findHardcoverBook("Survive", "", {
      soundAuthor: "אלכס מורל",
    });
    assertEquals(result, null);
  } finally {
    stub.restore();
  }
});
