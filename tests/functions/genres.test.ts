import { assertEquals } from "jsr:@std/assert@1";
import {
  buildGenreShelves,
  GENRE_MAP,
  genreCandidates,
  type GenreSeed,
  missingCandidateIds,
  qualifyingGenres,
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
): GenreSeed {
  return { workId, weight, tags: tags(...genres), similarIds };
}

Deno.test("genre map is complete and workGenres reads only eight tags", () => {
  assertEquals(GENRE_MAP.length, 22);
  assertEquals(
    workGenres(tags(
      " General ",
      "SCI-FI",
      " space ",
      "did-not-finish",
      "Fiction",
      "Audiobooks",
      "Unknown",
      "Classics",
      "Fantasy",
    )),
    ["מדע בדיוני", "קלאסיקות"],
  );
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
      { hardcoverId: 10, score: 5.9 },
      { hardcoverId: 20, score: 4 },
    ],
  );
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
