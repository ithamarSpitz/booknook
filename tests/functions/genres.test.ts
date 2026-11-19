import { assertEquals } from "jsr:@std/assert@1";
import {
  buildGenreShelves,
  genreCandidates,
  genreDisplayName,
  type GenreSeed,
  missingCandidateIds,
  normalizeGenreTag,
  qualifyingGenres,
  readerGenres,
  workGenres,
} from "../../supabase/functions/_shared/genres.ts";

const tags = (...values: string[]) => ({
  Genre: values.map((tag) => ({ tag })),
});

function seed(
  workId: string,
  weight: number,
  genres: string[],
  similarIds: number[] = [],
  simaniaId = 0,
): GenreSeed {
  return { workId, simaniaId, weight, tags: tags(...genres), similarIds };
}

Deno.test("genre tags normalize and use the contracted aliases", () => {
  assertEquals(
    normalizeGenreTag(' ["Historical-Fiction"]\\ '),
    "historical fiction",
  );
  assertEquals(
    workGenres(tags("Thriller", '["Thriller', "Historical-Fiction", "Humour")),
    ["מותחנים", "רומן היסטורי", "הומור"],
  );
});

Deno.test("noise genre tags are discarded", () => {
  const exactNoise = [
    "general",
    "fiction",
    "genre fiction",
    "novel",
    "novels",
    "adult",
    "adult fiction",
    "literary collections",
    "authors",
    "audiobook",
    "audiobooks",
    "ebook",
    "ebooks",
    "english fiction",
    "american fiction",
    "british fiction",
    "english",
    "spanish",
    "hebrew",
    "french",
    "german",
    "book club",
    "did not finish",
    "dnf",
    "owned",
    "kindle",
  ];
  for (
    const value of [
      ...exactNoise,
      "physical-tbr",
      "want to read next",
      "favorites",
      "favourite books",
      "Read in 2024",
      "2023",
    ]
  ) {
    assertEquals(workGenres(tags(value)), [], value);
  }
});

Deno.test("compound tags split only when every part is an alias", () => {
  assertEquals(workGenres(tags("Science Fiction & Fantasy")), [
    "מדע בדיוני",
    "פנטזיה",
  ]);
  assertEquals(workGenres(tags("Family & Relationships")), ["משפחה"]);
  assertEquals(workGenres(tags("Action & Adventure")), ["הרפתקאות"]);
  assertEquals(workGenres(tags("Foo & Fantasy")), ["en:foo & fantasy"]);
});

Deno.test("unknown genres use normalized keys and contracted display spelling", () => {
  const seeds = [
    seed("first", 1, ["Fantasy", "Cli-Fi"]),
    seed("second", 1, ["CLI FI"]),
  ];
  assertEquals(workGenres(seeds[0].tags), ["פנטזיה", "en:cli fi"]);
  assertEquals(genreDisplayName("en:cli fi", seeds, new Map()), "Cli-Fi");
  assertEquals(
    genreDisplayName(
      "en:cli fi",
      [],
      new Map([
        [20, { id: "later", tags: tags("CLI FI") }],
        [10, { id: "first", tags: tags("[Cli-Fi]") }],
      ]),
    ),
    "Cli-Fi",
  );
});

Deno.test("work genres collapse duplicates, preserve order, and read twelve tags", () => {
  assertEquals(
    workGenres(tags(
      "Fantasy",
      "Epic Fantasy",
      "History",
      "General",
      "Fiction",
      "Audiobooks",
      "Unknown One",
      "Unknown Two",
      "War",
      "Science",
      "Humor",
      "Classics",
      "Romance",
    )),
    [
      "פנטזיה",
      "היסטוריה",
      "en:unknown one",
      "en:unknown two",
      "מלחמה",
      "מדע",
      "הומור",
      "קלאסיקות",
    ],
  );
});

Deno.test("legacy Hebrew shelf names remain the keys for aliased genres", () => {
  assertEquals(workGenres(tags("Fantasy", "Mystery", "Non-Fiction")), [
    "פנטזיה",
    "מתח ובלש",
    "עיון",
  ]);
});

Deno.test("qualifying genres require two seeds and order by evidence, count, then name", () => {
  const seeds = [
    seed("1", 3, ["Fantasy", "Science Fiction", "History"]),
    seed("2", 2, ["Fantasy", "Space", "History"]),
    seed("3", 0, ["History"]),
    seed("4", 5, ["Horror"]),
  ];
  assertEquals(
    qualifyingGenres(seeds).map(({ genre, evidence, count }) => ({
      genre,
      evidence,
      count,
    })),
    [
      { genre: "היסטוריה", evidence: 5, count: 3 },
      { genre: "מדע בדיוני", evidence: 5, count: 2 },
      { genre: "פנטזיה", evidence: 5, count: 2 },
    ],
  );
});

