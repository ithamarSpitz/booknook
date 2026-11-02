import { wikidataHebrewAuthor } from "../supabase/functions/_shared/bridges.ts";
import {
  authors,
  hardcoverBooks,
} from "../supabase/functions/_shared/hardcover.ts";
import type { AuthorCandidate } from "../supabase/functions/_shared/types.ts";
import {
  defaultHebrewHint,
  hebrewAuthorFor,
} from "../supabase/functions/recommendations/index.ts";
import { matchCandidates } from "../supabase/functions/match-by-author/index.ts";
import { ensureResolved } from "../supabase/functions/_shared/catalog.ts";
import {
  matchHebrewBook,
  searchByAuthor,
  simaniaIdOf,
} from "../public/js/simania.js";
import { edition, FakeDb } from "../tests/functions/helpers/fake-db.ts";

type LocCase = {
  hardcoverId: number;
  label: string;
  buildDb: () => Record<string, Record<string, unknown>[]>;
  expectedSimania: number | null;
};

function parseEnvValue(raw: string): string {
  const value = raw.trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function loadHardcoverApiKey(): void {
  if (Deno.env.get("HARDCOVER_API_KEY")?.trim()) return;

  const envFile = Deno.env.get("BOOKNOOK_ENV_FILE")?.trim();
  if (!envFile) {
    console.error(
      "HARDCOVER_API_KEY is missing. Set it in the environment or BOOKNOOK_ENV_FILE to a file that contains it.",
    );
    Deno.exit(1);
  }

  let text: string;
  try {
    text = Deno.readTextFileSync(envFile);
  } catch {
    console.error(
      "HARDCOVER_API_KEY is missing. Set it in the environment or BOOKNOOK_ENV_FILE to a file that contains it.",
    );
    Deno.exit(1);
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const name = trimmed.slice(0, eq).trim();
    if (name !== "HARDCOVER_API_KEY") continue;
    const value = parseEnvValue(trimmed.slice(eq + 1));
    if (!value) break;
    Deno.env.set("HARDCOVER_API_KEY", value);
    return;
  }

  console.error(
    "HARDCOVER_API_KEY is missing. Set it in the environment or BOOKNOOK_ENV_FILE to a file that contains it.",
  );
  Deno.exit(1);
}

function mcfaddenSeed(): Record<string, Record<string, unknown>[]> {
  return {
    works: [{
      id: "seed-work-mcfadden",
      hardcover_id: 0,
      original_title: "The Housemaid",
      original_authors: ["Freida McFadden"],
      similar_ids: [],
      tags: {},
      hardcover_cover_url: null,
      refreshed_at: null,
    }],
    editions: [
      edition({
        simania_id: 1024000,
        title: "עוזרת הבית",
        author: "פרידה מקפדן",
        work_id: "seed-work-mcfadden",
        resolve_status: "nli",
        resolved_at: "2026-10-01T10:00:00.000Z",
      }),
    ],
  };
}

const CASES: LocCase[] = [
  {
    hardcoverId: 383752,
    label: "Spin",
    buildDb: () => ({}),
    expectedSimania: 97171,
  },
  {
    hardcoverId: 261931,
    label: "A Man Called Ove",
    buildDb: () => ({}),
    expectedSimania: 971989,
  },
  {
    hardcoverId: 475182,
    label: "A Flicker in the Dark",
    buildDb: () => ({}),
    expectedSimania: 1004934,
  },
  {
    hardcoverId: 585562,
    label: "The Housemaid's Secret",
    buildDb: mcfaddenSeed,
    expectedSimania: 1024882,
  },
  {
    hardcoverId: 381100,
    label: "The Dead Zone",
    buildDb: () => ({}),
    expectedSimania: null,
  },
  {
    hardcoverId: 572355,
    label: "Never Lie",
    buildDb: mcfaddenSeed,
    expectedSimania: null,
  },
];

const authorDeps = { wikidataHebrewAuthor };
const matchDeps = {
  ensureResolved,
  now: () => new Date(),
};

function hasPendingEdition(db: FakeDb): boolean {
  return (db.tables.editions ?? []).some((row) =>
    row.resolve_status === "pending"
  );
}

async function localizeChain(
  db: FakeDb,
  hardcoverId: number,
  book: Awaited<ReturnType<typeof hardcoverBooks>>[number],
): Promise<{ simaniaId: number | null; path: "title" | "author" | null }> {
  let simaniaId: number | null = null;
  let path: "title" | "author" | null = null;

  const hint = await defaultHebrewHint(book);
  if (hint?.title) {
    path = "title";
    const matched = await matchHebrewBook(hint.title, hint.author ?? "");
    simaniaId = simaniaIdOf(matched);
  }

  if (simaniaId == null) {
    const englishAuthor = authors(book)[0] ?? "";
    const hebrewAuthor = await hebrewAuthorFor(
      db as never,
      englishAuthor,
      authorDeps,
      new Map(),
    );
    if (hebrewAuthor) {
      path = "author";
      const candidates = await searchByAuthor(hebrewAuthor) as AuthorCandidate[];
      if (candidates.length) {
        const matched = await matchCandidates(
          db,
          hardcoverId,
          candidates,
          matchDeps,
        );
        if (matched.simania_id != null) {
          simaniaId = matched.simania_id;
        }
      }
    }
  }

  return { simaniaId, path };
}

function formatLine(
  pass: boolean,
  label: string,
  path: "title" | "author" | null,
  simaniaId: number | null,
  expected: number | null,
  suffix = "",
): string {
  const flag = pass ? "PASS" : "FAIL";
  const pathLabel = path ?? "—";
  const got = simaniaId ?? "none";
  const want = expected ?? "none";
  const extra = suffix ? ` (${suffix})` : "";
  return `${flag} ${label} ${pathLabel} ${got} expected ${want}${extra}`;
}

async function runCase(spec: LocCase): Promise<string> {
  let lastLine = formatLine(
    false,
    spec.label,
    null,
    null,
    spec.expectedSimania,
    "provider failure",
  );

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    const db = new FakeDb(spec.buildDb());
    try {
      const books = await hardcoverBooks([spec.hardcoverId]);
      const book = books[0];
      if (!book) {
        lastLine = formatLine(
          false,
          spec.label,
          null,
          null,
          spec.expectedSimania,
          "provider failure",
        );
        continue;
      }

      const { simaniaId, path } = await localizeChain(
        db,
        spec.hardcoverId,
        book,
      );
      if (hasPendingEdition(db) && simaniaId == null) {
        lastLine = formatLine(
          false,
          spec.label,
          path,
          simaniaId,
          spec.expectedSimania,
          "provider failure",
        );
        continue;
      }

      const ok = simaniaId === spec.expectedSimania;
      return formatLine(ok, spec.label, path, simaniaId, spec.expectedSimania);
    } catch {
      lastLine = formatLine(
        false,
        spec.label,
        null,
        null,
        spec.expectedSimania,
        "provider failure",
      );
    }
  }

  return lastLine;
}

loadHardcoverApiKey();

let failed = false;
for (const spec of CASES) {
  const line = await runCase(spec);
  console.log(line);
  if (line.startsWith("FAIL")) failed = true;
}

Deno.exit(failed ? 1 : 0);
