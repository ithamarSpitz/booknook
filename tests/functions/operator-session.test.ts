import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  callAs,
  listReaders,
  type ProjectKeys,
  projectKeys,
  readerToken,
} from "../../scripts/lib/operator-session.ts";

const keys: ProjectKeys = {
  url: "https://example.supabase.co",
  anonKey: "anon-secret",
  serviceKey: "service-secret",
};

Deno.test("projectKeys parses CLI JSON without invoking the real CLI", async () => {
  let calls = 0;
  const result = await projectKeys(async () => {
    calls++;
    return {
      success: true,
      stdout: JSON.stringify([
        { name: "anon", api_key: "A" },
        { name: "service_role", api_key: "S" },
      ]),
    };
  });

  assertEquals(calls, 1);
  assertEquals(result, {
    url: "https://zheosjpootcwvuazwjzh.supabase.co",
    anonKey: "A",
    serviceKey: "S",
  });
});

Deno.test("projectKeys reports a missing service key without exposing another key", async () => {
  const error = await assertRejects(
    () =>
      projectKeys(async () => ({
        success: true,
        stdout: JSON.stringify([{ name: "anon", api_key: "A" }]),
      })),
    Error,
    "service-role",
  );
  assertEquals(error.message.includes("A"), false);
});

Deno.test("listReaders uses the service key and sorts readers by email", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    assertEquals(
      String(input),
      `${keys.url}/auth/v1/admin/users?page=1&per_page=1000`,
    );
    assertEquals(init?.method, "GET");
    const headers = new Headers(init?.headers);
    assertEquals(headers.get("apikey"), keys.serviceKey);
    assertEquals(headers.get("authorization"), `Bearer ${keys.serviceKey}`);
    return Response.json({
      users: [
        { id: "2", email: "z@example.com" },
        { id: "1", email: "a@example.com" },
      ],
    });
  };

  assertEquals(await listReaders(keys, fetchImpl), [
    { id: "1", email: "a@example.com" },
    { id: "2", email: "z@example.com" },
  ]);
});

Deno.test("listReaders follows pagination and sorts all readers", async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (urls.length === 1) {
      return Response.json(
        { users: [{ id: "2", email: "z@example.com" }] },
        {
          headers: {
            link:
              `<${keys.url}/auth/v1/admin/users?page=2&per_page=1000>; rel="next"`,
          },
        },
      );
    }
    return Response.json({
      users: [{ id: "1", email: "a@example.com" }],
    });
  };

  assertEquals(await listReaders(keys, fetchImpl), [
    { id: "1", email: "a@example.com" },
    { id: "2", email: "z@example.com" },
  ]);
  assertEquals(urls, [
    `${keys.url}/auth/v1/admin/users?page=1&per_page=1000`,
    `${keys.url}/auth/v1/admin/users?page=2&per_page=1000`,
  ]);
});

Deno.test("readerToken generates and verifies a magic link with the right keys", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return calls.length === 1
      ? Response.json({ properties: { hashed_token: "hashed-secret" } })
      : Response.json({ access_token: "reader-secret" });
  };

  assertEquals(
    await readerToken(keys, "reader@example.com", fetchImpl),
    "reader-secret",
  );
  assertEquals(calls.length, 2);
  assertEquals(calls[0].url, `${keys.url}/auth/v1/admin/generate_link`);
  assertEquals(
    new Headers(calls[0].init?.headers).get("apikey"),
    keys.serviceKey,
  );
  assertEquals(
    new Headers(calls[0].init?.headers).get("authorization"),
    `Bearer ${keys.serviceKey}`,
  );
  assertEquals(JSON.parse(String(calls[0].init?.body)), {
    type: "magiclink",
    email: "reader@example.com",
  });
  assertEquals(calls[1].url, `${keys.url}/auth/v1/verify`);
  assertEquals(new Headers(calls[1].init?.headers).get("apikey"), keys.anonKey);
  assertEquals(
    new Headers(calls[1].init?.headers).get("authorization"),
    `Bearer ${keys.anonKey}`,
  );
  assertEquals(JSON.parse(String(calls[1].init?.body)), {
    type: "magiclink",
    token_hash: "hashed-secret",
  });
});

Deno.test("readerToken verify failure does not expose tokens or keys", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls++;
    return calls === 1
      ? Response.json({ hashed_token: "hashed-secret" })
      : new Response("hashed-secret anon-secret service-secret", {
        status: 401,
      });
  };

  const error = await assertRejects(
    () => readerToken(keys, "reader@example.com", fetchImpl),
    Error,
    "Verify reader magic link",
  );
  for (const secret of ["hashed-secret", keys.anonKey, keys.serviceKey]) {
    assertEquals(error.message.includes(secret), false);
  }
});

Deno.test("callAs sets reader authorization and anon apikey headers", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    assertEquals(String(input), `${keys.url}/functions/v1/recommendations`);
    assertEquals(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assertEquals(headers.get("authorization"), "Bearer reader-secret");
    assertEquals(headers.get("apikey"), keys.anonKey);
    assertEquals(JSON.parse(String(init?.body)), { refresh: true });
    return Response.json({ recommendations: [] });
  };

  assertEquals(
    await callAs(
      keys,
      "reader-secret",
      "recommendations",
      { refresh: true },
      fetchImpl,
    ),
    { recommendations: [] },
  );
});

Deno.test("callAs non-2xx errors carry status without exposing response or token", async () => {
  const error = await assertRejects(
    () =>
      callAs(
        keys,
        "reader-secret",
        "recommendations",
        {},
        async () =>
          new Response("reader-secret server-secret", { status: 503 }),
      ),
    Error,
    "recommendations",
  );

  assert("status" in error);
  assertEquals((error as Error & { status: number }).status, 503);
  assertEquals(error.message.includes("reader-secret"), false);
  assertEquals(error.message.includes("server-secret"), false);
});
