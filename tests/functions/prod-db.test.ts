import { assertEquals, assertMatch, assertThrows } from "jsr:@std/assert@1";
import type { Sql } from "npm:postgres@3.4.5";
import {
  englishOnlyRecommendations,
  linkedEditionsWithWorks,
  loadOperatorEnv,
  readEnvFile,
  shelvedUnlinkedEditions,
} from "../../scripts/lib/prod-db.ts";

const EMBEDDED_ENV_FIXTURE = String.raw`
# ignored=value
PLAIN=value
DOUBLE="quoted value"
SINGLE='another value'
TOKEN=first=second=third
HARDCOVER_API_KEY="hardcover-secret"
TORIMITOR_DB_PASSWORD=db-secret
`;

async function withTempEnvFile(
  contents: string,
  readOnlyFallback: string,
  run: (path: string) => void | Promise<void>,
): Promise<void> {
  const permission = await Deno.permissions.query({ name: "write" });
  if (permission.state !== "granted") {
    await run(readOnlyFallback);
    return;
  }

  const path = await Deno.makeTempFile();
  try {
    await Deno.writeTextFile(path, contents);
    await run(path);
  } finally {
    await Deno.remove(path);
  }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) Deno.env.delete(key);
  else Deno.env.set(key, value);
}

Deno.test("readEnvFile strips quotes, ignores comments, and retains equals in values", async () => {
  await withTempEnvFile(
    [
      "# operator secrets",
      "",
      "PLAIN=value",
      'DOUBLE="quoted value"',
      "SINGLE='another value'",
      "TOKEN=first=second=third",
      "not an assignment",
    ].join("\n"),
    import.meta.filename!,
    (path) => {
      const values = readEnvFile(path);
      assertEquals(values.PLAIN, "value");
      assertEquals(values.DOUBLE, "quoted value");
      assertEquals(values.SINGLE, "another value");
      assertEquals(values.TOKEN, "first=second=third");
      assertEquals(values["# ignored"], undefined);
    },
  );
});

Deno.test("loadOperatorEnv fills a missing Hardcover key and returns the DB password", async () => {
  const oldEnvFile = Deno.env.get("BOOKNOOK_ENV_FILE");
  const oldHardcoverKey = Deno.env.get("HARDCOVER_API_KEY");
  try {
    await withTempEnvFile(
      'HARDCOVER_API_KEY="hardcover-secret"\nTORIMITOR_DB_PASSWORD=db-secret\n',
      import.meta.filename!,
      (path) => {
        Deno.env.set("BOOKNOOK_ENV_FILE", path);
        Deno.env.delete("HARDCOVER_API_KEY");

        assertEquals(loadOperatorEnv(), { dbPassword: "db-secret" });
        assertEquals(Deno.env.get("HARDCOVER_API_KEY"), "hardcover-secret");
      },
    );
  } finally {
    restoreEnv("BOOKNOOK_ENV_FILE", oldEnvFile);
    restoreEnv("HARDCOVER_API_KEY", oldHardcoverKey);
  }
});

Deno.test("loadOperatorEnv does not overwrite an existing Hardcover key", async () => {
  const oldEnvFile = Deno.env.get("BOOKNOOK_ENV_FILE");
  const oldHardcoverKey = Deno.env.get("HARDCOVER_API_KEY");
  try {
    await withTempEnvFile(
      "HARDCOVER_API_KEY=file-secret\nTORIMITOR_DB_PASSWORD=db-secret\n",
      import.meta.filename!,
      (path) => {
        Deno.env.set("BOOKNOOK_ENV_FILE", path);
        Deno.env.set("HARDCOVER_API_KEY", "existing-secret");

        assertEquals(loadOperatorEnv(), { dbPassword: "db-secret" });
        assertEquals(Deno.env.get("HARDCOVER_API_KEY"), "existing-secret");
      },
    );
  } finally {
    restoreEnv("BOOKNOOK_ENV_FILE", oldEnvFile);
    restoreEnv("HARDCOVER_API_KEY", oldHardcoverKey);
  }
});

Deno.test("loadOperatorEnv names a missing key without exposing file values", async () => {
  const oldEnvFile = Deno.env.get("BOOKNOOK_ENV_FILE");
  const oldHardcoverKey = Deno.env.get("HARDCOVER_API_KEY");
  try {
    await withTempEnvFile(
      "HARDCOVER_API_KEY=do-not-leak\nUNRELATED=also-secret\n",
      `${import.meta.dirname}/../../scripts/lib/prod-db.ts`,
      (path) => {
        Deno.env.set("BOOKNOOK_ENV_FILE", path);
        Deno.env.delete("HARDCOVER_API_KEY");

        const error = assertThrows(
          () => loadOperatorEnv(),
          Error,
          "TORIMITOR_DB_PASSWORD",
        );
        assertEquals(error.message.includes("do-not-leak"), false);
        assertEquals(error.message.includes("also-secret"), false);
      },
    );
  } finally {
    restoreEnv("BOOKNOOK_ENV_FILE", oldEnvFile);
    restoreEnv("HARDCOVER_API_KEY", oldHardcoverKey);
  }
});

void EMBEDDED_ENV_FIXTURE;

function recordingSql(statements: string[]): Sql {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push(
      strings.reduce(
        (text, part, index) => text + part + (index < values.length ? "?" : ""),
        "",
      ),
    );
    return Promise.resolve([]);
  };
  return sql as unknown as Sql;
}

Deno.test("query helpers each issue one statement against their required tables", async () => {
  const cases: Array<{
    run: (sql: Sql) => Promise<unknown>;
    tables: string[];
  }> = [
    {
      run: shelvedUnlinkedEditions,
      tables: ["editions", "shelf_books"],
    },
    {
      run: linkedEditionsWithWorks,
      tables: ["editions", "works"],
    },
    {
      run: englishOnlyRecommendations,
      tables: ["recommendations", "works", "profiles"],
    },
  ];

  for (const testCase of cases) {
    const statements: string[] = [];
    await testCase.run(recordingSql(statements));
    assertEquals(statements.length, 1);
    for (const table of testCase.tables) {
      assertMatch(statements[0], new RegExp(`\\b${table}\\b`, "i"));
    }
  }
});

Deno.test("linked editions query returns the current work id", async () => {
  const statements: string[] = [];
  await linkedEditionsWithWorks(recordingSql(statements));
  assertMatch(statements[0], /w\.id as work_id/i);
});
