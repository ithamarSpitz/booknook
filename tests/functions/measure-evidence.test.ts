import type { Sql } from "npm:postgres@3.4.5";
import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  classifyUnlinkedWork,
  type EditionWork,
  type InUseWork,
  main,
  type RunDeps,
  type UnlinkedEvidenceProviders,
} from "../../scripts/measure-links.ts";

const WORK = {
  id: "w1",
  original_title: "The Strange Case of Dr. Jekyll and Mr. Hyde",
  original_authors: ["Robert Louis Stevenson"],
};
const HE_AUTHOR = "רוברט לואיס סטיבנסון";
const book = (id: number, author = HE_AUTHOR) => ({
  id,
  title: `ספר ${id}`,
  author,
});

function fake(
  over: Partial<UnlinkedEvidenceProviders> = {},
): UnlinkedEvidenceProviders {
  return {
    hebrewAuthor: () => Promise.resolve(HE_AUTHOR),
    searchBooks: () => Promise.resolve([]),
    nliOriginal: () => Promise.resolve({ title: "Other Book" }),
    wikidataOriginal: () => Promise.resolve(null),
    wikidataWork: () => Promise.resolve(null),
    ...over,
  };
}

const cls = async (
  w: typeof WORK,
  p: UnlinkedEvidenceProviders,
  linked: ReadonlySet<number> = new Set(),
) => (await classifyUnlinkedWork(w, linked, p)).class;

Deno.test("every evidence class", async () => {
  assertEquals(
    await cls({ ...WORK, original_authors: [] }, fake()),
    "no_english_author",
  );
  assertEquals(
    await cls(WORK, fake({ hebrewAuthor: () => Promise.resolve(null) })),
    "no_hebrew_author",
  );
  assertEquals(await cls(WORK, fake()), "no_author_books");
  assertEquals(
    await cls(WORK, fake({ searchBooks: () => Promise.resolve([book(1)]) })),
    "catalog_checked",
  );
  assertEquals(
    await cls(
      WORK,
      fake({
        searchBooks: () => Promise.resolve([book(1)]),
        nliOriginal: () => Promise.resolve(null),
      }),
    ),
    "unbridged_books",
  );
  // Every page is full: the 300-book cap was reached.
  const full = Array.from({ length: 50 }, (_, i) => book(i + 1));
  assertEquals(
    await cls(WORK, fake({ searchBooks: () => Promise.resolve(full) })),
    "catalog_truncated",
  );
  assertEquals(
    await cls(
      WORK,
      fake({ hebrewAuthor: () => Promise.reject(new Error("down")) }),
    ),
    "failed",
  );
  assertEquals(
    await cls(
      WORK,
      fake({
        searchBooks: () => Promise.resolve([book(1)]),
        nliOriginal: () => Promise.resolve({ title: WORK.original_title }),
      }),
    ),
    "missed",
  );
});

function linkedTo(other: EditionWork | null) {
  return fake({
    wikidataWork: () => Promise.resolve({ id: "Q1", hebrewLabel: "ד״ר ג׳קיל" }),
    searchBooks: () => Promise.resolve([book(7)]),
    editionWork: () => Promise.resolve(other),
  });
}

Deno.test("duplicate_work versus linked_other_work", async () => {
  assertEquals(
    await cls(
      WORK,
      linkedTo({
        id: "2332122",
        original_title: "The Strange Case of Dr Jekyll and Mr Hyde",
        original_authors: ["Robert Louis Stevenson"],
      }),
    ),
    "duplicate_work",
  );
  assertEquals(
    await cls(
      WORK,
      linkedTo({
        id: "9",
        original_title: "Kidnapped",
        original_authors: ["Robert Louis Stevenson"],
      }),
    ),
    "linked_other_work",
  );
  assertEquals(
    await cls(
      WORK,
      linkedTo({
        id: "9",
        original_title: WORK.original_title,
        original_authors: ["Someone Else"],
      }),
    ),
    "linked_other_work",
  );
  assertEquals(await cls(WORK, linkedTo(null)), "missed");
});

