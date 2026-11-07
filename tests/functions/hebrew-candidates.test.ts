import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  extractEnglishNames,
  hebrewCandidates,
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
