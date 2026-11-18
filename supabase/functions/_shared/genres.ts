import type { CachedTags, WorkRow } from "./types.ts";

export type GenreMapEntry = {
  name: string;
  aliases: readonly string[];
};

/** Hebrew genre keys/display names and their normalized Hardcover aliases. */
export const GENRE_MAP: readonly GenreMapEntry[] = [
  {
    name: "מדע בדיוני",
    aliases: [
      "science fiction",
      "sci fi",
      "space",
      "aliens",
      "cyberpunk",
      "space opera",
      "hard science fiction",
    ],
  },
  {
    name: "פנטזיה",
    aliases: [
      "fantasy",
      "epic fantasy",
      "high fantasy",
      "urban fantasy",
      "dark fantasy",
    ],
  },
  {
    name: "דיסטופיה",
    aliases: ["dystopian", "dystopia", "post apocalyptic", "apocalyptic"],
  },
  {
    name: "מותחנים",
    aliases: [
      "thriller",
      "thrillers",
      "thriller & suspense",
      "suspense",
      "psychological thriller",
      "domestic thriller",
      "legal thriller",
      "espionage",
      "spy",
    ],
  },
  {
    name: "מתח ובלש",
    aliases: [
      "mystery",
      "crime",
      "murder",
      "detective",
      "mystery & detective",
      "mystery thriller",
      "mystery/thriller",
      "detective and mystery stories",
      "police",
      "police procedural",
      "cozy mystery",
      "crime fiction",
      "noir",
    ],
  },
  {
    name: "רומנטיקה",
    aliases: ["romance", "contemporary romance", "historical romance"],
  },
  {
    name: "ספרות יפה",
    aliases: [
      "literary fiction",
      "literary",
      "literature & fiction",
      "literature",
    ],
  },
  { name: "קלאסיקות", aliases: ["classics"] },
  { name: "רומן היסטורי", aliases: ["historical fiction", "historical"] },
  { name: "אימה", aliases: ["horror"] },
  { name: "הרפתקאות", aliases: ["adventure", "action & adventure", "action"] },
  {
    name: "נוער",
    aliases: [
      "young adult",
      "young adult fiction",
      "teen & young adult",
      "teen",
      "ya",
    ],
  },
  { name: "ריאליזם מאגי", aliases: ["magical realism"] },
  { name: "מלחמה", aliases: ["war", "military fiction"] },
  { name: "היסטוריה", aliases: ["history"] },
  {
    name: "ביוגרפיה וממואר",
    aliases: [
      "biography",
      "biography & autobiography",
      "memoir",
      "autobiography",
    ],
  },
  {
    name: "קומיקס",
    aliases: ["comics", "graphic novels", "comics & graphic novels"],
  },
  { name: "הומור", aliases: ["humor", "humour", "comedy"] },
  { name: "עיון", aliases: ["nonfiction", "non fiction"] },
  { name: "פילוסופיה", aliases: ["philosophy"] },
  { name: "פסיכולוגיה", aliases: ["psychology"] },
  { name: "מדע", aliases: ["science", "popular science"] },
  {
    name: "ילדים",
    aliases: [
      "children",
      "childrens",
      "juvenile fiction",
      "juvenile nonfiction",
      "middle grade",
      "children's stories",
      "children's literature",
      "picture books",
    ],
  },
  { name: "שירה", aliases: ["poetry"] },
  {
    name: "סיפורים קצרים",
    aliases: ["short stories", "short story collections", "anthologies"],
  },
  { name: "פוליטיקה", aliases: ["politics", "political science"] },
  { name: "מסעות", aliases: ["travel"] },
  {
    name: "דת ורוחניות",
    aliases: ["religion", "spirituality", "christianity", "judaism"],
  },
  { name: "התבגרות", aliases: ["coming of age"] },
  {
    name: "על-טבעי",
    aliases: ["paranormal", "supernatural", "ghosts", "vampires"],
  },
  { name: "מסע בזמן", aliases: ["time travel"] },
  { name: "קומדיה רומנטית", aliases: ["romantic comedy", "rom com"] },
  { name: "סאטירה", aliases: ["satire"] },
  { name: 'להט"ב', aliases: ["lgbtq", "lgbt", "queer", "lgbtqia+", "lgbtq+"] },
  {
    name: "ספרות עכשווית",
    aliases: ["contemporary", "contemporary fiction", "realistic fiction"],
  },
  { name: "ספרות נשים", aliases: ["women's fiction", "women"] },
  {
    name: "משפחה",
    aliases: ["family", "family life", "family & relationships"],
  },
  { name: "חברות", aliases: ["friendship"] },
  { name: "ספרות פסיכולוגית", aliases: ["psychological"] },
  { name: "דרמה", aliases: ["drama"] },
  { name: "ספרות ספקולטיבית", aliases: ["speculative fiction"] },
  { name: "פשע אמיתי", aliases: ["true crime"] },
  { name: "מיתולוגיה", aliases: ["mythology"] },
  { name: "אגדות", aliases: ["fairy tales"] },
  { name: "מסות", aliases: ["essays"] },
  { name: "ביקורת ספרות", aliases: ["literary criticism"] },
  { name: "עסקים וכלכלה", aliases: ["business", "economics"] },
  { name: "עזרה עצמית", aliases: ["self help"] },
  { name: "פמיניזם", aliases: ["feminism"] },
  { name: "מערבונים", aliases: ["western", "westerns"] },
  { name: "סטימפאנק", aliases: ["steampunk"] },
  { name: "LitRPG", aliases: ["litrpg", "gamelit"] },
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

export type GenreNegativeSeed = {
  similarIds: number[];
};

export type GenreWork = Pick<WorkRow, "id" | "tags">;

export type GenreShelf = {
  genreKey: string;
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
    aliases.map((alias) => [alias, name] as const)
  ),
);

