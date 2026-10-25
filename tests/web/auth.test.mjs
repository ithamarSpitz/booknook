import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapLoginError, validateLoginForm } from "../../public/js/auth.js";

describe("validateLoginForm", () => {
  it("requires email and password", () => {
    const result = validateLoginForm({ email: "", password: "" });
    assert.equal(result.ok, false);
    assert.ok(result.errors.email);
    assert.ok(result.errors.password);
  });

  it("rejects invalid email", () => {
    const result = validateLoginForm({ email: "not-an-email", password: "secret" });
    assert.equal(result.ok, false);
    assert.ok(result.errors.email);
    assert.equal(result.errors.password, undefined);
  });

  it("accepts trimmed valid credentials", () => {
    const result = validateLoginForm({ email: "  reader@example.com ", password: "pw" });
    assert.equal(result.ok, true);
    assert.equal(result.email, "reader@example.com");
    assert.equal(result.password, "pw");
  });
});

describe("mapLoginError", () => {
  it("maps invalid credentials to Hebrew wrong-password copy", () => {
    const msg = mapLoginError({ code: "invalid_credentials", message: "Invalid login credentials" });
    assert.match(msg, /סיסמה שגויה/);
  });

  it("maps network failures to Hebrew network copy", () => {
    const msg = mapLoginError(new TypeError("Failed to fetch"));
    assert.match(msg, /רשת/);
  });

  it("falls back to message text", () => {
    assert.equal(mapLoginError({ message: "מותאם אישית" }), "מותאם אישית");
  });
});
