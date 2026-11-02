import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  ProviderError,
  wikidataEnglishAuthor,
  wikidataHebrewAuthor,
} from "../../supabase/functions/_shared/bridges.ts";

type EntityPayload = Record<string, unknown>;

function entityResponse(entities: Record<string, EntityPayload>): string {
  return JSON.stringify({ entities });
}

function humanEntity(
  id: string,
  enLabel: string,
  heLabel?: string,
): EntityPayload {
  const labels: Record<string, { value: string }> = { en: { value: enLabel } };
  if (heLabel !== undefined) {
    if (heLabel) labels.he = { value: heLabel };
  }
  return { labels, claims: { P31: [{ mainsnak: { datavalue: { value: { id: "Q5" } } } }] } };
}

function filmEntity(id: string, enLabel: string, heLabel?: string): EntityPayload {
  const labels: Record<string, { value: string }> = { en: { value: enLabel } };
  if (heLabel) labels.he = { value: heLabel };
  return {
    labels,
    claims: { P31: [{ mainsnak: { datavalue: { value: { id: "Q11424" } } } }] },
  };
}

function searchResponse(
  items: Array<{ id: string; label: string }>,
): string {
  return JSON.stringify({ search: items });
}

function urlAction(url: string): string {
  return new URL(url).searchParams.get("action") ?? "";
}

function urlIds(url: string): string[] {
  const ids = new URL(url).searchParams.get("ids");
  return ids ? ids.split("|") : [];
}

Deno.test("wikidataHebrewAuthor returns Hebrew label and skips non-human first result", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = String(input);
    if (urlAction(url) === "wbsearchentities") {
      return Promise.resolve(
        new Response(
          searchResponse([
            { id: "Qfilm", label: "Fredrik Backman" },
            { id: "Q44330", label: "Fredrik Backman" },
          ]),
          { status: 200 },
        ),
      );
    }
    if (urlAction(url) === "wbgetentities") {
      const byId: Record<string, EntityPayload> = {
        Qfilm: filmEntity("Qfilm", "Fredrik Backman", "איש ושמו אובה"),
        Q44330: humanEntity("Q44330", "Fredrik Backman", "פרדריק בקמן"),
      };
      const entities: Record<string, EntityPayload> = {};
      for (const id of urlIds(url)) {
        if (byId[id]) entities[id] = byId[id];
      }
      return Promise.resolve(new Response(entityResponse(entities), { status: 200 }));
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  };
  try {
    assertEquals(await wikidataHebrewAuthor("Fredrik Backman"), "פרדריק בקמן");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("wikidataHebrewAuthor returns null without exact-label search hit", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = String(input);
    if (urlAction(url) === "wbsearchentities") {
      return Promise.resolve(
        new Response(
          searchResponse([{ id: "Q1", label: "Fredrik Backmann" }]),
          { status: 200 },
        ),
      );
    }
    if (urlAction(url) === "wbgetentities") {
      return Promise.resolve(
        new Response(
          entityResponse({
            Q1: humanEntity("Q1", "Fredrik Backmann", "פרדריק בקמן"),
          }),
          { status: 200 },
        ),
      );
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  };
  try {
    assertEquals(await wikidataHebrewAuthor("Fredrik Backman"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("wikidataHebrewAuthor returns null when human has no Hebrew label", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = String(input);
    if (urlAction(url) === "wbsearchentities") {
      return Promise.resolve(
        new Response(
          searchResponse([{ id: "Q44330", label: "Fredrik Backman" }]),
          { status: 200 },
        ),
      );
    }
    if (urlAction(url) === "wbgetentities") {
      return Promise.resolve(
        new Response(
          entityResponse({
            Q44330: humanEntity("Q44330", "Fredrik Backman", ""),
          }),
          { status: 200 },
        ),
      );
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  };
  try {
    assertEquals(await wikidataHebrewAuthor("Fredrik Backman"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("wikidataEnglishAuthor maps Hebrew name to English and skips weak Hebrew match", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = String(input);
    if (urlAction(url) === "wbsearchentities") {
      return Promise.resolve(
        new Response(
          searchResponse([
            { id: "Q37610", label: "David Ben-Gurion" },
            { id: "Q5238181", label: "David Koepp" },
          ]),
          { status: 200 },
        ),
      );
    }
    if (urlAction(url) === "wbgetentities") {
      const byId: Record<string, EntityPayload> = {
        Q37610: humanEntity("Q37610", "David Ben-Gurion", "דוד בן גוריון"),
        Q5238181: humanEntity("Q5238181", "David Koepp", "דיוויד קופ"),
      };
      const entities: Record<string, EntityPayload> = {};
      for (const id of urlIds(url)) {
        if (byId[id]) entities[id] = byId[id];
      }
      return Promise.resolve(new Response(entityResponse(entities), { status: 200 }));
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  };
  try {
    assertEquals(await wikidataEnglishAuthor("דיוויד קופ"), "David Koepp");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("wikidata author bridges return null on fetch failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response("error", { status: 500 }));
  try {
    assertEquals(await wikidataHebrewAuthor("Fredrik Backman"), null);
    await assertRejects(
      () => wikidataEnglishAuthor("דיוויד קופ"),
      ProviderError,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
