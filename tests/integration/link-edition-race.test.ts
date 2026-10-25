import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { createHandler } from "../../supabase/functions/link-edition/index.ts";
import { ensureEdition } from "../../supabase/functions/_shared/catalog.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function headerValue(
  headers: HeadersInit | undefined,
  name: string,
): string {
  if (!headers) return "";
  if (headers instanceof Headers) return headers.get(name) ?? "";
  if (Array.isArray(headers)) {
    return headers
      .filter(([key]) => key.toLowerCase() === name.toLowerCase())
      .map(([, value]) => value)
      .join(",");
  }
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return String(value);
  }
  return "";
}

function upsertEdition(
  current: Record<string, unknown> | null,
  values: Record<string, unknown>,
  prefer: string,
): Record<string, unknown> {
  // supabase-js 2.45.4 defaults defaultToNull: true (Prefer missing=null):
  // omitted columns become null. missing=default keeps existing values
  // and uses database defaults on insert.
  const keepOmitted = /\bmissing=default\b/i.test(prefer);
  if (!current) {
    return keepOmitted
      ? {
        work_id: null,
        resolve_status: "pending",
        resolved_at: null,
        ...values,
      }
      : { work_id: null, resolve_status: null, resolved_at: null, ...values };
  }
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(current)) {
    next[key] = keepOmitted ? current[key] : null;
  }
  return { ...next, ...values };
}

const simania = { details: { title: "localized" }, rating: null };

for (const initial of ["absent", "unlinked", "same-work"] as const) {
  Deno.test(`concurrent link-edition calls preserve the winning link: ${initial}`, async () => {
    let edition: Record<string, unknown> | null = initial === "absent"
      ? null
      : {
        simania_id: 42,
        title: "cached",
        work_id: initial === "same-work" ? "first" : null,
        resolve_status: initial === "same-work" ? "nli" : "not_found",
        resolved_at: initial === "same-work" ? "original" : null,
        details_at: null,
      };
    const recommendations = [
      { user_id: "user", work_id: "first", simania_id: null, dismissed: false },
      { user_id: "user", work_id: "second", simania_id: null, dismissed: false },
    ];
    let claimAttempts = 0;
    let claimMatches = 0;
    const client = createClient("http://database.invalid", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, options) => {
          const url = new URL(String(input));
          const table = url.pathname.split("/").at(-1);
          const method = options?.method ?? "GET";
          const rawBody = options?.body
            ? JSON.parse(String(options.body))
            : null;
          const values = Array.isArray(rawBody) ? rawBody[0] : rawBody;
          let result: unknown = [];
          if (table === "recommendations") {
            const workId = url.searchParams.get("work_id")?.replace(/^eq\./, "");
            const rows = recommendations.filter((row) => row.work_id === workId);
            if (method === "PATCH") {
              for (const row of rows) Object.assign(row, values);
            }
            result = rows.map((row) => ({ ...row }));
          }
          if (table === "editions") {
            if (method === "POST") {
              edition = upsertEdition(
                edition,
                values,
                headerValue(options?.headers as HeadersInit | undefined, "Prefer"),
              );
              result = [{ ...edition }];
            } else if (method === "PATCH") {
              claimAttempts++;
              assert(
                url.searchParams.get("work_id") === "is.null",
                "link claim must be conditional",
              );
              if (edition?.work_id == null) {
                claimMatches++;
                edition = { ...edition, ...values };
              }
            } else {
              result = edition ? [{ ...edition }] : [];
            }
          }
          const single = /vnd\.pgrst\.object/.test(
            headerValue(options?.headers as HeadersInit | undefined, "Accept"),
          );
          const payload = single && Array.isArray(result) ? result[0] ?? null : result;
          return new Response(JSON.stringify(payload), {
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    });

    // Both requests read the edition before either one claims it.
    let arrived = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = createHandler({
      requireUser: async () => "user",
      serviceClient: () => client,
      userClient: () => client,
      ensureEdition: async (db, id, overrides) => {
        const row = await ensureEdition(db, id, overrides);
        if (++arrived === 2) release();
        await bothRead;
        return row;
      },
    });
    const call = (workId: string) =>
      handler(
        new Request("http://local/link-edition", {
          method: "POST",
          body: JSON.stringify({
            work_id: workId,
            simania_id: 42,
            source: "wikidata",
            simania,
          }),
        }),
      );
    const statuses = (await Promise.all([call("first"), call("second")]))
      .map((response) => response.status);

    const winner = statuses[0] === 200 ? 0 : 1;
    assert(
      statuses[winner] === 200 && statuses[1 - winner] === 409,
      `exactly one request must win and the other conflict, got ${statuses}`,
    );
    if (initial === "same-work") {
      assert(winner === 0, "the already-linked work must win");
    }
    const winnerWork = recommendations[winner].work_id;
    assert(edition?.work_id === winnerWork, "the edition must stay linked to the winner");
    assert(
      recommendations[winner].simania_id === 42 &&
        recommendations[1 - winner].simania_id === null,
      "only the winner's recommendation may reference the edition",
    );
    if (initial === "same-work") {
      assert(
        claimMatches === 0,
        "an already-linked edition must not be claimed again",
      );
      assert(
        edition?.resolve_status === "nli" && edition?.resolved_at === "original",
        "an existing same-work link must retain its resolution metadata",
      );
    } else {
      assert(claimAttempts === 2, "both requests must compete for the link");
      assert(claimMatches === 1, "exactly one request must win an unlinked edition");
    }
  });
}