Deno.test("candidate scores sum by zero-based rank and sort deterministically", () => {
  assertEquals(
    genreCandidates("פנטזיה", [
      seed("1", 4, ["Fantasy"], [20, 10]),
      seed("2", 2, ["Fantasy"], [10]),
    ]),
    [
      {
        hardcoverId: 10,
        score: 5.9,
        contributors: [
          { simaniaId: 0, contribution: 3.9 },
          { simaniaId: 0, contribution: 2 },
        ],
      },
      {
        hardcoverId: 20,
        score: 4,
        contributors: [{ simaniaId: 0, contribution: 4 }],
      },
    ],
  );
});

Deno.test("not-my-type seeds lower and reorder genre books without changing qualification", () => {
  const seeds = [
    seed("1", 5, ["Fantasy"], [100, 101, 102, 103, 104], 11),
    seed("2", 4, ["Fantasy"], [100, 101, 102, 103, 104], 12),
  ];
  const works = new Map(
    [100, 101, 102, 103, 104].map((id) => [
      id,
      { id: `work-${id}`, tags: tags("Fantasy") },
    ]),
  );
  const withoutNegative = buildGenreShelves({
    seeds,
    worksByHardcoverId: works,
    excludedWorkIds: new Set(),
  });
  const withNegative = buildGenreShelves({
    seeds,
    negativeSeeds: [{ similarIds: [100] }],
    worksByHardcoverId: works,
    excludedWorkIds: new Set(),
  });

  assertEquals(qualifyingGenres(seeds).map(({ genre }) => genre), ["פנטזיה"]);
  assertEquals(withoutNegative[0].genreKey, "פנטזיה");
  assertEquals(withoutNegative[0].genre, "פנטזיה");
  assertEquals(withoutNegative[0].books[0].hardcoverId, 100);
  assertEquals(withNegative[0].books[0].hardcoverId, 101);
  assertEquals(withNegative[0].books[4].hardcoverId, 100);
  assertEquals(withNegative[0].books[4].because, [11, 12]);
});

Deno.test("genre shelf reasons order contributors, omit non-contributors, and cap at ten", () => {
  const contributingSeeds = Array.from({ length: 12 }, (_, index) =>
    seed(
      `seed-${index}`,
      index < 2 ? 5 : 4,
      ["Fantasy"],
      [100, 101, 102, 103],
      index < 2 ? 20 - index * 10 : 30 + index,
    ));
  const absent = seed("absent", 10, ["Fantasy"], [999], 1);
  const works = new Map(
    [100, 101, 102, 103].map((id) => [
      id,
      { id: `work-${id}`, tags: tags("Fantasy") },
    ]),
  );

  const shelves = buildGenreShelves({
    seeds: [...contributingSeeds, absent],
    worksByHardcoverId: works,
    excludedWorkIds: new Set(),
  });

  assertEquals(shelves[0].books[0].score, 5 + 5 + 10 * 4);
  assertEquals(shelves[0].books[0].because, [
    10,
    20,
    32,
    33,
    34,
    35,
    36,
    37,
    38,
    39,
  ]);
});

Deno.test("shelves skip exclusions and repeats, drop short genres, cap books and shelves", () => {
  const genreAliases = [
    "Fantasy",
    "Horror",
    "History",
    "War",
    "Science",
    "Humor",
    "Philosophy",
  ];
  const seeds: GenreSeed[] = genreAliases.flatMap((genre, index) => [
    seed(
      `${genre}-a`,
      10 - index,
      [genre],
      Array.from({ length: 15 }, (_, i) => index * 100 + i + 1),
    ),
    seed(
      `${genre}-b`,
      10 - index,
      [genre],
      index === 1 ? [1, 101, 102, 103] : [],
    ),
  ]);
  const works = new Map<
    number,
    { id: string; tags: ReturnType<typeof tags> }
  >();
  for (const [index, genre] of genreAliases.entries()) {
    const count = index === 2 ? 3 : 15;
    for (let i = 1; i <= count; i++) {
      works.set(index * 100 + i, {
        id: `work-${index}-${i}`,
        tags: tags(genre),
      });
    }
  }
  // Candidate 1 is already used by Fantasy and cannot reappear on Horror.
  works.set(1, { id: "shared", tags: tags("Fantasy", "Horror") });

  const result = buildGenreShelves({
    seeds,
    worksByHardcoverId: works,
    excludedWorkIds: new Set(["work-0-2"]),
  });
  assertEquals(result.length, 5);
  assertEquals(result[0].books.length, 12);
  assertEquals(result.some(({ genre }) => genre === "היסטוריה"), false);
  assertEquals(
    result[1].books.some(({ workId }) => workId === "shared"),
    false,
  );
});

