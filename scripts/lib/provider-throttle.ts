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

async function retryAfterWait(response: Response, sleep: Sleep) {
  const retryAfter = Number(response.headers.get("retry-after"));
  await response.body?.cancel();
  await sleep((retryAfter > 0 ? retryAfter : 15) * 1000);
}

function serialized(
  fetchImpl: typeof fetch,
  matches: (input: RequestInfo | URL) => boolean,
  spacingMs: number,
  maxRetries: number,
  sleep: Sleep,
  now: Now,
): typeof fetch {
  let chain: Promise<unknown> = Promise.resolve();
  let lastStart = -Infinity;
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    if (!matches(input)) return fetchImpl(input, init);
    const run = async (): Promise<Response> => {
      for (let attempt = 0;; attempt++) {
        const wait = Math.max(0, spacingMs - (now() - lastStart));
        if (wait > 0) await sleep(wait);
        lastStart = now();
        const response = await fetchImpl(input, init);
        if (response.status !== 429 || attempt >= maxRetries) return response;
        await retryAfterWait(response, sleep);
      }
    };
    const result = chain.then(run, run);
    chain = result.catch(() => undefined);
    return result;
  }) as typeof fetch;
}

/** Serialize Hardcover requests, 1000 ms apart; retry HTTP 429 up to 5 times. */
export function throttledHardcoverFetch(
  fetchImpl: typeof fetch,
  sleep: Sleep = realSleep,
  now: Now = Date.now,
): typeof fetch {
  return serialized(fetchImpl, isHardcover, 1000, 5, sleep, now);
}

/** Serialize Wikimedia requests, space starts by 300 ms, and retry HTTP 429. */
export function throttledWikimediaFetch(
  fetchImpl: typeof fetch,
  sleep: Sleep = realSleep,
  now: Now = Date.now,
): typeof fetch {
  return serialized(fetchImpl, isWikimedia, 300, 6, sleep, now);
}