const NOISE_GENRES = new Set([
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
]);

const NOISE_FRAGMENTS = ["tbr", "to read", "favorite", "favourite", "read in"];

function cleanedGenreTag(tag: string): string {
  return tag.replace(/["\[\]\\]/g, "").trim();
}

/** Normalize a Hardcover genre tag according to the genre contract. */
export function normalizeGenreTag(tag: string): string {
  return cleanedGenreTag(tag)
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function isNoiseGenre(normalized: string): boolean {
  return NOISE_GENRES.has(normalized) || /^\d+$/.test(normalized) ||
    NOISE_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function genresForTag(tag: string): string[] {
  const normalized = normalizeGenreTag(tag);
  if (!normalized || isNoiseGenre(normalized)) return [];
  const alias = ALIAS_TO_GENRE.get(normalized);
  if (alias !== undefined) return [alias];

  if (normalized.includes(" & ") || normalized.includes("/")) {
    const compound = normalized.split(/ & |\//).map((part) => part.trim());
    const genres = compound.map((part) => ALIAS_TO_GENRE.get(part));
    if (genres.every((genre) => genre !== undefined)) {
      return genres as string[];
    }
  }
  return [`en:${normalized}`];
}

/** Map the first twelve Genre tags to distinct genre keys, in tag order. */
export function workGenres(tags: CachedTags): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of (tags.Genre ?? []).slice(0, 12)) {
    for (const genre of genresForTag(entry.tag)) {
      if (!seen.has(genre)) {
        seen.add(genre);
        result.push(genre);
      }
    }
  }
  return result;
}

/** Choose the contracted display name for a genre key without external state. */
export function genreDisplayName(
  genreKey: string,
  seeds: readonly GenreSeed[],
  worksByHardcoverId: ReadonlyMap<number, GenreWork>,
): string {
  if (!genreKey.startsWith("en:")) return genreKey;
  const displayFromTags = (tags: CachedTags): string | undefined =>
    (tags.Genre ?? []).slice(0, 12).find((entry) =>
      genresForTag(entry.tag).includes(genreKey)
    )?.tag;
  for (const seed of seeds) {
    const tag = displayFromTags(seed.tags);
    if (tag !== undefined) return cleanedGenreTag(tag);
  }
  for (
    const [, work] of [...worksByHardcoverId.entries()].sort((a, b) =>
      a[0] - b[0]
    )
  ) {
    const tag = displayFromTags(work.tags);
    if (tag !== undefined) return cleanedGenreTag(tag);
  }
  return genreKey.slice(3);
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
      genreDisplayName(left.genre, seeds, new Map()).localeCompare(
        genreDisplayName(right.genre, seeds, new Map()),
        "he",
      )
    );
}

/** Score the first 40 similar Hardcover IDs from the seeds for one genre. */
export function genreCandidates(
  _genre: string,
  genreSeeds: GenreSeed[],
  negativeSeeds: readonly GenreNegativeSeed[] = [],
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
  for (const seed of negativeSeeds) {
    for (const [rank, hardcoverId] of seed.similarIds.slice(0, 40).entries()) {
      if (!Number.isInteger(hardcoverId)) continue;
      const current = scores.get(hardcoverId);
      if (!current) continue;
      current.score -= 5 * (1 - rank / 40);
    }
  }
  return [...scores.entries()]
    .filter(([, value]) => value.score > 0)
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
  negativeSeeds = [],
  worksByHardcoverId,
  excludedWorkIds,
}: {
  seeds: GenreSeed[];
  negativeSeeds?: readonly GenreNegativeSeed[];
  worksByHardcoverId: ReadonlyMap<number, GenreWork>;
  excludedWorkIds: ReadonlySet<string>;
}): GenreShelf[] {
  const shelves: GenreShelf[] = [];
  const placedWorkIds = new Set<string>();

  for (const { genre, seeds: genreSeeds } of qualifyingGenres(seeds)) {
    const books: GenreShelf["books"] = [];
    for (const candidate of genreCandidates(genre, genreSeeds, negativeSeeds)) {
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
    shelves.push({
      genreKey: genre,
      genre: genreDisplayName(genre, seeds, worksByHardcoverId),
      books,
    });
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
  negativeSeeds: readonly GenreNegativeSeed[] = [],
): number[] {
  if (limit <= 0) return [];
  const bestScore = new Map<number, number>();
  for (const { genre, seeds: genreSeeds } of qualifyingGenres(seeds)) {
    for (const candidate of genreCandidates(genre, genreSeeds, negativeSeeds)) {
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
