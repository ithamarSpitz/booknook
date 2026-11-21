import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
import { matchOmnibus } from "../../public/js/simania.js";
import { localizeRecommendations } from "../../public/js/recs.js";

test("omnibus replay matches only All Systems Red", async () => {
  const text = await readFile(new URL("./fixtures/omnibus-replay.jsonl", import.meta.url), "utf8");
  const cases = text.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  for (const c of cases) {
    const pick = matchOmnibus(c.hint.title, c.results);
    if (c.hardcover_id === 427971) assert.equal(pick?.id, 1026206);
    else assert.equal(pick, null, `hardcover ${c.hardcover_id}`);
  }
});

test("matchOmnibus pure cases", () => {
  const sub = "כשל מערכות | התנייה מלאכותית";
  assert.equal(matchOmnibus("כשל מערכות", [{ id: 1, subtitle: "כשל מערכות" }]), null);
  assert.equal(matchOmnibus("כשל מערכות", [{ id: 1, subtitle: sub }, { id: 2, subtitle: sub }]), null);
  assert.equal(matchOmnibus("כשל מערכות", [{ id: 1, subtitle: sub }])?.id, 1);
  assert.equal(matchOmnibus("התנייה", [{ id: 1, subtitle: sub }]), null);
});

function run({ author, match, searched }) {
  const sent = [];
  const rec = {
    work_id: "w1",
    title: "All Systems Red",
    author: "Martha Wells",
    english_only: true,
    can_add: false,
    hebrew_hint: { source: "wikidata", title: "כשל מערכות", author: null },
    hebrew_author: null,
  };
  return localizeRecommendations([rec], {
    match,
    searchByAuthor: async () => [],
    searchBooks: async (q, n) => {
      searched.push([q, n]);
      return [{ id: 1026206, title: "יומני רובורצח - כרך 1", author, subtitle: "כשל מערכות | התנייה מלאכותית" }];
    },
    fetchPayload: async () => ({ details: { title: "יומני רובורצח - כרך 1", author }, rating: null }),
    callFunction: async (name, body) => {
      sent.push([name, body]);
      return { simania_id: body.simania_id, title: "x", author: null, cover_url: null };
    },
    onLinked: () => {},
    isCurrent: () => true,
  }).then(() => sent);
}

test("localize links the omnibus volume", async () => {
  const searched = [];
  const sent = await run({ author: "מרתה וולס", match: async () => null, searched });
  const links = sent.filter(([n]) => n === "link-edition");
  assert.equal(links.length, 1);
  assert.equal(links[0][1].simania_id, 1026206);
  assert.equal(links[0][1].source, "omnibus");
  assert.deepEqual(searched, [["כשל מערכות", 6]]);
});

test("localize rejects omnibus on author mismatch", async () => {
  const sent = await run({ author: "סופר אחר", match: async () => null, searched: [] });
  assert.equal(sent.filter(([n]) => n === "link-edition").length, 0);
});

test("localize skips omnibus search when the title match hits", async () => {
  const searched = [];
  await run({
    author: "מרתה וולס",
    match: async () => ({ id: 5, title: "כשל מערכות", author: "מרתה וולס" }),
    searched,
  });
  assert.equal(searched.length, 0);
});
