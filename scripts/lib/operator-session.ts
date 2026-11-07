const PROJECT_REF = "zheosjpootcwvuazwjzh";
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`;

export interface ProjectKeys {
  url: string;
  anonKey: string;
  serviceKey: string;
}

export interface Reader {
  id: string;
  email: string;
}

export interface CommandResult {
  success: boolean;
  stdout: Uint8Array | string;
}

export type CommandRunner = (
  command: string,
  args: string[],
) => Promise<CommandResult>;

export class OperatorRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "OperatorRequestError";
  }
}

const decoder = new TextDecoder();

async function defaultRun(
  command: string,
  args: string[],
): Promise<CommandResult> {
  return await new Deno.Command(command, {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
}

function commandSpec(): { command: string; args: string[] } {
  const args = [
    "supabase",
    "projects",
    "api-keys",
    "--project-ref",
    PROJECT_REF,
    "-o",
    "json",
  ];

  if (Deno.build.os === "windows") {
    return {
      command: "cmd",
      args: ["/d", "/s", "/c", ["npx", ...args].join(" ")],
    };
  }

  return { command: "npx", args };
}

function outputText(stdout: Uint8Array | string): string {
  return typeof stdout === "string" ? stdout : decoder.decode(stdout);
}

export async function projectKeys(
  run: CommandRunner = defaultRun,
): Promise<ProjectKeys> {
  const { command, args } = commandSpec();
  let result: CommandResult;
  try {
    result = await run(command, args);
  } catch {
    throw new Error("Supabase project keys command failed.");
  }

  if (!result.success) {
    throw new Error("Supabase project keys command failed.");
  }

  let rows: unknown;
  try {
    rows = JSON.parse(outputText(result.stdout));
  } catch {
    throw new Error("Supabase project keys response could not be parsed.");
  }

  if (!Array.isArray(rows)) {
    throw new Error("Supabase project keys response has an invalid shape.");
  }

  const key = (name: string): string | undefined => {
    const row = rows.find((candidate) =>
      typeof candidate === "object" && candidate !== null &&
      (candidate as Record<string, unknown>).name === name
    ) as Record<string, unknown> | undefined;
    const value = row?.api_key;
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };

  const anonKey = key("anon");
  if (!anonKey) {
    throw new Error("Supabase project keys response is missing the anon key.");
  }

  const serviceKey = key("service_role");
  if (!serviceKey) {
    throw new Error(
      "Supabase project keys response is missing the service-role key.",
    );
  }

  return { url: PROJECT_URL, anonKey, serviceKey };
}

function keyHeaders(key: string): HeadersInit {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

async function requestJson(
  step: string,
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  return (await requestJsonResponse(step, url, init, fetchImpl)).payload;
}

async function requestJsonResponse(
  step: string,
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<{ payload: unknown; response: Response }> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch {
    throw new Error(`${step} request failed.`);
  }

  if (!response.ok) {
    throw new OperatorRequestError(
      `${step} request failed with status ${response.status}.`,
      response.status,
    );
  }

  try {
    return { payload: await response.json(), response };
  } catch {
    throw new Error(`${step} response could not be parsed.`);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function nextPage(linkHeader: string | null): number | null {
  for (const entry of linkHeader?.split(",") ?? []) {
    const relation = entry.match(/(?:^|;)\s*rel="?([^";]+)"?/i)?.[1];
    if (!relation?.split(/\s+/).includes("next")) continue;

    const target = entry.match(/<([^>]+)>/)?.[1];
    if (!target) return null;

    try {
      const page = Number(new URL(target).searchParams.get("page"));
      return Number.isSafeInteger(page) && page > 0 ? page : null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function listReaders(
  keys: ProjectKeys,
  fetchImpl: typeof fetch = fetch,
): Promise<Reader[]> {
  const pageSize = 1000;
  const readers: Reader[] = [];
  let page = 1;

  while (true) {
    const { payload: rawPayload, response } = await requestJsonResponse(
      "List readers",
      `${keys.url}/auth/v1/admin/users?page=${page}&per_page=${pageSize}`,
      { method: "GET", headers: keyHeaders(keys.serviceKey) },
      fetchImpl,
    );
    const payload = record(rawPayload);
    const users = payload?.users;
    if (!Array.isArray(users)) {
      throw new Error("List readers response has an invalid shape.");
    }

    for (const user of users) {
      const value = record(user);
      if (typeof value?.id !== "string" || typeof value.email !== "string") {
        throw new Error("List readers response has an invalid user.");
      }
      readers.push({ id: value.id, email: value.email });
    }

    const linkedPage = nextPage(response.headers.get("link"));
    const total = Number(response.headers.get("x-total-count"));
    const hasMoreByTotal = Number.isSafeInteger(total) &&
      total > readers.length;
    const followingPage = linkedPage ??
      (hasMoreByTotal || users.length === pageSize ? page + 1 : null);
    if (followingPage === null) break;
    if (followingPage <= page) {
      throw new Error("List readers response has invalid pagination.");
    }
    page = followingPage;
  }

  return readers.sort((a, b) =>
    a.email < b.email ? -1 : a.email > b.email ? 1 : 0
  );
}

export async function readerToken(
  keys: ProjectKeys,
  email: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const generated = record(
    await requestJson(
      "Generate reader magic link",
      `${keys.url}/auth/v1/admin/generate_link`,
      {
        method: "POST",
        headers: {
          ...keyHeaders(keys.serviceKey),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: "magiclink", email }),
      },
      fetchImpl,
    ),
  );
  const properties = record(generated?.properties);
  const hashedToken = generated?.hashed_token ?? properties?.hashed_token;
  if (typeof hashedToken !== "string" || hashedToken.length === 0) {
    throw new Error(
      "Generate reader magic link response is missing its token.",
    );
  }

  const verified = record(
    await requestJson(
      "Verify reader magic link",
      `${keys.url}/auth/v1/verify`,
      {
        method: "POST",
        headers: {
          ...keyHeaders(keys.anonKey),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: "magiclink", token_hash: hashedToken }),
      },
      fetchImpl,
    ),
  );
  const accessToken = verified?.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error(
      "Verify reader magic link response is missing its session.",
    );
  }

  return accessToken;
}

export async function callAs(
  keys: ProjectKeys,
  token: string,
  name: string,
  body: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  return await requestJson(
    `Call Edge Function ${name}`,
    `${keys.url}/functions/v1/${name}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: keys.anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    fetchImpl,
  );
}
