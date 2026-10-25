import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { handleRecommendations } from "../../supabase/functions/recommendations/index.ts";
import type { WorkRow } from "../../supabase/functions/_shared/types.ts";

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

function work(
  id: string,
  hardcoverId: number,
  similar: number[] = [],
): WorkRow {
  return {
    id,
    hardcover_id: hardcoverId,
    original_title: id,
    original_authors: [],
    similar_ids: similar,
    tags: {},
    hardcover_cover_url: null,
    refreshed_at: null,
  };
}

for (const initial of ["absent", "unlinked", "same-work"] as const) {
  Deno.test(`concurrent localization preserves the winning link: ${initial}`, async () => {
    const candidates = [work("first", 2), work("second", 3)];
    const seed = work("seed", 1, [2, 3]);
    let edition: Record<string, unknown> | null = initial === "absent"
      ? null
      : {
        simania_id: 42,
        title: "cached",
        work_id: null,
        resolve_status: "not_found",
        details_at: null,
      };
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    let detailCalls = 0;
    let claimAttempts = 0;
    let claimMatches = 0;
    const replacements: Record<string, unknown>[][] = [];
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
          if (table === "shelf_books") {
            result = [{
              simania_id: 1,
              position: 0,
              added_at: "2026-01-01",
              finished_at: null,
              shelves: { kind: "reading" },
              editions: { title: "seed", work_id: seed.id, works: seed },
            }];
          }
          if (table === "works") result = candidates;
          if (table === "editions") {
            if (method === "POST") {
              edition = upsertEdition(
                edition,
                values,
                headerValue(options?.headers as HeadersInit | undefined, "Prefer"),
              );
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
              result = url.searchParams.has("work_id")
                ? null
                : edition && { ...edition };
            }
          }
          if (table === "replace_recommendations") {
            replacements.push(values.p_rows);
            for (const row of values.p_rows) {
              assert(
                row.simania_id === null || row.work_id === edition?.work_id,
                "replacement must never reference a mismatched edition",
              );
            }
            result = values.p_rows.map((row: Record<string, unknown>) => ({
              ...row,
              dismissed: false,
              generated_at: "2026-10-25T00:00:00Z",
            }));
          }
          return new Response(JSON.stringify(result), {
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    });
    const response = await handleRecommendations(
      new Request("http://local/recommendations", {
        method: "POST",
        body: "{}",
      }),
      {
        authenticate: async () => "user",
        userDatabase: () => client,
        serviceDatabase: () => client,
        localize: async () => ({
          book: { id: 42, title: "localized" },
          status: "wikidata",
        }),
        editionDetails: async () => {
          detailCalls++;
          if (detailCalls === 2) {
            // Both candidates have observed the same absent/null link before writes.
            if (initial === "same-work") {
              edition = {
                ...edition,
                work_id: "first",
                resolve_status: "nli",
                resolved_at: "original",
              };
            }
            release();
          }
          await bothRead;
          return { title: "localized", details_at: "2026-10-25T00:00:00Z" };
        },
      },
    );
    assert(
      response.status === 200,
      "request should succeed despite competing localizations",
    );
    const cards = (await response.json()).recommendations;
    assert(
      detailCalls === 2 && claimAttempts === 2,
      "both candidates must compete for the link",
    );
    assert(
      replacements.length === 1 && cards.length === 2,
      "both candidates must be retained",
    );
    assert(
      cards.filter((card: { english_only: boolean }) => card.english_only)
        .length === 1,
      "losing candidate must become English-only",
    );
    if (initial === "same-work") {
      assert(
        claimMatches === 0,
        "an already-linked edition must not be claimed again",
      );
      assert(
        edition?.work_id === "first" &&
          edition?.resolve_status === "nli" &&
          edition?.resolved_at === "original",
        "an existing same-work link must retain its resolution metadata",
      );
    } else {
      assert(
        claimMatches === 1,
        "exactly one candidate must win an unlinked edition",
      );
    }
  });
}
