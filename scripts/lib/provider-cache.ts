// On-disk response cache for provider fetches (dev scripts only).
const HOSTS = new Set([
  "www.wikidata.org",
  "query.wikidata.org",
  "nli.alma.exlibrisgroup.com",
  "en.wiktionary.org",
  "simania.co.il",
  "www.simania.co.il",
]);
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CacheStats {
  hits: number;
  misses: number;
  stored: number;
}

/** File operations; injectable so tests need no write permission. */
export interface CacheFs {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, text: string): Promise<void>;
  mkdir(dir: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

const denoFs: CacheFs = {
  readTextFile: (path) => Deno.readTextFile(path),
  writeTextFile: (path, text) => Deno.writeTextFile(path, text),
  mkdir: (dir) => Deno.mkdir(dir, { recursive: true }),
  rename: (from, to) => Deno.rename(from, to),
};

export interface CacheOptions {
  fs?: CacheFs;
  dir: string;
  ttlMs?: number;
  now?: () => number;
  stats?: CacheStats;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Drops the per-call JSON-RPC `id` (a running counter) so equal requests share a key. */
function normalizeBody(body: string): string {
  try {
    const parsed = JSON.parse(body);
    if (
      parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
      "jsonrpc" in parsed && "id" in parsed
    ) {
      const { id: _id, ...rest } = parsed;
      return JSON.stringify(rest);
    }
  } catch {
    // not JSON: use as is
  }
  return body;
}

export function cachedFetch(
  fetchImpl: typeof fetch,
  options: CacheOptions,
): typeof fetch {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;
  const stats = options.stats;
  const fs = options.fs ?? denoFs;
  return async (input, init) => {
    const request = new Request(input as Request | string | URL, init);
    const url = new URL(request.url);
    if (!HOSTS.has(url.hostname)) return fetchImpl(input, init);
    const body = await request.clone().text();
    const key = await sha256(
      JSON.stringify([request.method, request.url, normalizeBody(body)]),
    );
    const path = `${options.dir}/${key}.json`;
    try {
      const entry = JSON.parse(await fs.readTextFile(path));
      if (now() - entry.savedAt <= ttlMs) {
        if (stats) stats.hits++;
        const nullBody = [101, 204, 205, 304].includes(entry.status);
        return new Response(nullBody ? null : entry.body, {
          status: entry.status,
          headers: entry.contentType
            ? { "content-type": entry.contentType }
            : {},
        });
      }
    } catch {
      // missing or unreadable entry: fetch
    }
    if (stats) stats.misses++;
    const response = await fetchImpl(input, init);
    const storable = (response.status >= 200 && response.status < 300) ||
      (response.status === 404 && url.hostname === "en.wiktionary.org");
    if (storable) {
      try {
        const text = await response.clone().text();
        await fs.mkdir(options.dir);
        const temp = `${path}.${crypto.randomUUID()}.tmp`;
        await fs.writeTextFile(
          temp,
          JSON.stringify({
            status: response.status,
            contentType: response.headers.get("content-type"),
            body: text,
            savedAt: now(),
          }),
        );
        await fs.rename(temp, path);
        if (stats) stats.stored++;
      } catch {
        // cache write failure must not break the run
      }
    }
    return response;
  };
}
