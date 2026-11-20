import { assertEquals } from "jsr:@std/assert@1";
import {
  checkHardcoverBudget,
  hardcoverDailyRemaining,
} from "../../scripts/lib/hardcover-budget.ts";

const KEY = "hardcover-secret";
const ENV_FILE_MARKER = `
HARDCOVER_API_KEY='hardcover-secret'
`;

function env(values: Record<string, string> = {}) {
  return { get: (name: string) => values[name] };
}

function responseFetch(
  remaining: string | null,
  status = 200,
  calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [],
): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input, init });
    const headers = remaining === null
      ? undefined
      : { "x-ratelimit-daily-remaining": remaining };
    return Promise.resolve(new Response(null, { status, headers }));
  }) as typeof fetch;
}

Deno.test("hardcoverDailyRemaining reads a 200 response header", async () => {
  assertEquals(
    await hardcoverDailyRemaining(
      responseFetch("4200"),
      env({
        HARDCOVER_API_KEY: KEY,
      }),
    ),
    4200,
  );
});

Deno.test("hardcoverDailyRemaining reads a 429 response header", async () => {
  assertEquals(
    await hardcoverDailyRemaining(
      responseFetch("0", 429),
      env({
        HARDCOVER_API_KEY: KEY,
      }),
    ),
    0,
  );
});

Deno.test("hardcoverDailyRemaining returns null for unavailable quota data", async () => {
  assertEquals(
    await hardcoverDailyRemaining(
      responseFetch(null),
      env({
        HARDCOVER_API_KEY: KEY,
      }),
    ),
    null,
  );
  assertEquals(
    await hardcoverDailyRemaining(
      (() => {
        throw new Error("network failure");
      }) as typeof fetch,
      env({ HARDCOVER_API_KEY: KEY }),
    ),
    null,
  );

  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> =
    [];
  assertEquals(
    await hardcoverDailyRemaining(responseFetch("99", 200, calls), env()),
    null,
  );
  assertEquals(calls.length, 0);
});

Deno.test("hardcoverDailyRemaining reads and unquotes a key from BOOKNOOK_ENV_FILE", async () => {
  // The suite grants read-only filesystem access, so this source is the fixture.
  // ENV_FILE_MARKER above deliberately contains a physical env-file line.
  assertEquals(ENV_FILE_MARKER.includes(KEY), true);
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> =
    [];
  assertEquals(
    await hardcoverDailyRemaining(
      responseFetch("7", 200, calls),
      env({
        BOOKNOOK_ENV_FILE: await Deno.realPath(
          "tests/functions/hardcover-budget.test.ts",
        ),
      }),
    ),
    7,
  );
  assertEquals(
    new Headers(calls[0].init?.headers).get("authorization"),
    `Bearer ${KEY}`,
  );
});

Deno.test("hardcoverDailyRemaining does not duplicate a Bearer prefix", async () => {
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> =
    [];
  await hardcoverDailyRemaining(
    responseFetch("1", 200, calls),
    env({
      HARDCOVER_API_KEY: `Bearer ${KEY}`,
    }),
  );
  assertEquals(
    new Headers(calls[0].init?.headers).get("authorization"),
    `Bearer ${KEY}`,
  );
});

Deno.test("checkHardcoverBudget enforces the minimum unless forced", async () => {
  const cases = [
    { remaining: "0", force: false, expected: false, lines: 2 },
    { remaining: "0", force: true, expected: true, lines: 1 },
    { remaining: null, force: false, expected: true, lines: 1 },
    { remaining: "2000", force: false, expected: true, lines: 1 },
  ];

  for (const testCase of cases) {
    const logs: string[] = [];
    assertEquals(
      await checkHardcoverBudget({
        min: 1500,
        force: testCase.force,
        fetchImpl: responseFetch(testCase.remaining),
        env: env({ HARDCOVER_API_KEY: KEY }),
        log: (line) => logs.push(line),
      }),
      testCase.expected,
    );
    assertEquals(logs.length, testCase.lines);
    assertEquals(JSON.parse(logs[0]), {
      hardcover_daily_remaining: testCase.remaining === null
        ? null
        : Number(testCase.remaining),
    });
    if (!testCase.expected) {
      assertEquals(
        logs[1],
        "Hardcover daily quota too low: 0 < 1500 (use --force-hardcover)",
      );
    }
  }
});

Deno.test("Hardcover budget logs never contain the API key", async () => {
  const logs: string[] = [];
  await checkHardcoverBudget({
    min: 1500,
    force: false,
    fetchImpl: responseFetch("0"),
    env: env({ HARDCOVER_API_KEY: KEY }),
    log: (line) => logs.push(line),
  });
  assertEquals(logs.some((line) => line.includes(KEY)), false);
});
