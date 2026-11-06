import postgres, { type Sql } from "npm:postgres@3.4.5";

const PROD_DB = {
  host: "aws-1-eu-central-1.pooler.supabase.com",
  port: 5432,
  user: "postgres.zheosjpootcwvuazwjzh",
  database: "postgres",
} as const;

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

export function readEnvFile(path: string): Record<string, string> {
  const values: Record<string, string> = {};
  const text = Deno.readTextFileSync(path);

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equals = trimmed.indexOf("=");
    if (equals < 1) continue;

    const key = trimmed.slice(0, equals).trim();
    if (!key) continue;
    values[key] = parseEnvValue(trimmed.slice(equals + 1));
  }

  return values;
}

export function loadOperatorEnv(): { dbPassword: string } {
  const envFile = Deno.env.get("BOOKNOOK_ENV_FILE")?.trim();
  if (!envFile) {
    throw new Error("BOOKNOOK_ENV_FILE is missing.");
  }

  let values: Record<string, string>;
  try {
    values = readEnvFile(envFile);
  } catch {
    throw new Error("BOOKNOOK_ENV_FILE could not be read.");
  }

  const dbPassword = values.TORIMITOR_DB_PASSWORD?.trim();
  if (!dbPassword) {
    throw new Error("TORIMITOR_DB_PASSWORD is missing from BOOKNOOK_ENV_FILE.");
  }

  if (!Deno.env.get("HARDCOVER_API_KEY")?.trim()) {
    const hardcoverApiKey = values.HARDCOVER_API_KEY?.trim();
    if (!hardcoverApiKey) {
      throw new Error("HARDCOVER_API_KEY is missing from BOOKNOOK_ENV_FILE.");
    }
    Deno.env.set("HARDCOVER_API_KEY", hardcoverApiKey);
  }

  return { dbPassword };
}

export async function openProdDb(
  { readOnly = true }: { readOnly?: boolean } = {},
): Promise<Sql> {
  const { dbPassword } = loadOperatorEnv();
  const sql = postgres({
    ...PROD_DB,
    password: dbPassword,
    ssl: "require",
    max: 1,
  });

  if (readOnly) {
    try {
      await sql`set default_transaction_read_only = on`;
    } catch (error) {
      await sql.end();
      throw error;
    }
  }

  return sql;
}

export function shelvedUnlinkedEditions(sql: Sql) {
  return sql`
    select distinct
      e.simania_id,
      e.title,
      e.author,
      e.translator
    from public.editions as e
    inner join public.shelf_books as sb on sb.simania_id = e.simania_id
    where e.simania_id > 0
      and e.work_id is null
    order by e.simania_id
  `;
}

export function linkedEditionsWithWorks(sql: Sql) {
  return sql`
    select
      e.simania_id,
      w.id as work_id,
      e.title,
      e.author,
      w.hardcover_id,
      w.original_title,
      w.original_authors
    from public.editions as e
    inner join public.works as w on w.id = e.work_id
    where e.simania_id > 0
      and e.work_id is not null
    order by e.simania_id
  `;
}

export function englishOnlyRecommendations(sql: Sql) {
  return sql`
    select
      p.display_name,
      r.work_id,
      w.hardcover_id,
      w.original_title,
      w.original_authors
    from public.recommendations as r
    inner join public.works as w on w.id = r.work_id
    inner join public.profiles as p on p.id = r.user_id
    where r.dismissed = false
      and r.simania_id is null
  `;
}
