import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapLoginError,
  needsNewPassword,
  parseAuthRedirect,
  validateLoginForm,
  validateNewPassword,
} from "../../public/js/auth.js";

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

describe("auth redirect links", () => {
  it("recognizes invite and recovery sessions in the fragment", () => {
    const invite = parseAuthRedirect("#access_token=x&refresh_token=y&type=invite");
    assert.deepEqual(invite, { kind: "session", type: "invite" });
    assert.equal(needsNewPassword(invite), true);
    assert.equal(needsNewPassword(parseAuthRedirect("#access_token=x&type=recovery")), true);
    assert.equal(needsNewPassword(parseAuthRedirect("#access_token=x&type=magiclink")), false);
  });

  it("reports an expired link and ignores app routes", () => {
    assert.deepEqual(
      parseAuthRedirect("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"),
      { kind: "error", message: "Email link is invalid or has expired" },
    );
    assert.equal(parseAuthRedirect("#library"), null);
    assert.equal(parseAuthRedirect(""), null);
  });

  it("requires 6 characters and a matching confirmation", () => {
    assert.ok(validateNewPassword({ password: "12345", confirm: "12345" }).errors.password);
    assert.ok(validateNewPassword({ password: "123456", confirm: "123457" }).errors.confirm);
    assert.equal(validateNewPassword({ password: "123456", confirm: "123456" }).ok, true);
  });
});
