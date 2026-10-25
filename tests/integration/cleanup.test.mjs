import assert from "node:assert/strict";
import test from "node:test";

import { cleanupResources } from "../../scripts/verify-integration.mjs";

test("cleanup attempts every user deletion after server shutdown fails", async () => {
  const deletedUsers = [];

  const errors = await cleanupResources({
    stopServer: async () => {
      throw new Error("server still running");
    },
    users: [
      { id: "user-a", email: "a@example.invalid" },
      { id: "user-b", email: "b@example.invalid" },
    ],
    resolveUserId: async () => {
      throw new Error("known IDs must not be resolved");
    },
    deleteUser: async (id) => {
      deletedUsers.push(id);
      if (id === "user-b") throw new Error("admin API unavailable");
    },
  });

  assert.deepEqual(deletedUsers, ["user-b", "user-a"]);
  assert.deepEqual(errors, [
    "stop function server: server still running",
    "delete user user-b: admin API unavailable",
  ]);
});

test("cleanup is limited to stopping the server and deleting throwaway users", async () => {
  const operations = [];

  const errors = await cleanupResources({
    stopServer: async () => operations.push(["stop-server"]),
    users: [
      { id: "user-a", email: "a@example.invalid" },
      { id: "user-b", email: "b@example.invalid" },
    ],
    resolveUserId: async () => {
      throw new Error("known IDs must not be resolved");
    },
    deleteUser: async (id) => operations.push(["delete-user", id]),
  });

  assert.deepEqual(errors, []);
  assert.deepEqual(operations, [
    ["stop-server"],
    ["delete-user", "user-b"],
    ["delete-user", "user-a"],
  ]);
});

test("cleanup resolves a throwaway user whose create response was lost", async () => {
  const operations = [];

  const errors = await cleanupResources({
    stopServer: async () => operations.push(["stop-server"]),
    users: [{ id: null, email: "lost-response@example.invalid" }],
    resolveUserId: async (email) => {
      operations.push(["resolve-user", email]);
      return "committed-user";
    },
    deleteUser: async (id) => operations.push(["delete-user", id]),
  });

  assert.deepEqual(errors, []);
  assert.deepEqual(operations, [
    ["stop-server"],
    ["resolve-user", "lost-response@example.invalid"],
    ["delete-user", "committed-user"],
  ]);
});
