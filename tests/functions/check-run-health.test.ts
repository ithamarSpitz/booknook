import { assertEquals } from "jsr:@std/assert@1.0.14";
import { checkRunHealth } from "../../scripts/check-run-health.ts";

const j = (...o: unknown[]) =>
  o.map((x) => JSON.stringify(x)).join("\n") + "\n";

Deno.test("healthy English file", () => {
  const r = checkRunHealth(j(
    { simania_id: 1, skipped: "no_match" },
    {
      works: 100,
      proposals: 3,
      linked: 0,
      skipped: { provider_failure: 10, no_match: 80 },
    },
  ));
  assertEquals(r.healthy, true);
});

Deno.test("missing summary", () => {
  const r = checkRunHealth(j({ simania_id: 1, skipped: "no_match" }));
  assertEquals(r.healthy, false);
  assertEquals(checkRunHealth("").healthy, false);
});

Deno.test("442/442 provider failures", () => {
  const r = checkRunHealth(
    j({ works: 442, skipped: { provider_failure: 442 } }),
  );
  assertEquals(r.healthy, false);
});

Deno.test("one Simania 403", () => {
  const r = checkRunHealth(j(
    {
      skipped: "provider_failure",
      failures: [{
        provider: "simania",
        error: "Book catalog returned HTTP 403",
      }],
    },
    { works: 100, skipped: { provider_failure: 1 } },
  ));
  assertEquals(r.healthy, false);
});

Deno.test("measure with 204/400 failed", () => {
  const r = checkRunHealth(j({ sampled: 400, failed_in_sample: 204 }));
  assertEquals(r.healthy, false);
});

Deno.test("healthy measure", () => {
  const r = checkRunHealth(JSON.stringify({
    sampled: 400,
    failed_in_sample: 10,
    hebrew: { unlinked_editions: 100, provider_failure: 5 },
  }));
  assertEquals(r.healthy, true);
});

Deno.test("measure with hebrew provider failures", () => {
  const r = checkRunHealth(j({
    sampled: 400,
    failed_in_sample: 0,
    hebrew: { unlinked_editions: 100, provider_failure: 60 },
  }));
  assertEquals(r.healthy, false);
});

Deno.test("Hebrew file with 2/136 failures", () => {
  const r = checkRunHealth(j(
    {
      skipped: "provider_failure",
      failures: [{ provider: "nli", error: "timeout" }],
    },
    { works: 136, skipped: { provider_failure: 2 } },
  ));
  assertEquals(r.healthy, true);
});

const IN_USE = {
  in_use_works: 488,
  unlinked_in_use: 92,
  missed: 3,
  hebrew_label_unconfirmed: 3,
  no_evidence: 71,
  failed: 15,
  missed_rate_low: 0.0061,
  missed_rate_high: 0.043,
};

Deno.test("in-use measure format healthy", () => {
  assertEquals(checkRunHealth(j(IN_USE)).healthy, true);
});

Deno.test("in-use measure format unhealthy when failed dominates", () => {
  const r = checkRunHealth(j({ ...IN_USE, failed: 50 }));
  assertEquals(r.healthy, false);
});
