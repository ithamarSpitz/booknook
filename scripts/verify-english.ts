import {
  ensureEnglishEdition,
  searchEnglish,
} from "../supabase/functions/_shared/english.ts";
import type { EditionRow } from "../supabase/functions/_shared/types.ts";
import { FakeDb } from "../tests/functions/helpers/fake-db.ts";

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
    if (trimmed.slice(0, eq).trim() !== "HARDCOVER_API_KEY") continue;
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

async function withProviderRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return await operation();
  }
}

function check(name: string, ok: boolean, detail = ""): boolean {
  const suffix = detail ? ` (${detail})` : "";
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${suffix}`);
  return ok;
}

function sameRow(left: EditionRow, right: EditionRow): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

loadHardcoverApiKey();

const realFetch = globalThis.fetch;
let fetchCount = 0;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  fetchCount += 1;
  return realFetch(input, init);
}) as typeof fetch;

let failed = false;

try {
  const spinResults = await withProviderRetry(() =>
    searchEnglish("Spin Robert Charles Wilson")
  );
  const spin = spinResults.find((book) => book.hardcover_id === 383752);
  if (
    !check(
      "search Spin Robert Charles Wilson",
      Boolean(spin?.author?.includes("Wilson")),
      spin ? `author=${spin.author ?? "null"}` : "Hardcover 383752 missing",
    )
  ) failed = true;
} catch (error) {
  failed = true;
  check("search Spin Robert Charles Wilson", false, String(error));
}

try {
  const hailMaryResults = await withProviderRetry(() =>
    searchEnglish("Project Hail Mary")
  );
  const hailMary = hailMaryResults.find((book) =>
    book.title === "Project Hail Mary" && book.author?.includes("Andy Weir")
  );
  if (
    !check(
      "search Project Hail Mary",
      Boolean(hailMary),
      hailMary
        ? `Hardcover ${hailMary.hardcover_id}`
        : "matching title and author missing",
    )
  ) failed = true;
} catch (error) {
  failed = true;
  check("search Project Hail Mary", false, String(error));
}

const db = new FakeDb();
let firstEdition: EditionRow | null = null;
try {
  firstEdition = await withProviderRetry(() =>
    ensureEnglishEdition(db, 383752)
  );
  const work = db.tables.works?.find((row) => row.id === firstEdition?.work_id);
  const detailsOk = firstEdition.simania_id === -383752 &&
    firstEdition.resolve_status === "hardcover" &&
    work?.hardcover_id === 383752 &&
    firstEdition.title === "Spin" &&
    Boolean(firstEdition.author?.includes("Wilson")) &&
    Boolean(firstEdition.description) &&
    !/[<>]/.test(firstEdition.description ?? "") &&
    typeof firstEdition.simania_rating === "number" &&
    firstEdition.simania_rating >= 0 &&
    firstEdition.simania_rating <= 5 &&
    typeof firstEdition.simania_rating_count === "number" &&
    firstEdition.simania_rating_count > 0 &&
    Boolean(firstEdition.cover_url?.startsWith("https://")) &&
    firstEdition.year === 2005;
  if (
    !check(
      "ensure English edition 383752",
      detailsOk,
      detailsOk
        ? "complete clean details"
        : "stored details did not meet the contract",
    )
  ) failed = true;
} catch (error) {
  failed = true;
  check("ensure English edition 383752", false, String(error));
}

if (firstEdition) {
  const before = fetchCount;
  try {
    const cachedEdition = await ensureEnglishEdition(db, 383752);
    const cacheOk = fetchCount === before &&
      sameRow(firstEdition, cachedEdition);
    if (
      !check(
        "reuse cached English edition 383752",
        cacheOk,
        cacheOk
          ? "same row, no provider call"
          : `same_row=${sameRow(firstEdition, cachedEdition)} provider_calls=${
            fetchCount - before
          }`,
      )
    ) failed = true;
  } catch (error) {
    failed = true;
    check("reuse cached English edition 383752", false, String(error));
  }
} else {
  failed = true;
  check("reuse cached English edition 383752", false, "first ensure failed");
}

Deno.exit(failed ? 1 : 0);