function harness(works: InUseWork[], providers: UnlinkedEvidenceProviders) {
  const logs: string[] = [];
  const deps: Partial<RunDeps> = {
    openProdDb:
      (() => Promise.resolve({ end: () => {} } as unknown as Sql)) as RunDeps[
        "openProdDb"
      ],
    loadInUseWorks: () => Promise.resolve(works),
    loadAllWorks: () => Promise.resolve(works),
    loadLinkedSimaniaIds: () => Promise.resolve(new Set()),
    loadEditionWork: () => Promise.resolve(null),
    providers,
    log: (m) => logs.push(m),
    error: () => {},
  };
  return { deps, logs };
}

const mk = (i: number, authors = [`Author ${i}`]): InUseWork => ({
  id: String(i),
  original_title: `Title ${i}`,
  original_authors: authors,
  has_hebrew: false,
  simania_id: null,
});

Deno.test("label list holds only label-only works; strict rate arithmetic", async () => {
  // 1 label-only, 1 label+duplicate-free missed, 1 duplicate, 1 linked other,
  // 1 no_hebrew_author, 1 no_english_author, 1 fine catalog_checked.
  const RLS = ["Robert Louis Stevenson"];
  const works = [
    mk(1, RLS),
    mk(2, RLS),
    mk(3, RLS),
    mk(4, RLS),
    mk(5, ["Nobody Known"]),
    mk(6, []),
    mk(7, RLS),
    mk(8, RLS),
  ];
  const labels: Record<string, string> = {
    "Title 1": "תווית אחת",
    "Title 2": "תווית שתיים",
    "Title 3": "תווית שלוש",
    "Title 4": "תווית ארבע",
  };
  const h = harness(
    works,
    fake({
      hebrewAuthor: (a) =>
        Promise.resolve(a === "Nobody Known" ? null : HE_AUTHOR),
      searchBooks: (q) => {
        if (q.includes("תווית")) {
          const n = ["אחת", "שתיים", "שלוש", "ארבע"].findIndex((w) =>
            q.endsWith(w)
          );
          // Title 1 stays unconfirmed (wrong author); the others agree.
          return Promise.resolve([
            book(10 + n, n === 0 ? "עמוס עוז" : HE_AUTHOR),
          ]);
        }
        return Promise.resolve([]);
      },
      wikidataWork: (w) =>
        Promise.resolve(
          labels[w.original_title]
            ? { id: "Q", hebrewLabel: labels[w.original_title] }
            : null,
        ),
      editionWork: (id) =>
        Promise.resolve(
          id === 12
            ? {
              id: "x",
              original_title: "Title 3",
              original_authors: ["Robert Louis Stevenson"],
            }
            : id === 13
            ? {
              id: "y",
              original_title: "Other",
              original_authors: ["Robert Louis Stevenson"],
            }
            : null,
        ),
    }),
  );
  assertEquals(await main(["--all"], h.deps), 0);
  const out = JSON.parse(h.logs[0]);
  assertEquals(out.hebrew_label_titles, ["תווית אחת"]);
  assertEquals(out.hebrew_label_unconfirmed, 1);
  assertEquals(out.duplicate_titles, ["Title 3"]);
  assertEquals(out.linked_other_titles, ["Title 4"]);
  assertEquals(out.missed_titles, ["Title 2"]);
  assertEquals(out.missed, 2); // Title 2 + duplicate
  assertEquals(out.no_hebrew_author, 1);
  assertEquals(out.no_english_author, 1);
  assertEquals(out.no_author_books, 2); // works 7 and 8
  assertEquals(out.failed, 0);
  assertEquals(out.missed_rate_low, 0.25);
  assertEquals(out.missed_rate_high, 0.375);
  // (2 missed + 1 label + 0 failed + 1 linked_other + 1 no_hebrew_author
  //  + 2 no_author_books) / 8
  assertEquals(out.missed_rate_strict_high, 0.875);
  assertEquals(out.rechecked, 0);
});

Deno.test("a failed work is rechecked once and ends in its real class", async () => {
  let calls = 0;
  const h = harness(
    [mk(1)],
    fake({
      hebrewAuthor: () =>
        ++calls === 1
          ? Promise.reject(new Error("blip"))
          : Promise.resolve("he-Author 1"),
    }),
  );
  assertEquals(await main([], h.deps), 0);
  const out = JSON.parse(h.logs[0]);
  assertEquals(out.rechecked, 1);
  assertEquals(out.failed, 0);
  assertEquals(out.no_author_books, 1);
  assertEquals(calls, 2);
});
