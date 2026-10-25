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

  it("stays quiet and idle after a failure", async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      const refresher = createRecsRefresher({
        delayMs: 1,
        callFunction: async () => {
          throw new Error("offline");
        },
      });
      refresher.request();
      await tick(10);
      assert.equal(refresher.busy(), false);
    } finally {
      console.warn = warn;
    }
  });
});