Deno.test("zero qualifying genres gives no shelves", () => {
  assertEquals(
    buildGenreShelves({
      seeds: [seed("only", 5, ["Fantasy"], [1, 2, 3, 4])],
      worksByHardcoverId: new Map(),
      excludedWorkIds: new Set(),
    }),
    [],
  );
});

Deno.test("missing candidates use best cross-genre score, loaded IDs, limit, and stable ties", () => {
  const seeds = [
    seed("f1", 4, ["Fantasy"], [3, 2, 1]),
    seed("f2", 4, ["Fantasy"], [3]),
    seed("h1", 5, ["History"], [2]),
    seed("h2", 5, ["History"], [4]),
  ];
  assertEquals(
    missingCandidateIds(seeds, new Map([[3, { id: "loaded", tags: {} }]]), 2),
    [2, 4],
  );
});

Deno.test("genre shelf computation is deterministic", () => {
  const seeds = [
    seed("a", 5, ["Fantasy"], [4, 3, 2, 1]),
    seed("b", 4, ["Fantasy"], [1, 2, 3, 4]),
  ];
  const works = new Map(
    [1, 2, 3, 4].map((id) => [id, { id: `w${id}`, tags: tags("Fantasy") }]),
  );
  const input = {
    seeds,
    worksByHardcoverId: works,
    excludedWorkIds: new Set<string>(),
  };
  assertEquals(buildGenreShelves(input), buildGenreShelves(input));
});

type TestWork = { id: string; tags: ReturnType<typeof tags> };

function worksFor(
  ids: number[],
  genres: string[],
  prefix = "w",
): Map<number, TestWork> {
  return new Map(
    ids.map((id) => [id, { id: `${prefix}${id}`, tags: tags(...genres) }]),
  );
}

function range(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => start + i);
}

Deno.test("a hidden genre gets no shelf and the next genre takes its place", () => {
  const seeds = [
    seed("f1", 9, ["Fantasy"], range(100, 5)),
    seed("f2", 9, ["Fantasy"], range(100, 5)),
    seed("h1", 5, ["Horror"], range(200, 5)),
    seed("h2", 5, ["Horror"], range(200, 5)),
  ];
  const works = new Map([
    ...worksFor(range(100, 5), ["Fantasy"]),
    ...worksFor(range(200, 5), ["Horror"]),
  ]);
  const input = {
    seeds,
    worksByHardcoverId: works,
    excludedWorkIds: new Set<string>(),
    shelfCount: 1,
  };
  assertEquals(buildGenreShelves(input).map((s) => s.genreKey), ["פנטזיה"]);
  assertEquals(
    buildGenreShelves({
      ...input,
      preferences: [{ genreKey: "פנטזיה", state: "hidden", pinOrder: null }],
    }).map((s) => s.genreKey),
    ["אימה"],
  );
});

Deno.test("a pinned genre needs no qualification and keeps 1 to 12 books", () => {
  const seeds = [
    seed("f1", 9, ["Fantasy", "Horror"], [100, 101, 102, 103]),
    seed("f2", 9, ["Fantasy"], [100, 101, 102, 103, 200, 201]),
    seed("f3", 9, ["Fantasy"], [200, 201]),
  ];
  const works = new Map([
    ...worksFor([100, 101, 102, 103], ["Fantasy"]),
    ...worksFor([200, 201], ["Horror"]),
  ]);
  const shelves = buildGenreShelves({
    seeds,
    worksByHardcoverId: works,
    excludedWorkIds: new Set(),
    shelfCount: 5,
    preferences: [{ genreKey: "אימה", state: "pinned", pinOrder: 0 }],
  });
  assertEquals(qualifyingGenres(seeds).some(({ genre }) => genre === "אימה"), false);
  assertEquals(shelves[0].genreKey, "אימה");
  assertEquals(shelves[0].pinned, true);
  assertEquals(shelves[0].books.map((b) => b.hardcoverId).toSorted(), [200, 201]);
  assertEquals(shelves[1].genreKey, "פנטזיה");
  assertEquals(shelves[1].pinned, false);
});

