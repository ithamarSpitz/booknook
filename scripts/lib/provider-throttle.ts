type Sleep = (ms: number) => Promise<void>;
type Now = () => number;

const realSleep: Sleep = (ms) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function urlOf(input: RequestInfo | URL): string {
  return String(input instanceof Request ? input.url : input);
}

function isWikimedia(input: RequestInfo | URL): boolean {
  return /(?:wikidata|wiktionary|wikipedia)\.org/.test(urlOf(input));
}

function isHardcover(input: RequestInfo | URL): boolean {
  return /hardcover\.app/.test(urlOf(input));
}

const MAX_RETRY_AFTER_S = 60;
const QUEUE_TIMEOUT_MS = 5 * 60 * 1000;

/** Seconds to wait before retrying a 429; Infinity-like (> cap) means give up. */
function retryAfterSeconds(response: Response): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  return retryAfter > 0 ? retryAfter : 15;
}

const pending = new Map<string, number>();

/** Host groups that currently have requests in flight or queued. */
export function pendingHosts(): string[] {
  return [...pending.keys()];
}

function isSimania(input: RequestInfo | URL): boolean {
  return /simania\.co\.il/.test(urlOf(input));
}

function isNli(input: RequestInfo | URL): boolean {
  return /nli\.alma\.exlibrisgroup\.com|nli\.org\.il/.test(urlOf(input));
}

export interface HostGroup {
  matches: (input: RequestInfo | URL) => boolean;
  /** Minimum gap between request starts. */
  spacingMs: number;
  maxRetries: number;
}

export const HOST_GROUPS: Record<
  "wikimedia" | "hardcover" | "simania" | "nli",
  HostGroup
> = {
  wikimedia: { matches: isWikimedia, spacingMs: 300, maxRetries: 6 },
  hardcover: { matches: isHardcover, spacingMs: 1000, maxRetries: 5 },
  simania: { matches: isSimania, spacingMs: 250, maxRetries: 5 },
  nli: { matches: isNli, spacingMs: 250, maxRetries: 5 },
};

/**
 * One limiter for several host groups: each group has one request in flight
 * and a minimum gap between starts; other URLs pass through untouched.
 */
export function hostLimitedFetch(
  fetchImpl: typeof fetch,
  groups: HostGroup[],
  sleep: Sleep = realSleep,
  now: Now = Date.now,
): typeof fetch {
  const states = groups.map((group) => ({
    group,
    chain: Promise.resolve() as Promise<void>,
    lastStart: -Infinity,
  }));
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const state = states.find((s) => s.group.matches(input));
    if (!state) return fetchImpl(input, init);
    const { spacingMs, maxRetries } = state.group;
    const name = Object.entries(HOST_GROUPS).find(([, g]) =>
      g === state.group
    )?.[0] ?? "custom";
    pending.set(name, (pending.get(name) ?? 0) + 1);
    const settle = () => {
      const n = (pending.get(name) ?? 1) - 1;
      if (n <= 0) pending.delete(name);
      else pending.set(name, n);
    };
    const run = async (): Promise<Response> => {
      for (let attempt = 0;; attempt++) {
        const wait = Math.max(0, spacingMs - (now() - state.lastStart));
        if (wait > 0) await sleep(wait);
        state.lastStart = now();
        const response = await fetchImpl(input, init);
        if (response.status !== 429 || attempt >= maxRetries) return response;
        const seconds = retryAfterSeconds(response);
        if (seconds > MAX_RETRY_AFTER_S) return response;
        await response.body?.cancel();
        await sleep(seconds * 1000);
      }
    };
    const prev = state.chain;
    let release!: () => void;
    state.chain = new Promise<void>((resolve) => (release = resolve));
    const gate = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("host queue timeout"));
        release();
      }, QUEUE_TIMEOUT_MS);
      prev.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    return gate.then(run).finally(() => {
      release();
      settle();
    });
  }) as typeof fetch;
}

/** Serialize Hardcover requests, 1000 ms apart; retry HTTP 429 up to 5 times. */
export function throttledHardcoverFetch(
  fetchImpl: typeof fetch,
  sleep: Sleep = realSleep,
  now: Now = Date.now,
): typeof fetch {
  return hostLimitedFetch(fetchImpl, [HOST_GROUPS.hardcover], sleep, now);
}

/** Serialize Wikimedia requests, space starts by 300 ms, and retry HTTP 429. */
export function throttledWikimediaFetch(
  fetchImpl: typeof fetch,
  sleep: Sleep = realSleep,
  now: Now = Date.now,
): typeof fetch {
  return hostLimitedFetch(fetchImpl, [HOST_GROUPS.wikimedia], sleep, now);
}

/** All four host groups behind one limiter (used by the rematch CLI). */
export function throttledProviderFetch(
  fetchImpl: typeof fetch,
  sleep: Sleep = realSleep,
  now: Now = Date.now,
): typeof fetch {
  return hostLimitedFetch(fetchImpl, Object.values(HOST_GROUPS), sleep, now);
}
