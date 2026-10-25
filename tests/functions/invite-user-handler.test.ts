import { assertEquals } from "jsr:@std/assert@1";
import { createHandler, DAILY_LIMIT } from "../../supabase/functions/invite-user/index.ts";

type InviteError = { message?: string; status?: number; code?: string } | null;

function fakeDb(options: { recent?: number; displayName?: string | null; inviteError?: InviteError } = {}) {
  const calls = { invites: [] as Array<{ email: string; data: Record<string, unknown> }>, inserted: [] as unknown[] };
  const db = {
    from(table: string) {
      const query: any = {
        select: () => query,
        eq: () => query,
        gte: () => Promise.resolve({ count: options.recent ?? 0, error: null }),
        maybeSingle: () => Promise.resolve({ data: { display_name: options.displayName ?? "איתמר" }, error: null }),
        insert: (row: Record<string, unknown>) => {
          calls.inserted.push({ table, ...row });
          return { select: () => ({ single: () => Promise.resolve({ data: { email: row.email, created_at: "2026-10-25T12:00:00Z" }, error: null }) }) };
        },
      };
      return query;
    },
    auth: {
      admin: {
        inviteUserByEmail: (email: string, opts: { data: Record<string, unknown> }) => {
          calls.invites.push({ email, data: opts.data });
          return Promise.resolve({ data: {}, error: options.inviteError ?? null });
        },
      },
    },
  };
  return { db, calls };
}

function request(body: Record<string, unknown>) {
  return new Request("http://local/invite-user", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test" },
    body: JSON.stringify(body),
  });
}

function handlerFor(db: unknown) {
  return createHandler({ requireUser: async () => "user-1", serviceClient: () => db as never });
}

Deno.test("invite-user sends an invite naming the inviter and records it", async () => {
  const { db, calls } = fakeDb();
  const response = await handlerFor(db)(request({ email: "  Friend@Example.com " }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { invitation: { email: "friend@example.com", created_at: "2026-10-25T12:00:00Z" } });
  assertEquals(calls.invites, [{ email: "friend@example.com", data: { inviter_name: "איתמר", invited_by: "user-1" } }]);
  assertEquals(calls.inserted, [{ table: "invitations", inviter_id: "user-1", email: "friend@example.com" }]);
});

Deno.test("invite-user rejects a bad email and enforces the daily limit before sending", async () => {
  const bad = fakeDb();
  assertEquals((await handlerFor(bad.db)(request({ email: "not-an-email" }))).status, 400);
  const limited = fakeDb({ recent: DAILY_LIMIT });
  assertEquals((await handlerFor(limited.db)(request({ email: "a@b.co" }))).status, 429);
  assertEquals(limited.calls.invites.length, 0);
});

Deno.test("invite-user maps provider errors to clear Hebrew messages and records nothing", async () => {
  const exists = fakeDb({ inviteError: { code: "email_exists", message: "A user with this email address has already been registered" } });
  const response = await handlerFor(exists.db)(request({ email: "a@b.co" }));
  assertEquals(response.status, 409);
  assertEquals((await response.json()).error, "לכתובת הזו כבר יש חשבון בתורימיטור.");
  assertEquals(exists.calls.inserted.length, 0);

  const blocked = fakeDb({ inviteError: { message: "Email address not authorized" } });
  assertEquals((await handlerFor(blocked.db)(request({ email: "a@b.co" }))).status, 502);
});

Deno.test("invite-user falls back to a neutral inviter name", async () => {
  const { db, calls } = fakeDb({ displayName: "  " });
  await handlerFor(db)(request({ email: "a@b.co" }));
  assertEquals(calls.invites[0].data.inviter_name, "חבר או חברה");
});
