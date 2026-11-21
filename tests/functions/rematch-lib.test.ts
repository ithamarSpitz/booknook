import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  authorNamesFromLinks,
  confirmCandidate,
  findCandidates,
  type RematchDeps,
  type RematchWork,
  titleMatches,
} from "../../scripts/lib/rematch.ts";
import type { HardcoverBook } from "../../supabase/functions/_shared/hardcover.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";

const work = (title: string, author: string, hardcover_id = 1): RematchWork => ({
  id: "w1",
  hardcover_id,
  original_title: title,
  original_authors: [author],
});

function deps(over: Partial<RematchDeps> = {}): RematchDeps {
  return {
    hebrewHint: () => Promise.resolve(null),
    matchHebrewBook: () => Promise.resolve(null),
    hebrewNames: () => Promise.resolve([]),
    searchBooks: () => Promise.resolve([]),
    originals: () => Promise.resolve([]),
    linkedSimaniaIds: new Set(),
    ...over,
  };
}

Deno.test("authorNamesFromLinks drops translators and mix-ups", () => {
  const map = authorNamesFromLinks([
    { he: "אליס פיני", en: "Alice Feeney" },
    { he: "הולי ג'קסון", en: "Alice Feeney" },
    { he: "גדעון טיקוצקי", en: "Antoine de Saint-Exupéry" },
    { he: "וולי למב", en: "Wally Lamb" },
  ]);
  assertEquals(map.get("alice feeney"), ["אליס פיני"]);
  assertEquals(map.get("wally lamb"), ["וולי למב"]);
  assertEquals(map.size, 2);
});

Deno.test("titleMatches", () => {
  assert(titleMatches("Insomnia", "Insomnia"));
  assert(titleMatches("The Lathe of Heaven", "Lathe of Heaven"));
  assert(!titleMatches("Home", "Homegoing"));
});

Deno.test("forward candidate skips search", async () => {
  let searched = 0;
  const result = await findCandidates(
    work("Thinner", "Stephen King"),
    deps({
      hebrewHint: () => Promise.resolve({ title: "רזה" }),
      matchHebrewBook: () => Promise.resolve(3191),
      searchBooks: () => {
        searched++;
        return Promise.resolve([]);
      },
    }),
  );
  assertEquals(result, {
    candidates: [{ simania_id: 3191, via: "forward" }],
    failed: false,
  });
  assertEquals(searched, 0);
});

Deno.test("reverse search pages and skips linked ids", async () => {
  const offsets: number[] = [];
  const filler = Array.from({ length: 50 }, (_, i) => ({
    id: 1000 + i,
    title: i === 0 ? "ספר אחר" : "x",
    author: "סטיבן קינג",
  }));
  const result = await findCandidates(
    work("Insomnia", "Stephen King"),
    deps({
      hebrewNames: () => Promise.resolve(["סטיבן קינג"]),
      searchBooks: (_q, _l, offset) => {
        offsets.push(offset);
        return Promise.resolve(
          offset === 0 ? filler : [
            { id: 77, title: "נדודי שינה", author: "סטיבן קינג" },
            { id: 78, title: "נדודי שינה", author: "סטיבן קינג" },
            { id: 79, title: "נדודי שינה", author: "מישהו אחר לגמרי" },
          ],
        );
      },
      originals: (title) =>
        Promise.resolve(title === "נדודי שינה" ? ["Insomnia"] : []),
      linkedSimaniaIds: new Set([78]),
    }),
  );
  assertEquals(result, {
    candidates: [{ simania_id: 77, via: "reverse" }],
    failed: false,
  });
  assertEquals(offsets, [0, 50]);
});

Deno.test("originals throwing sets failed", async () => {
  const result = await findCandidates(
    work("Insomnia", "Stephen King"),
    deps({
      hebrewNames: () => Promise.resolve(["סטיבן קינג"]),
      searchBooks: () =>
        Promise.resolve([{ id: 5, title: "נדודי שינה", author: "סטיבן קינג" }]),
      originals: () => Promise.reject(new Error("boom")),
    }),
  );
  assertEquals(result.failed, true);
  assertEquals(result.candidates, []);
});

const edition = { simania_id: 108889, title: "ארץ אחרת- 4 כרכים" } as EditionRow;
const hc = (id: number, title: string, author: string): HardcoverBook => ({
  id,
  title,
  cached_contributors: [{ author: { name: author } }],
});

Deno.test("confirmCandidate", async () => {
  const w = work("Another Country", "James Baldwin", 10);
  const found = (book: HardcoverBook) =>
    Promise.resolve({ found: { book, status: "wikidata" as const }, failed: false });

  assertEquals(
    (await confirmCandidate(w, edition, {
      resolveMatch: () => found(hc(10, "Another Country", "James Baldwin")),
    })).accepted,
    true,
  );
  const dup = await confirmCandidate(w, edition, {
    resolveMatch: () =>
      found(hc(11, "Another Country: A Novel", "James Baldwin")),
  });
  assertEquals(dup.accepted, true);
  assertEquals(dup.status, "wikidata");
  assertEquals(
    (await confirmCandidate(w, edition, {
      resolveMatch: () => found(hc(12, "Another Country", "Tad Williams")),
    })).accepted,
    false,
  );
  const none = await confirmCandidate(w, edition, {
    resolveMatch: () => Promise.resolve({ found: null, failed: true }),
  });
  assertEquals(none, { accepted: false, status: null, book: null, failed: true });
});