Deno.test("only the first N-1 pins by pinOrder show, plus one automatic shelf", () => {
  const genres = ["Fantasy", "Horror", "History", "War"];
  const seeds = genres.flatMap((g, i) => [
    seed(`${g}-a`, 5, [g], range(i * 100 + 1, 5)),
    seed(`${g}-b`, 5, [g], range(i * 100 + 1, 5)),
  ]);
  const works = new Map(
    genres.flatMap((g, i) => [...worksFor(range(i * 100 + 1, 5), [g], `${g}-`)]),
  );
  const shelves = buildGenreShelves({
    seeds,
    worksByHardcoverId: works,
    excludedWorkIds: new Set(),
    shelfCount: 3,
    preferences: [
      { genreKey: "מלחמה", state: "pinned", pinOrder: 2 },
      { genreKey: "אימה", state: "pinned", pinOrder: 0 },
      { genreKey: "היסטוריה", state: "pinned", pinOrder: 1 },
    ],
  });
  assertEquals(shelves.map((s) => [s.genreKey, s.pinned]), [
    ["אימה", true],
    ["היסטוריה", true],
    ["פנטזיה", false],
  ]);
});

Deno.test("N = 20 gives up to 20 shelves and a book sits on one shelf only", () => {
  const keys = Array.from({ length: 22 }, (_, i) => `genre-${i}`);
  const seeds = keys.flatMap((g, i) => [
    seed(`${g}-a`, 30 - i, [g], range(i * 10 + 1, 5)),
    seed(`${g}-b`, 30 - i, [g], range(i * 10 + 1, 5)),
  ]);
  const works = new Map(
    keys.flatMap((g, i) => [...worksFor(range(i * 10 + 1, 5), [g], `${g}-`)]),
  );
  // Book 1 also carries the second genre; it may only appear on one shelf.
  works.set(11, { id: "genre-0-1", tags: tags("genre-0", "genre-1") });
  const shelves = buildGenreShelves({
    seeds,
    worksByHardcoverId: works,
    excludedWorkIds: new Set(),
    shelfCount: 20,
  });
  const ids = shelves.flatMap((s) => s.books.map((b) => b.workId));
  assertEquals(new Set(ids).size, ids.length);
  assertEquals(shelves.length <= 20, true);
  assertEquals(shelves.length >= 19, true);
});

Deno.test("no preferences with N = 5 matches the default behavior", () => {
  const seeds = [
    seed("a", 5, ["Fantasy"], [4, 3, 2, 1]),
    seed("b", 4, ["Fantasy"], [1, 2, 3, 4]),
  ];
  const input = {
    seeds,
    worksByHardcoverId: worksFor([1, 2, 3, 4], ["Fantasy"]),
    excludedWorkIds: new Set<string>(),
  };
  assertEquals(
    buildGenreShelves({ ...input, shelfCount: 5, preferences: [] }),
    buildGenreShelves(input),
  );
  assertEquals(buildGenreShelves(input)[0].pinned, false);
});

Deno.test("reader genres count, filter, order and cap", () => {
  const seeds = [
    seed("a", 5, ["Fantasy", "Horror"], [100, 101, 102, 103]),
    seed("b", 4, ["Fantasy"], [100, 104]),
  ];
  const works = new Map<number, TestWork>([
    [100, { id: "w100", tags: tags("Fantasy", "Poetry") }],
    [101, { id: "w101", tags: tags("Poetry") }],
    [102, { id: "w102", tags: tags("Poetry") }],
    [103, { id: "w103", tags: tags("Poetry", "Satire") }],
    [104, { id: "w104", tags: tags("Satire") }],
  ]);
  const result = readerGenres({
    seeds,
    worksByHardcoverId: works,
    excludedWorkIds: new Set(["w102"]),
  });
  assertEquals(
    result.map(({ genreKey, seedCount, candidateCount }) => [
      genreKey,
      seedCount,
      candidateCount,
    ]),
    [
      ["פנטזיה", 2, 1],
      ["אימה", 1, 0],
      // Poetry: 4 candidates minus the excluded one = 3, no seeds, kept.
      ["שירה", 0, 3],
      // Satire: 2 candidates, no seeds, dropped.
    ],
  );

  const many = Array.from({ length: 120 }, (_, i) =>
    seed(`s${i}`, 1 + i / 1000, [`genre-${i}`]));
  assertEquals(
    readerGenres({
      seeds: many,
      worksByHardcoverId: new Map(),
      excludedWorkIds: new Set(),
    }).length,
    100,
  );
});

Deno.test("missing candidates include pinned genre candidates and cap at 200", () => {
  const seeds = [seed("a", 5, ["Fantasy"], range(1, 40)), seed("b", 5, [], [500])];
  assertEquals(missingCandidateIds(seeds, new Map()), []);
  assertEquals(
    missingCandidateIds(seeds, new Map(), 200, [], {
      preferences: [{ genreKey: "אימה", state: "pinned", pinOrder: 0 }],
    }).includes(500),
    true,
  );
  const big = Array.from({ length: 10 }, (_, i) =>
    seed(`big-${i}`, 5, ["Fantasy"], range(i * 40 + 1, 40)));
  assertEquals(missingCandidateIds(big, new Map()).length, 200);
});
