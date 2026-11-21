import type { Sql } from "npm:postgres@3.4.5";
import { nameKey, recordPair } from "../supabase/functions/_shared/authors.ts";
import { nameSoundScore } from "../supabase/functions/_shared/names.ts";
import { sqlAuthorStore } from "./lib/author-store.ts";
import { memoryAuthorStore } from "./lib/link-proposal.ts";
import { loadOperatorEnv, openProdDb } from "./lib/prod-db.ts";

const USAGE = "Usage: authors:seed [--apply]";
const MIN_SOUND = 0.8;

export interface RunDeps {
  loadOperatorEnv: typeof loadOperatorEnv;
  openProdDb: typeof openProdDb;
  loadPairs: (sql: Sql) => Promise<{ he: string; en: string }[]>;
  log: (message: string) => void;
  error: (message: string) => void;
}

const runDefaults: RunDeps = {
  loadOperatorEnv,
  openProdDb,
  loadPairs: async (sql) =>
    await sql<{ he: string; en: string }[]>`
      select e.author as he, w.original_authors[1] as en
      from public.editions as e
      inner join public.works as w on w.id = e.work_id
      where e.simania_id > 0 and e.author is not null
        and w.original_authors[1] is not null
      order by e.simania_id
    `,
  log: console.log,
  error: console.error,
};

/** Run the CLI and return its exit code. Exported for database-free tests. */
export async function main(
  args: string[] = Deno.args,
  overrides: Partial<RunDeps> = {},
): Promise<number> {
  const deps = { ...runDefaults, ...overrides };
  if (args.some((arg) => arg !== "--apply")) {
    deps.error(USAGE);
    return 2;
  }
  const apply = args.includes("--apply");

  deps.loadOperatorEnv();
  const sql = await deps.openProdDb({ readOnly: !apply });
  try {
    const pairs = await deps.loadPairs(sql);
    // A dry run counts with the in-memory logic; --apply writes the table.
    const store = apply ? sqlAuthorStore(sql) : memoryAuthorStore();
    let stored = 0;
    let rejected = 0;
    const enKeys = new Set<string>();
    // Deliberately sequential.
    for (const pair of pairs) {
      const he = String(pair.he ?? "");
      const en = String(pair.en ?? "");
      const accepted = nameKey(he) !== "" && nameKey(en) !== "" &&
        nameSoundScore(he, [en]) >= MIN_SOUND;
      if (!accepted) {
        rejected++;
        continue;
      }
      await recordPair(store, he, en);
      stored++;
      enKeys.add(nameKey(en));
    }
    deps.log(JSON.stringify({
      pairs: pairs.length,
      stored,
      rejected,
      authors: enKeys.size,
    }));
    return 0;
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  try {
    Deno.exit(await main());
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Authors seed failed.",
    );
    Deno.exit(1);
  }
}
