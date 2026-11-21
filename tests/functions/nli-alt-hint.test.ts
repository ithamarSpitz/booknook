import { defaultHebrewHint } from "../../supabase/functions/recommendations/index.ts";

const book = {
  id: 1,
  title: "Pet Sematary",
  cached_contributors: [{ author: { name: "Stephen King" } }],
};

type Hit = { title: string; author: string | null } | null;

function bridges(wikidata: Hit, nli: Hit | "throw") {
  const calls = { nli: 0 };
  return {
    calls,
    bridges: {
      wikidataHebrew: () => Promise.resolve(wikidata),
      nliHebrew: () => {
        calls.nli++;
        if (nli === "throw") return Promise.reject(new Error("nli down"));
        return Promise.resolve(nli);
      },
    } as unknown as Parameters<typeof defaultHebrewHint>[1],
  };
}

function assertEquals(actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

Deno.test("wikidata hint carries a different NLI title as alternate", async () => {
  const { bridges: b } = bridges(
    { title: "בית קברות לחיות", author: null },
    { title: "בית כברות לחיות", author: null },
  );
  assertEquals(await defaultHebrewHint(book, b), {
    source: "wikidata",
    title: "בית קברות לחיות",
    author: null,
    alternate: "בית כברות לחיות",
  });
});

Deno.test("same NLI title after normalization gives no alternate", async () => {
  const { bridges: b } = bridges(
    { title: "בית קברות לחיות", author: null },
    { title: "  בית קברות לחיות ", author: null },
  );
  const hint = await defaultHebrewHint(book, b);
  assertEquals(hint, { source: "wikidata", title: "בית קברות לחיות", author: null });
});

Deno.test("NLI failure leaves the wikidata hint unchanged", async () => {
  const { bridges: b } = bridges({ title: "בית קברות לחיות", author: null }, "throw");
  assertEquals(await defaultHebrewHint(book, b), {
    source: "wikidata",
    title: "בית קברות לחיות",
    author: null,
  });
});

Deno.test("NLI-only hint has no alternate and NLI is called once", async () => {
  const { bridges: b, calls } = bridges(null, { title: "בית כברות לחיות", author: null });
  assertEquals(await defaultHebrewHint(book, b), {
    source: "nli",
    title: "בית כברות לחיות",
    author: null,
  });
  assertEquals(calls.nli, 1);
});
