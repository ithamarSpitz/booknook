import type { CachedTags, WorkRow } from "./types.ts";

export type GenreMapEntry = {
  name: string;
  aliases: readonly string[];
};

/** Ordered Hebrew shelf names and the Hardcover Genre tags which map to them. */
export const GENRE_MAP: readonly GenreMapEntry[] = [
  {
    name: "מדע בדיוני",
    aliases: [
      "Science Fiction",
      "Sci-fi",
      "Space",
      "Aliens",
      "Cyberpunk",
      "Space Opera",
      "Hard Science Fiction",
    ],
  },
  {
    name: "פנטזיה",
    aliases: [
      "Fantasy",
      "Epic Fantasy",
      "High Fantasy",
      "Urban Fantasy",
      "Dark Fantasy",
    ],
  },
  {
    name: "דיסטופיה",
    aliases: ["Dystopian", "Dystopia", "Post-Apocalyptic", "Apocalyptic"],
  },
  {
    name: "מותחנים",
    aliases: [
      "Thriller",
      "Thrillers",
      "Thriller & Suspense",
      "Suspense",
      "Psychological Thriller",
    ],
  },
  {
    name: "מתח ובלש",
    aliases: ["Mystery", "Crime", "Murder", "Detective", "Mystery & Detective"],
  },
  {
    name: "רומנטיקה",
    aliases: ["Romance", "Contemporary Romance", "Historical Romance"],
  },
  {
    name: "ספרות יפה",
    aliases: ["Literary Fiction", "Literary", "Literature & Fiction"],
  },
  { name: "קלאסיקות", aliases: ["Classics"] },
  { name: "רומן היסטורי", aliases: ["Historical Fiction"] },
  { name: "אימה", aliases: ["Horror"] },
  { name: "הרפתקאות", aliases: ["Adventure"] },
  { name: "נוער", aliases: ["Young Adult", "Young Adult Fiction"] },
  { name: "ריאליזם מאגי", aliases: ["Magical Realism"] },
  { name: "מלחמה", aliases: ["War"] },
  { name: "היסטוריה", aliases: ["History"] },
  {
    name: "ביוגרפיה וממואר",
    aliases: [
      "Biography",
      "Biography & Autobiography",
      "Memoir",
      "Autobiography",
    ],
  },
  { name: "קומיקס", aliases: ["Comics", "Graphic Novels"] },
  { name: "הומור", aliases: ["Humor"] },
  { name: "עיון", aliases: ["Nonfiction", "Non-Fiction"] },
  { name: "פילוסופיה", aliases: ["Philosophy"] },
  { name: "פסיכולוגיה", aliases: ["Psychology"] },
  { name: "מדע", aliases: ["Science", "Popular Science"] },
] as const;

export type GenreSeed = {
  workId: string;
  simaniaId: number;
  weight: number;
  tags: CachedTags;
  similarIds: number[];
};

export type QualifyingGenre = {
  genre: string;
  evidence: number;
  count: number;
  seeds: GenreSeed[];
};

export type GenreCandidate = {
  hardcoverId: number;
  score: number;
  contributors: Array<{ simaniaId: number; contribution: number }>;
};

export type GenreWork = Pick<WorkRow, "id" | "tags">;

export type GenreShelf = {
  genre: string;
  books: Array<{
    workId: string;
    hardcoverId: number;
    score: number;
    because: number[];
  }>;
};

const ALIAS_TO_GENRE = new Map(
  GENRE_MAP.flatMap(({ name, aliases }) =>
    aliases.map((alias) =>
      [alias.trim().toLocaleLowerCase("en-US"), name] as const
    )
  ),
);

/** Map the first eight Genre tags to distinct Hebrew genre names, in tag order. */
export function workGenres(tags: CachedTags): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of (tags.Genre ?? []).slice(0, 8)) {
    const genre = ALIAS_TO_GENRE.get(
      entry.tag.trim().toLocaleLowerCase("en-US"),
    );
    if (genre !== undefined && !seen.has(genre)) {
      seen.add(genre);
      result.push(genre);
    }
  }
  return result;
}

