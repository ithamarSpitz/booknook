import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  extractEnglishNames,
  hebrewCandidates,
  parseNliMarc,
} from "../../supabase/functions/_shared/hebrew-candidates.ts";

const FIXTURES = new URL("./fixtures/nli-author/", import.meta.url);
const fixture = (name: string) => Deno.readTextFile(new URL(name, FIXTURES));
const bridge = (title: string | null) => async () =>
  title ? { title, author: null, source: "test" } : null;

function providers(
  xml: string,
  wikidata: Record<string, unknown> = { search: [] },
) {
  const urls: string[] = [];
  const fetcher: typeof fetch = (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("nli.alma")) return Promise.resolve(new Response(xml));
    const parsed = new URL(url);
    const action = parsed.searchParams.get("action");
    const props = parsed.searchParams.get("props");
    if (action === "wbsearchentities") {
      return Promise.resolve(Response.json(wikidata.search ?? []));
    }
    if (props === "labels|claims") {
      return Promise.resolve(Response.json({ entities: wikidata.works ?? {} }));
    }
    return Promise.resolve(Response.json({ entities: wikidata.authors ?? {} }));
  };
  return { fetcher, urls };
}

Deno.test("rule A parses MARC 240, Hebrew title and reordered author", async () => {
  const p = providers(await fixture("to-hate-adam-connor.xml"));
  const result = await hebrewCandidates({
    title: "To Hate Adam Connor",
    author: "Ella Maise",
    description: null,
  }, {
    fetch: p.fetcher,
    wikidataHebrew: bridge(null),
    nliHebrew: bridge(null),
  });
  assertEquals(result.candidates[0], {
    title: "לשנוא את אדם קונור",
    author: "אלה מייז",
    rule: "A",
  });
  assertEquals(p.urls.filter((url) => url.includes("nli.alma")).length, 2);
});

Deno.test("Snow Crash without 240 is a rule B transliteration", async () => {
  const p = providers(await fixture("snow-crash.xml"));
  const result = await hebrewCandidates({
    title: "Snow Crash",
    author: "Neal Stephenson",
    description: null,
  }, {
    fetch: p.fetcher,
    wikidataHebrew: bridge(null),
    nliHebrew: bridge(null),
  });
  assertEquals(result.candidates[0]?.title, "סנוקראש");
  assertEquals(result.candidates[0]?.rule, "B");
});

Deno.test("rule D matches the NLI 240 to the author-qualified Wikidata title", async () => {
  const wd = {
    search: { search: [{ id: "Q1" }] },
    works: {
      Q1: {
        labels: {
          en: { value: "Anxious People" },
          sv: { value: "Folk med ångest" },
        },
        claims: {
          P50: [{ mainsnak: { datavalue: { value: { id: "Q2" } } } }],
          P1476: [{
            mainsnak: { datavalue: { value: { text: "Folk med ångest" } } },
          }],
        },
      },
    },
    authors: { Q2: { labels: { en: { value: "Fredrik Backman" } } } },
  };
  const p = providers(await fixture("anxious-people.xml"), wd);
  const result = await hebrewCandidates({
    title: "Anxious People",
    author: "Fredrik Backman",
    description: null,
  }, {
    fetch: p.fetcher,
    wikidataHebrew: bridge(null),
    nliHebrew: bridge(null),
  });
  assertEquals(result.candidates[0]?.rule, "D");
  assertEquals(result.candidates[0]?.title, "אנשים חרדים");
  assertEquals(p.urls.filter((url) => url.includes("wikidata.org")).length, 3);
});

Deno.test("Never Lie extracts character names and leaves no-240 records as G", async () => {
  const p = providers(await fixture("never-lie.xml"));
  const description =
    "A newlywed couple arrives. Inside, Tricia and Ethan discover secrets about Never Lie author Freida McFadden.";
  const result = await hebrewCandidates({
    title: "Never Lie",
    author: "Freida McFadden",
    description,
  }, {
    fetch: p.fetcher,
    wikidataHebrew: bridge(null),
    nliHebrew: bridge(null),
  });
  assert(result.english_names.includes("Tricia"));
  assert(result.english_names.includes("Ethan"));
  for (const excluded of ["Freida", "McFadden", "Never", "Lie"]) {
    assert(!result.english_names.includes(excluded));
  }
  assertEquals(result.candidates.map((candidate) => candidate.rule), [
    "G",
    "G",
  ]);
});

Deno.test("provider failures remove only their rules", async () => {
  const failedNli: typeof fetch = () => Promise.reject(new Error("NLI down"));
  const bridgesOnly = await hebrewCandidates({
    title: "A Canticle for Leibowitz",
    author: "Walter M. Miller Jr.",
    description: null,
  }, {
    fetch: failedNli,
    nliHebrew: bridge("המנון ללייבוביץ"),
    wikidataHebrew: bridge("הימנון ללייבוביץ"),
  });
  assertEquals(bridgesOnly.candidates.map((candidate) => candidate.rule), [
    "E",
    "F",
  ]);

  const xml = await fixture("to-hate-adam-connor.xml");
  const noWikidata: typeof fetch = (input) =>
    String(input).includes("nli.alma")
      ? Promise.resolve(new Response(xml))
      : Promise.reject(new Error("Wikidata down"));
  const nliOnly = await hebrewCandidates({
    title: "To Hate Adam Connor",
    author: "Ella Maise",
    description: null,
  }, {
    fetch: noWikidata,
    nliHebrew: bridge(null),
    wikidataHebrew: async () => {
      throw new Error("Wikidata down");
    },
  });
  assertEquals(nliOnly.candidates[0]?.rule, "A");
});

