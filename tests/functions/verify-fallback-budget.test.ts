import { assertEquals } from "jsr:@std/assert@1";
import type { Sql } from "npm:postgres@3.4.5";
import { main } from "../../scripts/verify-fallback.ts";

Deno.test("verify-fallback population stops before the database when the Hardcover budget is low", async () => {
  let opened = false;
  const code = await main(["--population"], {
    checkHardcoverBudget: async () => false,
    openProdDb: async () => {
      opened = true;
      return { end: () => {} } as unknown as Sql;
    },
  });

  assertEquals(code, 4);
  assertEquals(opened, false);
});

Deno.test("verify-fallback compare never checks the Hardcover budget", async () => {
  let checked = false;
  const code = await main(["--compare"], {
    checkHardcoverBudget: async () => {
      checked = true;
      return true;
    },
  });

  assertEquals(code, 2);
  assertEquals(checked, false);
});