/** Genres supported by at least two distinct seed works, strongest evidence first. */
export function qualifyingGenres(seeds: GenreSeed[]): QualifyingGenre[] {
  const byGenre = new Map<string, GenreSeed[]>();
  for (const seed of seeds) {
    for (const genre of workGenres(seed.tags)) {
      const genreSeeds = byGenre.get(genre) ?? [];
      genreSeeds.push(seed);
      byGenre.set(genre, genreSeeds);
    }
  }

  return [...byGenre.entries()]
    .filter(([, genreSeeds]) => genreSeeds.length >= 2)
    .map(([genre, genreSeeds]) => ({
      genre,
      evidence: genreSeeds.reduce((sum, seed) => sum + seed.weight, 0),
      count: genreSeeds.length,
      seeds: genreSeeds,
    }))
    .sort((left, right) =>
      right.evidence - left.evidence || right.count - left.count ||
      left.genre.localeCompare(right.genre, "he")
    );
}

/** Score the first 40 similar Hardcover IDs from the seeds for one genre. */
export function genreCandidates(
  _genre: string,
  genreSeeds: GenreSeed[],
): GenreCandidate[] {
  const scores = new Map<
    number,
    {
      score: number;
      contributors: Array<{ simaniaId: number; contribution: number }>;
    }
  >();
  for (const seed of genreSeeds) {
    for (const [rank, hardcoverId] of seed.similarIds.slice(0, 40).entries()) {
      if (!Number.isInteger(hardcoverId)) continue;
      const contribution = seed.weight * (1 - rank / 40);
      const current = scores.get(hardcoverId) ?? {
        score: 0,
        contributors: [],
      };
      current.score += contribution;
      current.contributors.push({ simaniaId: seed.simaniaId, contribution });
      scores.set(hardcoverId, current);
    }
  }
  return [...scores.entries()]
    .map(([hardcoverId, { score, contributors }]) => ({
      hardcoverId,
      score,
      contributors,
    }))
    .sort((left, right) =>
      right.score - left.score || left.hardcoverId - right.hardcoverId
    );
}

export function buildGenreShelves({
  seeds,
  worksByHardcoverId,
  excludedWorkIds,
}: {
  seeds: GenreSeed[];
  worksByHardcoverId: ReadonlyMap<number, GenreWork>;
  excludedWorkIds: ReadonlySet<string>;
}): GenreShelf[] {
  const shelves: GenreShelf[] = [];
  const placedWorkIds = new Set<string>();

  for (const { genre, seeds: genreSeeds } of qualifyingGenres(seeds)) {
    const books: GenreShelf["books"] = [];
    for (const candidate of genreCandidates(genre, genreSeeds)) {
      const work = worksByHardcoverId.get(candidate.hardcoverId);
      if (
        !work || excludedWorkIds.has(work.id) ||
        placedWorkIds.has(work.id) || !workGenres(work.tags).includes(genre)
      ) continue;
      books.push({
        workId: work.id,
        hardcoverId: candidate.hardcoverId,
        score: candidate.score,
        because: candidate.contributors
          .toSorted((left, right) =>
            right.contribution - left.contribution ||
            left.simaniaId - right.simaniaId
          )
          .map(({ simaniaId }) => simaniaId)
          .filter((simaniaId, index, values) =>
            values.indexOf(simaniaId) === index
          )
          .slice(0, 10),
      });
      if (books.length === 12) break;
    }
    if (books.length < 4) continue;
    shelves.push({ genre, books });
    for (const book of books) placedWorkIds.add(book.workId);
    if (shelves.length === 5) break;
  }
  return shelves;
}

/** Highest-scored qualifying-genre candidates which have not been loaded yet. */
export function missingCandidateIds(
  seeds: GenreSeed[],
  worksByHardcoverId: ReadonlyMap<number, GenreWork>,
  limit = 100,
): number[] {
  if (limit <= 0) return [];
  const bestScore = new Map<number, number>();
  for (const { genre, seeds: genreSeeds } of qualifyingGenres(seeds)) {
    for (const candidate of genreCandidates(genre, genreSeeds)) {
      if (worksByHardcoverId.has(candidate.hardcoverId)) continue;
      bestScore.set(
        candidate.hardcoverId,
        Math.max(
          bestScore.get(candidate.hardcoverId) ?? -Infinity,
          candidate.score,
        ),
      );
    }
  }
  return [...bestScore.entries()]
    .sort(([leftId, leftScore], [rightId, rightScore]) =>
      rightScore - leftScore || leftId - rightId
    )
    .slice(0, Math.floor(limit))
    .map(([hardcoverId]) => hardcoverId);
}
