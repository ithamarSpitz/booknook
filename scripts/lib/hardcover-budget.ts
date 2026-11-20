const HARDCOVER_URL = "https://api.hardcover.app/v1/graphql";
const DAILY_REMAINING_HEADER = "x-ratelimit-daily-remaining";

type EnvReader = Pick<typeof Deno.env, "get">;

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

async function hardcoverApiKey(env: EnvReader): Promise<string | null> {
  const configured = env.get("HARDCOVER_API_KEY")?.trim();
  if (configured) return configured;

  const envFile = env.get("BOOKNOOK_ENV_FILE")?.trim();
  if (!envFile) return null;

  let text: string;
  try {
    text = await Deno.readTextFile(envFile);
  } catch {
    return null;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (
      equals < 1 ||
      trimmed.slice(0, equals).trim() !== "HARDCOVER_API_KEY"
    ) continue;

    return parseEnvValue(trimmed.slice(equals + 1)) || null;
  }

  return null;
}

export async function hardcoverDailyRemaining(
  fetchImpl: typeof fetch = fetch,
  env: EnvReader = Deno.env,
): Promise<number | null> {
  const key = await hardcoverApiKey(env);
  if (!key) return null;

  const authorization = key.startsWith("Bearer ") ? key : `Bearer ${key}`;

  try {
    const response = await fetchImpl(HARDCOVER_URL, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: "{ me { id } }" }),
    });
    const raw = response.headers.get(DAILY_REMAINING_HEADER);
    if (raw === null || !/^-?\d+$/.test(raw.trim())) return null;

    const remaining = Number(raw);
    return Number.isSafeInteger(remaining) ? remaining : null;
  } catch {
    return null;
  }
}

export async function checkHardcoverBudget({
  min,
  force,
  fetchImpl = fetch,
  env = Deno.env,
  log,
}: {
  min: number;
  force: boolean;
  fetchImpl?: typeof fetch;
  env?: EnvReader;
  log: (line: string) => void;
}): Promise<boolean> {
  const remaining = await hardcoverDailyRemaining(fetchImpl, env);
  log(JSON.stringify({ hardcover_daily_remaining: remaining }));

  if (remaining !== null && remaining < min && !force) {
    log(
      `Hardcover daily quota too low: ${remaining} < ${min} (use --force-hardcover)`,
    );
    return false;
  }

  return true;
}
