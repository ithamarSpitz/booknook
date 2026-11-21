import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
import { matchHebrewBook, simaniaIdOf, stripHebrewBoxWords } from "../../public/js/simania.js";

const fixtureUrl = new URL("./fixtures/match-replay.jsonl", import.meta.url);

function fakeFetch(results) {
  return async () => {
    const envelope = {
      result: {
        content: [{ type: "text", text: JSON.stringify({ books: results }) }],
      },
    };
    return new Response(`event: message\ndata: ${JSON.stringify(envelope)}\n\n`, { status: 200 });
  };
}

test("S29 Simania matching preserves linked picks and accepts the replay cases", async () => {
  const text = await readFile(fixtureUrl, "utf8");
  const cases = text.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  let linkedCases = 0;

  for (const replay of cases) {
    // Mirrors localizeRecommendations: single-book cards drop Hebrew box words.
    const boxCard = /(?:Trilogy|Collection|Box Set|Boxed Set|Omnibus)/i.test(replay.english_title ?? "");
    const stripped = stripHebrewBoxWords(replay.hint.title);
    const hintTitle = !boxCard && stripped && stripped !== replay.hint.title
      ? stripped
      : replay.hint.title;
    const pick = await matchHebrewBook(
      hintTitle,
      replay.hint.author ?? "",
      fakeFetch(replay.results),
    );
    const pickedId = simaniaIdOf(pick);

    if (replay.hardcover_id === 88639) {
      // S31 box-set hints: the Hunger Games hint no longer picks the box set.
      assert.notEqual(pickedId, 980165, "hardcover_id 88639");
      if (replay.linked.includes(replay.current)) linkedCases++;
      continue;
    }
    if (replay.linked.includes(replay.current)) {
      linkedCases++;
      assert.equal(pickedId, replay.current, `hardcover_id ${replay.hardcover_id}`);
    }
    if (replay.linked.length === 0) {
      const expected = replay.hardcover_id === 175780 ? 982600 : replay.current;
      assert.equal(pickedId, expected, `hardcover_id ${replay.hardcover_id}`);
    }
  }

  assert.equal(linkedCases, 213);
});
