import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateDisplayName } from "../../public/js/settings.js";

describe("validateDisplayName", () => {
  it("rejects empty names", () => {
    const result = validateDisplayName("   ");
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });

  it("trims and accepts non-empty names", () => {
    const result = validateDisplayName("  דנה  ");
    assert.equal(result.ok, true);
    assert.equal(result.value, "דנה");
  });
});
