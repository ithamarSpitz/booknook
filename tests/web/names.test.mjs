import assert from "node:assert/strict";
import test from "node:test";

import { nameSoundScore } from "../../public/js/names.js";

const SAME_PERSON = [
  ["ג'ו היל", "Joe Hill"],
  ["ג'וג'ו מויס", "Jojo Moyes"],
  ["רוברט מ. פירסיג", "Robert M. Pirsig"],
  ["רואלד דאל", "Roald Dahl"],
  ["אלדוס האקסלי", "Aldous Huxley"],
  ["פאולו קואלו", "Paulo Coelho"],
  ["אן פאצ'ט", "Ann Patchett"],
  ["צ'אק פלאניוק", "Chuck Palahniuk"],
  ["ג'ורג' אורוול", "George Orwell"],
  ["הרוקי מורקמי", "Haruki Murakami"],
  ["אליסון נואל", "Alyson Noël"],
  ["ניקולה יון", "Nicola Yoon"],
];

const DIFFERENT_PERSON = [
  ["וויליאם פיטר בלאטי", "Kazue Kato"],
  ["מילן קונדרה", "Louis Sachar"],
  ["ד'ר ד.אשבל", "David Mitchell"],
  ["ליאת רוטנר", "Fanny Blake"],
  ["אריקה לאונרד ג'יימס", "Jasper Fforde"],
  ["אשכר ארבליך-בריפמן", "Boualem Sansal"],
  ["ג'קלין ווילסטון", "Pedro Mañas"],
];

for (const [hebrew, latin] of SAME_PERSON) {
  test(`S21 same person scores at least 0.6: ${latin}`, () => {
    const score = nameSoundScore(hebrew, [latin]);
    assert.ok(score >= 0.6, `${hebrew} / ${latin} scored ${score}`);
  });
}

for (const [hebrew, latin] of DIFFERENT_PERSON) {
  test(`S21 different person scores at most 0.3: ${latin}`, () => {
    const score = nameSoundScore(hebrew, [latin]);
    assert.ok(score <= 0.3, `${hebrew} / ${latin} scored ${score}`);
  });
}
