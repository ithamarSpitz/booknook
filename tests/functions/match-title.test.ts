import { assertEquals } from "jsr:@std/assert@1";
import {
  ensureResolved,
  matchTitle,
} from "../../supabase/functions/_shared/catalog.ts";
import { titleMatch } from "../../supabase/functions/_shared/fallback-match.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";
import {
  normalize,
  similarity,
} from "../../supabase/functions/_shared/utils.ts";
import { edition, FakeDb } from "./helpers/fake-db.ts";

const NOW = new Date("2026-10-25T10:00:00.000Z");

Deno.test("matching ignores Hebrew points and turns maqaf into a space", () => {
  assertEquals(similarity("אינטרמצו", "אִינְטֶרְמֶצּוֹ"), 1);
  assertEquals(normalize("בית־ספר"), "בית ספר");
  assertEquals(titleMatch("אינטרמצו", "אִינְטֶרְמֶצּוֹ"), true);
});

Deno.test("matchTitle strips trailing edition labels on live titles", () => {
  assertEquals(matchTitle("חפצים חדים (2015)"), "חפצים חדים");
  assertEquals(
    matchTitle("ההיסטוריה הסודית [מהדורת מודן - 2015]"),
    "ההיסטוריה הסודית",
  );
  assertEquals(matchTitle("הנסיכה הקסומה [מהדורת 2018]"), "הנסיכה הקסומה");
  assertEquals(
    matchTitle("מחר ועוד מחר ועוד מחר [עטיפה חדשה]"),
    "מחר ועוד מחר ועוד מחר",
  );
  assertEquals(matchTitle("עין החתול [מהדורת 2011]"), "עין החתול");
});

Deno.test("matchTitle handles multiple labels and edge cases", () => {
  assertEquals(matchTitle("ספר (2010) [מהדורה חדשה]"), "ספר");
  assertEquals(matchTitle("כותרת נקייה"), "כותרת נקייה");
  assertEquals(matchTitle("ספר (א) של אחר"), "ספר (א) של אחר");
  assertEquals(matchTitle("(2015)"), "(2015)");
  assertEquals(matchTitle("ואם היו אומרים לך "), "ואם היו אומרים לך");
});

Deno.test("matchTitle collapses whitespace runs into one space", () => {
  assertEquals(matchTitle("עולם חדש  מופלא"), "עולם חדש מופלא");
  assertEquals(matchTitle("עולם\tחדש\n\n מופלא"), "עולם חדש מופלא");
  assertEquals(matchTitle("Title  (Hebrew)"), "Title");
});

Deno.test("ensureResolved sends match title to providers and keeps stored title", async () => {
  const displayTitle = "חפצים חדים (2015)";
  const matchTitleClean = "חפצים חדים";
  const current = edition({ title: displayTitle }) as EditionRow;
  const db = new FakeDb({ editions: [current] });
  const wikidataTitles: string[] = [];
  const nliTitles: string[] = [];
  const fuzzyTitles: string[] = [];

  await ensureResolved(db, current, {
    now: () => NOW,
    wikidataOriginal: async (title) => {
      wikidataTitles.push(title);
      return null;
    },
    nliOriginal: async (title) => {
      nliTitles.push(title);
      return null;
    },
    findHardcoverBook: async (title) => {
      fuzzyTitles.push(title);
      return title === matchTitleClean
        ? { id: 130839, title: "Sharp Objects" }
        : null;
    },
  });

  assertEquals(wikidataTitles, [matchTitleClean]);
  assertEquals(nliTitles, [matchTitleClean]);
  assertEquals(fuzzyTitles, [matchTitleClean]);
  assertEquals(db.tables.editions[0].title, displayTitle);
});

Deno.test("matchTitle strips trailing dash edition labels", () => {
  const cases: [string, string][] = [
    ["בורות - מהדורת 2003", "בורות"],
    ["כמה טוב להיות פרח קיר - עטיפת הסרט", "כמה טוב להיות פרח קיר"],
    ["טירת הזכוכית - מהדורה מחודשת", "טירת הזכוכית"],
    ["התלקחות - משחקי הרעב 2 - כריכה קשה", "התלקחות - משחקי הרעב 2"],
    ["אידיוט - כרכים א'-ב' [מהדורת 1993]", "אידיוט"],
    ["1984 [מהדורת 2003]", "1984"],
    ["יומני רובורצח - כרך 1", "יומני רובורצח - כרך 1"],
    ["ספר – מהדורה שנייה", "ספר"],
    ["מהדורה מחודשת", "מהדורה מחודשת"],
    ["בית-ספר", "בית-ספר"],
  ];
  for (const [input, expected] of cases) {
    assertEquals(matchTitle(input), expected);
  }
});
