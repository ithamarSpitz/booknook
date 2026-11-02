import { assertEquals } from "jsr:@std/assert@1";
import { wikidataHebrew } from "../../supabase/functions/_shared/bridges.ts";

type EntityPayload = Record<string, unknown>;

function entityResponse(entities: Record<string, EntityPayload>): string {
  return JSON.stringify({ entities });
}

function writtenWorkEntity(
  id: string,
  heLabel: string,
  p50?: string[],
): EntityPayload {
  const claims: Record<string, unknown[]> = {
    P31: [{ mainsnak: { datavalue: { value: { id: "Q571" } } } }],
  };
  if (p50?.length) {
    claims.P50 = p50.map((authorId) => ({
      mainsnak: { datavalue: { value: { id: authorId } } },
    }));
  }
  return {
    labels: { he: { value: heLabel }, en: { value: "English title" } },
    claims,
  };
}

function editionEntity(workId: string): EntityPayload {
  return {
    labels: { en: { value: "Spin, original Tor hardcover edition" } },
    claims: {
      P629: [{ mainsnak: { datavalue: { value: { id: workId } } } }],
    },
  };
}

function humanAuthor(id: string, enLabel: string, heLabel = ""): EntityPayload {
  const labels: Record<string, { value: string }> = { en: { value: enLabel } };
  if (heLabel) labels.he = { value: heLabel };
  return { labels, claims: { P31: [{ mainsnak: { datavalue: { value: { id: "Q5" } } } }] } };
}

function searchResponse(
  items: Array<{ id: string; label: string; description?: string }>,
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

Deno.test("wikidataHebrew follows P629 from edition to work with matching author", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = String(input);
    if (urlAction(url) === "wbsearchentities") {
      return Promise.resolve(
        new Response(
          searchResponse([
            {
              id: "Q87484739",
              label: "Spin, original Tor hardcover edition",
              description: "Robert Charles Wilson novel",
            },
          ]),
          { status: 200 },
        ),
      );
    }
    if (urlAction(url) === "wbgetentities") {
      const byId: Record<string, EntityPayload> = {
        Q87484739: editionEntity("Q2301398"),
        Q2301398: writtenWorkEntity("Q2301398", "סחרור", ["Q313396"]),
        Q313396: humanAuthor("Q313396", "Robert Charles Wilson", "רוברט צ'רלס וילסון"),
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
    const result = await wikidataHebrew("Spin", "Robert Charles Wilson");
    assertEquals(result, {
      title: "סחרור",
      author: "רוברט צ'רלס וילסון",
      source: "Wikidata",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("wikidataHebrew skips author mismatch and uses a later valid result", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = String(input);
    if (urlAction(url) === "wbsearchentities") {
      return Promise.resolve(
        new Response(
          searchResponse([
            {
              id: "Q64706695",
              label: "Spin, Star Trek novel",
              description: "William Shatner",
            },
            { id: "Q87484739", label: "Spin, original Tor hardcover edition" },
          ]),
          { status: 200 },
        ),
      );
    }
    if (urlAction(url) === "wbgetentities") {
      const byId: Record<string, EntityPayload> = {
        Q64706695: writtenWorkEntity("Q64706695", "ספין", ["Q162186"]),
        Q162186: humanAuthor("Q162186", "William Shatner"),
        Q87484739: editionEntity("Q2301398"),
        Q2301398: writtenWorkEntity("Q2301398", "סחרור", ["Q313396"]),
        Q313396: humanAuthor("Q313396", "Robert Charles Wilson"),
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
    const result = await wikidataHebrew("Spin", "Robert Charles Wilson");
    assertEquals(result?.title, "סחרור");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("wikidataHebrew strips trailing parenthetical disambiguation from Hebrew label", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = String(input);
    if (urlAction(url) === "wbsearchentities") {
      return Promise.resolve(
        new Response(
          searchResponse([{ id: "Q1196405", label: "The Dead Zone" }]),
          { status: 200 },
        ),
      );
    }
    if (urlAction(url) === "wbgetentities") {
      const entities = {
        Q1196405: writtenWorkEntity("Q1196405", "האזור המת (ספר)", ["Q297751"]),
        Q297751: humanAuthor("Q297751", "Stephen King"),
      };
      return Promise.resolve(new Response(entityResponse(entities), { status: 200 }));
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  };
  try {
    const result = await wikidataHebrew("The Dead Zone", "Stephen King");
    assertEquals(result?.title, "האזור המת");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("wikidataHebrew accepts written work without P50 when author hint is set", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = String(input);
    if (urlAction(url) === "wbsearchentities") {
      return Promise.resolve(
        new Response(searchResponse([{ id: "Q999", label: "Some Title" }]), {
          status: 200,
        }),
      );
    }
    if (urlAction(url) === "wbgetentities") {
      return Promise.resolve(
        new Response(
          entityResponse({ Q999: writtenWorkEntity("Q999", "כותרת עברית") }),
          { status: 200 },
        ),
      );
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  };
  try {
    const result = await wikidataHebrew("Some Title", "Anyone At All");
    assertEquals(result, { title: "כותרת עברית", author: "", source: "Wikidata" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("wikidataHebrew returns null on fetch failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response("error", { status: 500 }));
  try {
    assertEquals(await wikidataHebrew("Spin", "Author"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
