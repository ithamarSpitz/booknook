import { assertEquals } from "jsr:@std/assert@1";
import { wikidataOriginal } from "../../supabase/functions/_shared/bridges.ts";

type EntityPayload = Record<string, unknown>;

function entity(typeId: string, enLabel: string, authorId?: string): EntityPayload {
  const claims: Record<string, unknown[]> = {
    P31: [{ mainsnak: { datavalue: { value: { id: typeId } } } }],
  };
  if (authorId) claims.P50 = [{ mainsnak: { datavalue: { value: { id: authorId } } } }];
  return { labels: { en: { value: enLabel } }, claims };
}

function stubFetch(search: Array<{ id: string; label: string }>, byId: Record<string, EntityPayload>) {
  globalThis.fetch = (input) => {
    const params = new URL(String(input)).searchParams;
    if (params.get("action") === "wbsearchentities") {
      return Promise.resolve(new Response(JSON.stringify({ search }), { status: 200 }));
    }
    if (params.get("action") === "wbgetentities") {
      const entities: Record<string, EntityPayload> = {};
      for (const id of (params.get("ids") ?? "").split("|")) {
        if (byId[id]) entities[id] = byId[id];
      }
      return Promise.resolve(new Response(JSON.stringify({ entities }), { status: 200 }));
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  };
}

const AUTHOR = {
  Q181677: { labels: { en: { value: "George R. R. Martin" } }, claims: {} },
};

Deno.test("wikidataOriginal skips a book series and returns the novel", async () => {
  const originalFetch = globalThis.fetch;
  stubFetch(
    [{ id: "Q45875", label: "A Song of Ice and Fire" }, { id: "Q1052826", label: "A Game of Thrones" }],
    {
      Q45875: entity("Q1667921", "A Song of Ice and Fire", "Q181677"),
      Q1052826: entity("Q7725634", "A Game of Thrones"),
      ...AUTHOR,
    },
  );
  try {
    const result = await wikidataOriginal("משחקי הכס");
    assertEquals(result?.title, "A Game of Thrones");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("wikidataOriginal skips Q13593966 entity even with a P50 author", async () => {
  const originalFetch = globalThis.fetch;
  stubFetch(
    [{ id: "Q1", label: "Some Series" }],
    { Q1: entity("Q13593966", "Some Series", "Q181677"), ...AUTHOR },
  );
  try {
    assertEquals(await wikidataOriginal("סדרה"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("wikidataOriginal still accepts a novel", async () => {
  const originalFetch = globalThis.fetch;
  stubFetch(
    [{ id: "Q2", label: "Some Novel" }],
    { Q2: entity("Q8261", "Some Novel", "Q181677"), ...AUTHOR },
  );
  try {
    const result = await wikidataOriginal("רומן");
    assertEquals(result?.title, "Some Novel");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