Deno.test("candidate output is de-duplicated and capped at eight", async () => {
  const fields = Array.from({ length: 10 }, (_, index) => `
    <record><recordData><record xmlns="http://www.loc.gov/MARC21/slim">
      <datafield tag="100"><subfield code="a">סופר, אחד</subfield></datafield>
      <datafield tag="245"><subfield code="a">כותרת מספר ${index} /</subfield></datafield>
    </record></recordData></record>`).join("");
  const p = providers(
    `<searchRetrieveResponse><records>${fields}</records></searchRetrieveResponse>`,
  );
  const result = await hebrewCandidates({
    title: "Unrelated",
    author: "One Writer",
    description: null,
  }, {
    fetch: p.fetcher,
    wikidataHebrew: bridge(null),
    nliHebrew: bridge(null),
  });
  assertEquals(result.candidates.length, 8);
  assertEquals(new Set(result.candidates.map((item) => item.title)).size, 8);
});

Deno.test("english name extraction removes sentence starts and stop/title/author words", () => {
  assertEquals(
    extractEnglishNames(
      "Tricia arrives. Then Ethan meets Robin.",
      "Robin",
      "Ethan Writer",
    ),
    [],
  );
});

Deno.test("rule G names exclude common words, demonyms and review sources", () => {
  const onlyOneLeft = extractEnglishNames(
    "A story about Lenora Hope. Inside, Kit hung on until the End and Took charge.",
    "The Only One Left",
    "Riley Sager",
  );
  assert(onlyOneLeft.includes("Lenora"));
  assert(onlyOneLeft.includes("Kit"));
  for (const excluded of ["Hope", "Hung", "End", "Took"]) {
    assert(!onlyOneLeft.includes(excluded));
  }

  const prettyGirls = extractEnglishNames(
    "Sisters Claire and Lydia investigate Julia in Atlanta.",
    "Pretty Girls",
    "Karin Slaughter",
  );
  for (const kept of ["Claire", "Lydia", "Julia", "Atlanta"]) {
    assert(prettyGirls.includes(kept));
  }

  const neverLie = extractEnglishNames(
    "Newlyweds Tricia and Ethan visit Hale. Provided by Amazon.",
    "Never Lie",
    "Freida McFadden",
  );
  for (const kept of ["Tricia", "Ethan", "Hale"]) {
    assert(neverLie.includes(kept));
  }
  for (const excluded of ["Provided", "Amazon"]) {
    assert(!neverLie.includes(excluded));
  }
});

Deno.test("MARC 100 uses only subfield a and drops Latin words", async () => {
  const records = parseNliMarc(await fixture("riley-sager-author.xml"));
  assertEquals(records[0]?.author, "ריילי סאגר");
});

Deno.test("Wikidata 429 is retried once and rule D survives", async () => {
  const xml = await fixture("anxious-people.xml");
  let wikidataCalls = 0;
  const sleeps: number[] = [];
  const wd = {
    search: { search: [{ id: "Q1" }] },
    works: {
      Q1: {
        labels: { sv: { value: "Folk med ångest" } },
        claims: {
          P50: [{ mainsnak: { datavalue: { value: { id: "Q2" } } } }],
          P1476: [{
            mainsnak: { datavalue: { value: { text: "Folk med ångest" } } },
          }],
        },
      },
    },
    authors: { Q2: { labels: { en: { value: "Fredrik Backman" } } } },
  };
  const p = providers(xml, wd);
  const fetcher: typeof fetch = (input, init) => {
    if (String(input).includes("wikidata.org") && ++wikidataCalls === 1) {
      return Promise.resolve(new Response(null, { status: 429 }));
    }
    return p.fetcher(input, init);
  };
  const result = await hebrewCandidates({
    title: "Anxious People",
    author: "Fredrik Backman",
    description: null,
  }, {
    fetch: fetcher,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    wikidataHebrew: bridge(null),
    nliHebrew: bridge(null),
  });
  assertEquals(sleeps, [2_000]);
  assertEquals(result.candidates[0]?.rule, "D");
});

Deno.test("a second Wikidata 429 drops D but keeps other rules", async () => {
  const xml = await fixture("anxious-people.xml");
  let wikidataCalls = 0;
  const fetcher: typeof fetch = (input) => {
    if (String(input).includes("wikidata.org")) {
      wikidataCalls++;
      return Promise.resolve(new Response(null, { status: 429 }));
    }
    return Promise.resolve(new Response(xml));
  };
  const result = await hebrewCandidates({
    title: "Anxious People",
    author: "Fredrik Backman",
    description: null,
  }, {
    fetch: fetcher,
    sleep: () => Promise.resolve(),
    wikidataHebrew: bridge(null),
    nliHebrew: bridge("אנשים חרדים"),
  });
  assertEquals(wikidataCalls, 2);
  assert(!result.candidates.some((candidate) => candidate.rule === "D"));
  assert(result.candidates.some((candidate) => candidate.rule === "E"));
});
