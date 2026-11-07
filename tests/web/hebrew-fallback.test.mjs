import assert from "node:assert/strict";
import test from "node:test";

import {
  authorAgrees,
  mainTitle,
  nameHits,
  soundAgrees,
  titleMatch,
} from "../../public/js/hebrew-fallback.js";

test("mainTitle removes edition labels and subtitles", () => {
  assert.equal(mainTitle("הימנון ללייבוביץ [מהדורת 2003]"), "הימנון ללייבוביץ");
  assert.equal(mainTitle("לקסיקון : כשמילים יכולות להרוג"), "לקסיקון");
});

test("titleMatch tolerates a small typo but rejects another title", () => {
  assert.equal(titleMatch("To hate Adam Conor", "To Hate Adam Connor"), true);
  assert.equal(titleMatch("Aurora", "Blackout"), false);
});

test("author agreement uses Hebrew names and cross-script sound", () => {
  assert.equal(authorAgrees("ו. א. שוואב", "ו.א. שוואב", "V. E. Schwab"), true);
  assert.equal(authorAgrees("מקס בארי", "מקס ברי", "Max Barry"), true);
  assert.equal(soundAgrees("וולטר מ. מילר הבן", "Walter M. Miller Jr."), true);
  assert.equal(soundAgrees("דיוויד קופ", "Kim Stanley Robinson"), false);
});

test("nameHits finds character names mentioned in a Hebrew description", () => {
  const description =
    "טרישה יוצאת למסע, ובדרך היא פוגשת את איתן. איש אינו מזכיר את הייל.";
  assert.deepEqual(nameHits(["Tricia", "Ethan", "Hale"], description), [
    "Tricia",
    "Ethan",
  ]);
});

test("nameHits keeps geresh-like marks inside Hebrew name tokens", () => {
  assert.deepEqual(
    nameHits(["Tricia", "Ethan"], "טרישה ואית׳ן, זוג צעיר"),
    ["Tricia", "Ethan"],
  );
});
