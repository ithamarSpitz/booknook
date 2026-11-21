import { assertEquals } from "jsr:@std/assert@1";
import { main, type RunDeps } from "../../scripts/authors-seed.ts";

function run(args: string[]) {
  const lines: string[] = [];
  let writes = 0;
  const deps: Partial<RunDeps> = {
    loadOperatorEnv: (() => ({})) as unknown as RunDeps["loadOperatorEnv"],
    openProdDb: (() => {
      // A tagged template that counts any statement (none expected in a dry run).
      const sql = Object.assign(() => (writes++, Promise.resolve([])), {
        end: () => Promise.resolve(),
      });
      return Promise.resolve(sql);
    }) as unknown as RunDeps["openProdDb"],
    loadPairs: () =>
      Promise.resolve([
        { he: "סטיבן קינג", en: "Stephen King" },
        { he: "ניל גיימן", en: "Neil Gaiman" },
        { he: "גדעון טיקוצקי", en: "Antoine de Saint-Exupéry" },
      ]),
    log: (m) => lines.push(m),
  };
  return { lines, writes: () => writes, go: () => main(args, deps) };
}

Deno.test("dry run counts stored and rejected pairs and writes nothing", async () => {
  const r = run([]);
  assertEquals(await r.go(), 0);
  assertEquals(JSON.parse(r.lines.at(-1)!), { pairs: 3, stored: 2, rejected: 1, authors: 2 });
  assertEquals(r.writes(), 0);
});

Deno.test("unknown argument exits 2", async () => {
  assertEquals(await run(["--nope"]).go(), 2);
});
