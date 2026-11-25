// Preload: log every fetch (host, path head, ms, status/error) to stderr as JSON. No bodies, no headers.
const real = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = new URL(String(input?.url ?? input));
  const t0 = performance.now();
  try {
    const r = await real(input, init);
    console.error(JSON.stringify({ f: url.host, p: url.pathname.slice(0, 30), ms: Math.round(performance.now() - t0), s: r.status, t: Date.now() }));
    return r;
  } catch (e) {
    console.error(JSON.stringify({ f: url.host, p: url.pathname.slice(0, 30), ms: Math.round(performance.now() - t0), e: String((e as Error)?.message ?? e).slice(0, 60), t: Date.now() }));
    throw e;
  }
}) as typeof fetch;
