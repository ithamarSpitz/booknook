// Read-only run health check: exits 1 when an output file cannot be trusted.
// Usage: deno run --allow-read scripts/check-run-health.ts <file>

export interface HealthResult {
  healthy: boolean;
  reason?: string;
  counts?: Record<string, number>;
}

const SIMANIA_403 = /Book catalog returned HTTP 403|\(403\)/;

function parseLines(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const v = JSON.parse(t);
      if (v && typeof v === "object") out.push(v);
    } catch {
      // ignore non-JSON lines
    }
  }
  return out;
}

function parseWhole(text: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

const num = (v: unknown) => typeof v === "number" ? v : 0;

export function checkRunHealth(text: string): HealthResult {
  const whole = parseWhole(text);
  const lines = whole ? [whole] : parseLines(text);
  const last = lines[lines.length - 1];
  if (!last) return { healthy: false, reason: "no JSON summary in output" };

  if (typeof last.sampled === "number") {
    const sampled = last.sampled;
    const failed = num(last.failed_in_sample);
    if (failed * 2 > sampled) {
      return {
        healthy: false,
        reason: `measure: ${failed}/${sampled} sampled works failed`,
      };
    }
    const counts: Record<string, number> = {
      sampled,
      failed_in_sample: failed,
    };
    const heb = last.hebrew as Record<string, unknown> | undefined;
    if (heb) {
      const unlinked = num(heb.unlinked_editions);
      const pf = num(heb.provider_failure);
      if (pf * 2 > unlinked) {
        return {
          healthy: false,
          reason: `measure: hebrew provider_failure ${pf}/${unlinked}`,
        };
      }
      counts.hebrew_unlinked_editions = unlinked;
      counts.hebrew_provider_failure = pf;
    }
    return { healthy: true, counts };
  }

  if (typeof last.works !== "number") {
    return { healthy: false, reason: "no works summary in last JSON line" };
  }
  const works = last.works;
  const skipped = (last.skipped ?? {}) as Record<string, unknown>;
  const pf = num(skipped.provider_failure);
  if (pf * 2 > works) {
    return {
      healthy: false,
      reason: `rematch: provider_failure ${pf}/${works} works`,
    };
  }
  for (const line of lines) {
    const failures = line.failures;
    if (!Array.isArray(failures)) continue;
    for (const f of failures) {
      const err = String((f as { error?: unknown })?.error ?? "");
      if (SIMANIA_403.test(err)) {
        return { healthy: false, reason: `Simania HTTP 403: ${err}` };
      }
    }
  }
  return { healthy: true, counts: { works, provider_failure: pf } };
}

if (import.meta.main) {
  const file = Deno.args[0];
  if (!file) {
    console.error("usage: check-run-health.ts <file>");
    Deno.exit(1);
  }
  let text: string;
  try {
    text = Deno.readTextFileSync(file);
  } catch (error) {
    console.error(
      `unhealthy: cannot read ${file}: ${(error as Error).message}`,
    );
    Deno.exit(1);
  }
  const result = checkRunHealth(text);
  if (!result.healthy) {
    console.error(`unhealthy: ${result.reason}`);
    Deno.exit(1);
  }
  console.log(JSON.stringify({ healthy: true, ...result.counts }));
}
