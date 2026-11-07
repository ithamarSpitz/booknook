import { assertEquals } from "jsr:@std/assert@1";
import {
  mainTitle as browserMainTitle,
  titleMatch as browserTitleMatch,
} from "../../public/js/hebrew-fallback.js";
import { nameSoundScore as browserNameSoundScore } from "../../public/js/names.js";
import {
  mainTitle as serverMainTitle,
  titleMatch as serverTitleMatch,
} from "../../supabase/functions/_shared/fallback-match.ts";
import { nameSoundScore as serverNameSoundScore } from "../../supabase/functions/_shared/names.ts";

const NAME_CASES: Array<[string, string]> = [
  ["סטיבן קינג", "Stephen King"],
  ["פרידה מקפדן", "Freida McFadden"],
  ["ססיליה אדוארד", "Cecilia Edward"],
  ["רופי תורפ", "Rufi Thorpe"],
  ["אבי חימנז", "Abby Jimenez"],
  ["אבי חימנז", "Karin N. Mango"],
  ["אבי חימנז", "Laura Van Wormer"],
  ["אבי חימנז", "Judy Astley"],
  ["אבי חימנז", "Melody Carlson"],
  ["אבי חימנז", "Jenna Rutland"],
  ["אבי חימנז", "Sue Moorcroft"],
  ["ג'ון", "John"],
  ["צ׳רלס", "Charles"],
  ["וולטר מילר", "Walter Miller"],
  ["מקס בארי", "Max Barry"],
  ["דיוויד קופ", "Kim Stanley Robinson"],
];

const TITLE_CASES: Array<[string, string]> = [
  ["To hate Adam Conor", "To Hate Adam Connor"],
  ["Aurora", "Blackout"],
  ["הימנון ללייבוביץ [מהדורת 2003]", "הימנון ללייבוביץ"],
  ["לקסיקון : כשמילים יכולות להרוג", "לקסיקון"],
  ["The Woman in Cabin 10", "Woman in Cabin Ten"],
  ["The Women (Kristin Hannah)", "The Women"],
  ["Snow Crash", "Snow Crash"],
  ["Anxious People", "Folk med Ångest"],
  ["Girl in Landscape", "Girl in a Landscape"],
  ["Small Island", "Small Island [Paperback]"],
  ["Never Lie", "Never Lie: A Novel"],
  ["A Canticle for Leibowitz", "Canticle for Leibowitz"],
  ["חפצים חדים (2015)", "חפצים חדים"],
  ["ההיסטוריה הסודית [מהדורת מודן - 2015]", "ההיסטוריה הסודית"],
  ["מחר ועוד מחר ועוד מחר [עטיפה חדשה]", "מחר ועוד מחר ועוד מחר"],
  ["עין החתול [מהדורת 2011]", "עין החתול"],
];

Deno.test("browser and server fallback helpers stay in parity", () => {
  assertEquals(NAME_CASES.length + TITLE_CASES.length >= 30, true);
  for (const [hebrew, latin] of NAME_CASES) {
    assertEquals(
      browserNameSoundScore(hebrew, [latin]),
      serverNameSoundScore(hebrew, [latin]),
      `${hebrew} / ${latin}`,
    );
  }
  for (const [left, right] of TITLE_CASES) {
    assertEquals(browserMainTitle(left), serverMainTitle(left), left);
    assertEquals(browserMainTitle(right), serverMainTitle(right), right);
    assertEquals(
      browserTitleMatch(left, right),
      serverTitleMatch(left, right),
      `${left} / ${right}`,
    );
  }
});
