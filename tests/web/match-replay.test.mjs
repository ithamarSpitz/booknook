import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
import { matchHebrewBook, simaniaIdOf } from "../../public/js/simania.js";

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
    const pick = await matchHebrewBook(
      replay.hint.title,
      replay.hint.author ?? "",
      fakeFetch(replay.results),
    );
    const pickedId = simaniaIdOf(pick);

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
