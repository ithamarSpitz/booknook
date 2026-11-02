import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOpenRefresh } from "../../public/js/app-open-refresh.js";

const MIN = 30 * 60 * 1000;

describe("app open refresh", () => {
  it("signedIn() twice calls request exactly once", () => {
    const calls = [];
    const refresh = createOpenRefresh({ request: () => calls.push(1) });
    refresh.signedIn();
    refresh.signedIn();
    assert.equal(calls.length, 1);
  });

  it("long hide then visible requests once more; short hide does not", () => {
    let t = 0;
    const calls = [];
    const refresh = createOpenRefresh({
      request: () => calls.push(t),
      now: () => t,
      minHiddenMs: MIN,
    });
    refresh.signedIn();
    assert.equal(calls.length, 1);

    refresh.visibility(false);
    t += 31 * 60 * 1000;
    refresh.visibility(true);
    assert.equal(calls.length, 2);

    refresh.visibility(false);
    t += 5 * 60 * 1000;
    refresh.visibility(true);
    assert.equal(calls.length, 2);
  });

  it("visible after long hide before signedIn does not call request", () => {
    let t = 0;
    const calls = [];
    const refresh = createOpenRefresh({
      request: () => calls.push(1),
      now: () => t,
      minHiddenMs: MIN,
    });
    refresh.visibility(false);
    t += 31 * 60 * 1000;
    refresh.visibility(true);
    assert.equal(calls.length, 0);
  });

  it("two visible events after one long hide call request only once", () => {
    let t = 0;
    const calls = [];
    const refresh = createOpenRefresh({
      request: () => calls.push(1),
      now: () => t,
      minHiddenMs: MIN,
    });
    refresh.signedIn();
    refresh.visibility(false);
    t += 31 * 60 * 1000;
    refresh.visibility(true);
    refresh.visibility(true);
    assert.equal(calls.length, 2);
  });
});
