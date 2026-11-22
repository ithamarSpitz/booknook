import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  authorAgreesWithWork,
  authorVariants,
} from "../../scripts/lib/rematch.ts";

Deno.test("rematch author agreement rejects an unrelated Latin author", () => {
  assertEquals(
    authorAgreesWithWork(
      "Dan O'Sullivan",
      ["Prince Harry", "J.R. Moehringer"],
      [],
    ),
    false,
  );
});

Deno.test("rematch author agreement accepts sound variants", () => {
  assert(authorAgreesWithWork("אמיל זולא (זולה)", ["Émile Zola"], []));
  assert(authorAgreesWithWork("סטיב טולץ", ["Steve Toltz"], []));
  assert(authorAgreesWithWork("לויס לורי", ["Lois Lowry"], []));
  assert(authorAgreesWithWork("ג'ני האן", ["Jenny Han"], []));
});

Deno.test("rematch author agreement accepts an authors-table name", () => {
  assert(
    authorAgreesWithWork(
      "סטפן (שטפן) צווייג (צוויג)",
      ["Stefan Zweig"],
      ["סטפן צוויג"],
    ),
  );
});

Deno.test("authorVariants removes or substitutes every parenthesized spelling", () => {
  const variants = authorVariants("תומאס (תומס) הארדי (הרדי)");
  assert(variants.includes("תומאס הארדי"));
  assert(variants.includes("תומס הרדי"));
});
