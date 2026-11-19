import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  type AuthorAuditRow,
  buildAuditOutput,
  filterRejectedAuthorRows,
} from "../../scripts/audit-authors.ts";

const rows: AuthorAuditRow[] = [
  {
    simania_id: 2970,
    title: "מגרש השדים",
    author: "וויליאם פיטר בלאטי",
    resolve_status: "wikidata",
    hardcover_id: 1,
    original_title: "Blue Exorcist",
    original_authors: ["Kazue Kato"],
  },
  {
    simania_id: 2,
    title: "כותרת",
    author: "ג'ו היל",
    resolve_status: "nli_author",
    hardcover_id: 2,
    original_title: "Title",
    original_authors: ["Joe Hill"],
  },
  {
    simania_id: 3,
    title: "Another",
    author: "Latin Author",
    resolve_status: "original_title",
    hardcover_id: 3,
    original_title: "Another",
    original_authors: ["Different Author"],
  },
];

Deno.test("author audit row filter keeps only rows the guard rejects", () => {
  assertEquals(
    filterRejectedAuthorRows(rows).map((row) => row.simania_id),
    [2970],
  );
});

Deno.test("author audit output contains findings, scores, and totals", () => {
  const output = buildAuditOutput(
    rows,
    (author) => author === "וויליאם פיטר בלאטי" ? 0.125 : 0.8,
  );

  assertEquals(output, {
    lines: [{ ...rows[0], name_sound_score: 0.125 }],
    totals: { checked: 3, rejected: 1 },
  });
});
