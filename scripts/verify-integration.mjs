import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Simania blocks data-center IPs, so the app calls it from the browser; the gate
// uses the same browser modules from this machine.
import { fetchSimaniaPayload, searchBooks } from "../public/js/simania.js";
import { localizeRecommendations, recommendationFromApiCard } from "../public/js/recs.js";

const ROOT = process.cwd();
const REQUEST_TIMEOUT = 30_000;
const FUNCTION_TIMEOUT = 5 * 60_000;
const SERVER_TIMEOUT = 90_000;
const TRANSIENT_RETRIES = 1;

let server = null;
let serverOutput = "";
const serverProcessIds = new Set();
const createdUsers = [];
let cleanupStarted = false;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseStatusEnvironment(output) {
  const environment = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(?:"([\s\S]*)"|(.*))$/);
    if (match) environment[match[1]] = match[2] ?? match[3] ?? "";
  }
  for (const key of ["API_URL", "ANON_KEY", "SERVICE_ROLE_KEY"]) {
    assert(environment[key], `supabase status did not return ${key}.`);
  }
  return environment;
}

function localEnvironment() {
  const result = spawnSync(
    "npx",
    ["supabase", "status", "-o", "env"],
    {
      cwd: ROOT,
      encoding: "utf8",
      shell: process.platform === "win32",
      windowsHide: true,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Could not read the local Supabase environment:\n${
        result.stderr || result.stdout || result.error?.message ||
        "unknown error"
      }`,
    );
  }
  return parseStatusEnvironment(result.stdout);
}

function retainServerOutput(chunk) {
  serverOutput = `${serverOutput}${chunk}`.slice(-20_000);
}

function functionServerEnvironment() {
  if (process.env.TORIMITOR_ENV_FILE) return process.env;
  const commonDirectory = spawnSync(
    "git",
    ["rev-parse", "--git-common-dir"],
    {
      cwd: ROOT,
      encoding: "utf8",
      shell: process.platform === "win32",
      windowsHide: true,
    },
  );
  if (commonDirectory.status !== 0) return process.env;
  const commonDirectoryPath = resolve(ROOT, commonDirectory.stdout.trim());
  const envFile = resolve(
    dirname(commonDirectoryPath),
    "..",
    "book-discovery-plan",
    ".env.local",
  );
  return existsSync(envFile)
    ? { ...process.env, TORIMITOR_ENV_FILE: envFile }
    : process.env;
}

function startFunctionServer() {
  server = spawn("npm", [
    "run",
    "functions:serve",
    "--",
    "add-book",
    "book-details",
    "link-edition",
    "recommendations",
  ], {
    cwd: ROOT,
    env: functionServerEnvironment(),
    shell: process.platform === "win32",
    // Own process group, so stopFunctionServer reaches the server under npm.
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  server.stdout.on("data", (chunk) => retainServerOutput(chunk.toString()));
  server.stderr.on("data", (chunk) => retainServerOutput(chunk.toString()));
  server.on(
    "error",
    (error) => retainServerOutput(`\n${error.stack ?? error}`),
  );
  serverProcessIds.add(server.pid);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForFunctionServer(environment) {
  const deadline = Date.now() + SERVER_TIMEOUT;
  const url = `${environment.API_URL}/functions/v1/add-book`;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `Function server exited with code ${server.exitCode}.\n${serverOutput}`,
      );
    }
    if (!serverOutput.includes("Serving functions on")) {
      await delay(100);
      continue;
    }
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          apikey: environment.ANON_KEY,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.status === 401) {
        if (process.platform === "win32") {
          try {
            rememberWindowsProcessTree();
          } catch (error) {
            retainServerOutput(
              `\nCould not snapshot the Windows process tree: ${error.message}`,
            );
          }
        }
        return;
      }
    } catch {
      // The gateway is expected to refuse connections until the server is ready.
    }
    await delay(750);
  }
  throw new Error(`Function server did not become ready.\n${serverOutput}`);
}

async function stopFunctionServer() {
  if (!server) return;
  if (process.platform !== "win32") {
    if (!processGroupAlive()) return;
    killGroup("SIGTERM");
    let deadline = Date.now() + 5_000;
    while (processGroupAlive() && Date.now() < deadline) await delay(50);
    if (processGroupAlive()) {
      killGroup("SIGKILL");
      deadline = Date.now() + 5_000;
      while (processGroupAlive() && Date.now() < deadline) await delay(50);
    }
    if (processGroupAlive()) {
      throw new Error(`Function server process group ${server.pid} is still running.`);
    }
    return;
  }
  let inventoryError = null;
  try {
    rememberWindowsProcessTree();
  } catch (error) {
    inventoryError = error;
  }
  const taskkill = spawnSync("taskkill", [
    "/PID",
    String(server.pid),
    "/T",
    "/F",
  ], {
    stdio: "ignore",
    windowsHide: true,
  });
  if (inventoryError) {
    if (server.exitCode === null) server.kill("SIGKILL");
    throw new Error(
      `Could not verify Windows function-server shutdown: ${inventoryError.message}`,
    );
  }

  let alive = await waitForWindowsProcessesToExit(serverProcessIds, 5_000);
  if (alive.length) {
    server.kill("SIGKILL");
    for (const pid of alive) {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    }
    alive = await waitForWindowsProcessesToExit(serverProcessIds, 5_000);
  }
  if (alive.length) {
    throw new Error(
      `Function server processes are still running: ${alive.join(", ")}. ` +
        `Initial taskkill status: ${taskkill.status ?? "unknown"}.`,
    );
  }
}

function windowsProcessSnapshot() {
  const result = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-CimInstance Win32_Process | " +
    "Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress",
  ], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() || result.error?.message ||
        `PowerShell exited with status ${result.status}`,
    );
  }
  const parsed = JSON.parse(result.stdout);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return new Map(rows.map((row) => [
    Number(row.ProcessId),
    Number(row.ParentProcessId),
  ]));
}

function rememberWindowsProcessTree() {
  const snapshot = windowsProcessSnapshot();
  let added = true;
  while (added) {
    added = false;
    for (const [pid, parentPid] of snapshot) {
      if (serverProcessIds.has(parentPid) && !serverProcessIds.has(pid)) {
        serverProcessIds.add(pid);
        added = true;
      }
    }
  }
}

async function waitForWindowsProcessesToExit(processIds, timeout) {
  const deadline = Date.now() + timeout;
  let alive = [];
  do {
    const snapshot = windowsProcessSnapshot();
    alive = [...processIds].filter((pid) => snapshot.has(pid));
    if (!alive.length) return alive;
    await delay(200);
  } while (Date.now() < deadline);
  return alive;
}

function processGroupAlive() {
  try {
    process.kill(-server.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killGroup(signal) {
  try {
    process.kill(-server.pid, signal);
  } catch {
    server.kill(signal);
  }
}

async function request(environment, path, {
  method = "GET",
  token = environment.SERVICE_ROLE_KEY,
  body,
  headers = {},
  timeout = REQUEST_TIMEOUT,
  allow = [],
} = {}) {
  const response = await fetch(`${environment.API_URL}${path}`, {
    method,
    headers: {
      apikey: environment.ANON_KEY,
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok && !allow.includes(response.status)) {
    const detail = typeof data === "string" ? data : JSON.stringify(data);
    const error = new Error(
      `${method} ${path} returned ${response.status}: ${detail}`,
    );
    error.status = response.status;
    throw error;
  }
  return { response, data };
}

async function createUser(environment, label) {
  const nonce = `${Date.now()}-${crypto.randomUUID()}`;
  const email = `integration-${label}-${nonce}@torimitor.invalid`;
  const password = `Gate-${crypto.randomUUID()}-aA1!`;
  const trackedUser = { email, id: null };
  createdUsers.push(trackedUser);
  const created = await request(environment, "/auth/v1/admin/users", {
    method: "POST",
    body: { email, password, email_confirm: true },
  });
  assert(created.data?.id, `Admin API did not return an ID for user ${label}.`);
  trackedUser.id = created.data.id;
  const session = await request(
    environment,
    "/auth/v1/token?grant_type=password",
    {
      method: "POST",
      token: environment.ANON_KEY,
      body: { email, password },
    },
  );
  assert(session.data?.access_token, `Could not sign in user ${label}.`);
  return { id: created.data.id, token: session.data.access_token };
}

async function loadRowsByValues(environment, table, column, values) {
  const unique = [...new Set(values)].filter((value) => value != null);
  const rows = [];
  for (let index = 0; index < unique.length; index += 50) {
    const part = unique.slice(index, index + 50);
    const params = new URLSearchParams({
      select: "*",
      [column]: `in.(${part.join(",")})`,
    });
    rows.push(...await restForUser(
      environment,
      `${table}?${params}`,
      environment.SERVICE_ROLE_KEY,
    ));
  }
  return rows;
}

async function functionCall(environment, name, token, body) {
  for (let attempt = 0;; attempt++) {
    try {
      const result = await request(environment, `/functions/v1/${name}`, {
        method: "POST",
        token,
        body,
        timeout: FUNCTION_TIMEOUT,
      });
      return result.data;
    } catch (error) {
      if (
        attempt >= TRANSIENT_RETRIES ||
        ![500, 502].includes(error?.status)
      ) {
        throw error;
      }
      await delay(750);
    }
  }
}

export async function cleanupResources({
  stopServer,
  users,
  resolveUserId,
  deleteUser,
}) {
  const errors = [];
  try {
    await stopServer();
  } catch (error) {
    errors.push(`stop function server: ${error.message}`);
  }
  for (const user of [...users].reverse()) {
    let id = user.id;
    if (!id) {
      try {
        id = await resolveUserId(user.email);
      } catch (error) {
        errors.push(`find user ${user.email}: ${error.message}`);
        continue;
      }
    }
    if (!id) continue;
    try {
      await deleteUser(id);
    } catch (error) {
      errors.push(`delete user ${id}: ${error.message}`);
    }
  }
  return errors;
}

async function findUserIdByEmail(environment, email) {
  const perPage = 1_000;
  for (let page = 1; page <= 100; page++) {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
    });
    const result = await request(
      environment,
      `/auth/v1/admin/users?${params}`,
    );
    const users = result.data?.users;
    assert(Array.isArray(users), "Admin API did not return a user list.");
    const match = users.find((user) => user?.email === email);
    if (match?.id) return match.id;
    if (!users.length) return null;
  }
  throw new Error("Admin user search exceeded 100 pages.");
}

async function cleanup(environment) {
  if (cleanupStarted) return [];
  cleanupStarted = true;
  // Every step runs even if an earlier one fails. Deleting a user cascades to
  // its profile, shelves, shelf books and recommendations. Catalog rows (works,
  // editions, search_cache) are a shared cache and are left as they are.
  return cleanupResources({
    stopServer: stopFunctionServer,
    users: createdUsers,
    resolveUserId: (email) => findUserIdByEmail(environment, email),
    deleteUser: async (id) => {
      await request(environment, `/auth/v1/admin/users/${id}`, {
        method: "DELETE",
        allow: [404],
      });
    },
  });
}

function normalized(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function chooseSearchResult(query, authorHint, books, usedIds) {
  const wanted = normalized(query);
  const wantedAuthor = normalized(authorHint);
  return books.map((book, index) => {
    const id = Number(book.id ?? book.bookId);
    const title = normalized(book.title);
    const author = normalized(book.author);
    const titleScore = title === wanted ? 2 : title.includes(wanted) ? 1 : 0;
    const authorScore = wantedAuthor && author.includes(wantedAuthor) ? 4 : 0;
    const score = titleScore ? titleScore + authorScore : 0;
    return { book, id, score, index };
  }).filter(({ id, score }) =>
    score > 0 && Number.isSafeInteger(id) && id > 0 && !usedIds.has(id)
  )
    .sort((left, right) =>
      right.score - left.score || left.index - right.index
    )[0];
}

async function restForUser(environment, path, token, options = {}) {
  return (await request(environment, `/rest/v1/${path}`, { ...options, token }))
    .data;
}

async function runGate(environment) {
  const userA = await createUser(environment, "a");
  const userB = await createUser(environment, "b");

  const shelves = await restForUser(
    environment,
    "shelves?select=id,name,kind,position&order=position.asc",
    userA.token,
  );
  const expectedShelves = [
    ["reading", "קורא עכשיו"],
    ["read", "קראתי"],
    ["want", "רוצה לקרוא"],
    ["stopped", "הפסקתי"],
  ];
  assert(
    shelves.length === 4,
    `Expected 4 default shelves; received ${shelves.length}.`,
  );
  expectedShelves.forEach(([kind, name], position) => {
    const shelf = shelves[position];
    assert(
      shelf?.kind === kind && shelf?.name === name &&
        shelf?.position === position,
      `Default shelf ${position} does not match ${name}/${kind}.`,
    );
  });
  const readShelf = shelves.find((shelf) => shelf.kind === "read");
  const readingShelf = shelves.find((shelf) => shelf.kind === "reading");

  const booksToAdd = [
    { query: "הנסיך הקטן", author: "אנטואן" },
    { query: "1984", author: "אורוול" },
    { query: "הארי פוטר ואבן החכמים", author: "רולינג" },
    { query: "חוות החיות", author: "אורוול" },
  ];
  const usedIds = new Set();
  const added = [];
  for (const { query, author } of booksToAdd) {
    const search = { books: await searchBooks(query) };
    if (query === booksToAdd[0].query) {
      assert(
        search.books.length > 0,
        `Simania search returned no results for ${query}.`,
      );
    }
    const selected = chooseSearchResult(query, author, search.books, usedIds);
    assert(selected, `Could not choose a unique Simania result for ${query}.`);
    usedIds.add(selected.id);
    const result = await functionCall(environment, "add-book", userA.token, {
      simania_id: selected.id,
      shelf_id: readShelf.id,
      simania: await fetchSimaniaPayload(selected.id),
    });
    assert(
      result?.book?.simania_id === selected.id,
      `add-book returned the wrong edition for ${query}.`,
    );
    assert(
      result.book.shelf_id === readShelf.id,
      `add-book did not persist ${query} on the read shelf.`,
    );
    added.push(result.book);
  }

  const resolved = added.filter((book) => typeof book.work_id === "string");
  assert(
    resolved.length >= 3,
    `Expected at least 3 resolved works; received ${resolved.length}: ` +
      added.map((b) => `${b.title} (${b.simania_id}) ${b.resolve_status}`).join("; "),
  );

  const moved = added[0];
  await restForUser(environment, "rpc/move_book", userA.token, {
    method: "POST",
    body: {
      p_simania_id: moved.simania_id,
      p_to_shelf: readingShelf.id,
      p_to_position: 0,
    },
  });
  const movedRows = await restForUser(
    environment,
    `shelf_books?select=shelf_id,position&simania_id=eq.${moved.simania_id}`,
    userA.token,
  );
  assert(
    movedRows.length === 1 && movedRows[0].shelf_id === readingShelf.id &&
      movedRows[0].position === 0,
    "move_book did not persist the new shelf and position.",
  );

  const firstRecommendations = await functionCall(
    environment,
    "recommendations",
    userA.token,
    {},
  );
  assert(
    Array.isArray(firstRecommendations?.recommendations),
    "recommendations returned an invalid response.",
  );
  assert(
    firstRecommendations.recommendations.length >= 5,
    `Expected at least 5 recommendations; received ${firstRecommendations.recommendations.length}.`,
  );
  // Browser-side localization: match hints in Simania, link through link-edition.
  const cards = firstRecommendations.recommendations.map(recommendationFromApiCard);
  const linked = [];
  await localizeRecommendations(cards, {
    callFunction: (name, body) => functionCall(environment, name, userA.token, body),
    isCurrent: () => true,
    onLinked: (workId, patch) => linked.push({ workId, ...patch }),
  });
  console.log(
    `Localized ${linked.length} of ${cards.filter((card) => card.hebrew_hint).length} hinted English-only recommendations in the browser path.`,
  );
  if (linked.length) {
    const linkedEditions = await loadRowsByValues(
      environment,
      "editions",
      "simania_id",
      linked.map((item) => item.simania_id),
    );
    for (const item of linked) {
      assert(
        linkedEditions.some((edition) =>
          edition.simania_id === item.simania_id && edition.work_id === item.workId
        ),
        `link-edition stored ${item.simania_id} without linking it to its work.`,
      );
    }
  }

  const currentShelfBooks = await restForUser(
    environment,
    "shelf_books?select=simania_id",
    userA.token,
  );
  const currentShelvedEditions = await loadRowsByValues(
    environment,
    "editions",
    "simania_id",
    currentShelfBooks.map((book) => book.simania_id),
  );
  const shelvedWorkIds = new Set(
    currentShelvedEditions.map((edition) => edition.work_id).filter(Boolean),
  );
  assert(
    firstRecommendations.recommendations.every((item) =>
      !shelvedWorkIds.has(item.work_id)
    ),
    "recommendations returned a work that is already shelved.",
  );

  const dismissed = firstRecommendations.recommendations[0];
  const dismissParams = new URLSearchParams({
    user_id: `eq.${userA.id}`,
    work_id: `eq.${dismissed.work_id}`,
  });
  await restForUser(
    environment,
    `recommendations?${dismissParams}`,
    userA.token,
    {
      method: "PATCH",
      body: { dismissed: true },
      headers: { Prefer: "return=representation" },
    },
  );
  const secondRecommendations = await functionCall(
    environment,
    "recommendations",
    userA.token,
    {},
  );
  assert(
    Array.isArray(secondRecommendations?.recommendations),
    "recommendations returned an invalid response after dismissal.",
  );
  assert(
    !secondRecommendations.recommendations.some((item) =>
      item.work_id === dismissed.work_id
    ),
    "A dismissed recommendation returned on the next generation.",
  );

  const privacyParams = new URLSearchParams({
    select: "id,user_id",
    user_id: `eq.${userA.id}`,
  });
  const leaked = await restForUser(
    environment,
    `shelves?${privacyParams}`,
    userB.token,
  );
  assert(
    leaked.length === 0,
    "User B could read user A's shelves through REST.",
  );
}

function runIntegrationTests() {
  const cleanupTests = spawnSync(
    process.execPath,
    ["--test", "tests/integration/cleanup.test.mjs"],
    { cwd: ROOT, stdio: "inherit", windowsHide: true },
  );
  if (cleanupTests.status !== 0) {
    throw new Error(
      `Integration cleanup tests failed with status ${
        cleanupTests.status ?? "unknown"
      }.`,
    );
  }

  const linkRaceTests = spawnSync(
    "npx",
    [
      "deno",
      "test",
      "--allow-env",
      "--allow-read",
      "tests/integration/link-edition-race.test.ts",
    ],
    {
      cwd: ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
      windowsHide: true,
    },
  );
  if (linkRaceTests.status !== 0) {
    throw new Error(
      `Integration link-edition race tests failed with status ${
        linkRaceTests.status ?? "unknown"
      }.`,
    );
  }
}

async function main() {
  runIntegrationTests();
  const environment = localEnvironment();
  let failure = null;
  try {
    startFunctionServer();
    await waitForFunctionServer(environment);
    await runGate(environment);
  } catch (error) {
    failure = error;
  } finally {
    const cleanupErrors = await cleanup(environment);
    if (cleanupErrors.length) {
      const cleanupMessage = `Cleanup failed:\n- ${cleanupErrors.join("\n- ")}`;
      failure = failure
        ? new Error(`${failure.message}\n${cleanupMessage}`)
        : new Error(cleanupMessage);
    }
  }
  if (failure) throw failure;
  console.log(
    "Integration gate passed; throwaway users (with their shelves and recommendations) and the function server were cleaned up.",
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Integration gate failed: ${error.stack ?? error}`);
    process.exitCode = 1;
  });
}
