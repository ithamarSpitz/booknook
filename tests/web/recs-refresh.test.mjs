import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRecsRefresher } from "../../public/js/recs-refresh.js";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe("background recommendations refresh", () => {
  it("debounces a burst of shelf changes into one run and reports busy", async () => {
    const calls = [];
    const states = [];
    const refresher = createRecsRefresher({
      delayMs: 5,
      callFunction: async (name) => {
        calls.push(name);
        return { recommendations: [] };
      },
      localize: async () => {},
    });
    refresher.subscribe((busy) => states.push(busy));
    refresher.request();
    refresher.request();
    refresher.request();
    assert.equal(refresher.busy(), true);
    await tick(30);
    assert.deepEqual(calls, ["recommendations"]);
    assert.equal(refresher.busy(), false);
    assert.equal(states.at(-1), false);
  });

  it("runs again when a change arrives mid-run, and localizes only the newest list", async () => {
    let release;
    let calls = 0;
    const localized = [];
    const refresher = createRecsRefresher({
      delayMs: 1,
      callFunction: async () => {
        calls += 1;
        if (calls === 1) await new Promise((resolve) => (release = resolve));
        return { recommendations: [{ work_id: `w${calls}`, simania_id: null }] };
      },
      localize: async (cards) => localized.push(cards[0].work_id),
    });
    refresher.request();
    await tick(10);
    refresher.request();
    release();
    await tick(10);
    assert.equal(calls, 2);
    assert.deepEqual(localized, ["w2"]);
    assert.equal(refresher.busy(), false);
  });

  it("sets failed after a call error, notifies, and clears it after a successful run", async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      let shouldFail = true;
      const states = [];
      const refresher = createRecsRefresher({
        delayMs: 1,
        callFunction: async () => {
          if (shouldFail) throw new Error("offline");
          return { recommendations: [] };
        },
        localize: async () => {},
      });
      refresher.subscribe((busy) => states.push([busy, refresher.failed()]));
      assert.equal(refresher.failed(), false);
      refresher.request();
      await tick(10);
      assert.equal(refresher.busy(), false);
      assert.equal(refresher.failed(), true);
      assert.deepEqual(states.at(-1), [false, true]);

      shouldFail = false;
      refresher.request();
      await tick(10);
      assert.equal(refresher.failed(), false);
      assert.deepEqual(states.at(-1), [false, false]);
    } finally {
      console.warn = warn;
    }
  });

  it("sets failed when localization throws", async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      const states = [];
      const refresher = createRecsRefresher({
        delayMs: 1,
        callFunction: async () => ({ recommendations: [] }),
        localize: async () => { throw new Error("localization failed"); },
      });
      refresher.subscribe((busy) => states.push([busy, refresher.failed()]));
      refresher.request();
      await tick(10);
      assert.equal(refresher.failed(), true);
      assert.deepEqual(states.at(-1), [false, true]);
    } finally {
      console.warn = warn;
    }
  });
});
