import { assertEquals } from "jsr:@std/assert@1";
import { nliEnglishMismatch } from "../../scripts/lib/nli-english-mismatch.ts";

const wrongLinks = [
  ["Dune: The Graphic Novel, Book 1", "Battle of Corrin"],
  ["28 Summers", "Summer of '69"],
] as const;

const correctLinks = [
  ["The Last Olympian", "Percy Jackson and the Last Olympian"],
  ["Moon Sister", "Moon sisters"],
  ["The Name of the Rose", "Nome della rosa"],
  ["The Package", "Das Paket"],
  ["Us Against You", "Vi Mot Er"],
  ["The Mysterious Affair at Styles", "Murder"],
  ["Daughter of Fortune", "Roxana"],
  ["On Love and Death", "Über Liebe und Tod"],
  ["Heaven", "Then came heaven"],
] as const;

for (const [workTitle, nliTitle] of wrongLinks) {
  Deno.test(`rejects ${workTitle} / ${nliTitle}`, () => {
    assertEquals(nliEnglishMismatch(workTitle, nliTitle), true);
  });
}

for (const [workTitle, nliTitle] of correctLinks) {
  Deno.test(`keeps ${workTitle} / ${nliTitle}`, () => {
    assertEquals(nliEnglishMismatch(workTitle, nliTitle), false);
  });
}
