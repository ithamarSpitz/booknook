import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampBubble, plusCenterOffset, shouldShow } from "../../public/js/first-run.js";

describe("first-run shouldShow", () => {
  it("is true when every shelf has no books", () => {
    const shelves = [
      { id: "a", name: "קורא עכשיו", books: [] },
      { id: "b", name: "קראתי", books: [] },
    ];
    assert.equal(shouldShow(shelves), true);
  });

  it("is false when any shelf has a book", () => {
    const shelves = [
      { id: "a", name: "קורא עכשיו", books: [] },
      { id: "b", name: "קראתי", books: [{ simania_id: 1 }] },
    ];
    assert.equal(shouldShow(shelves), false);
  });

  it("is false for non-array input", () => {
    assert.equal(shouldShow(null), false);
    assert.equal(shouldShow(undefined), false);
  });
});

describe("first-run plusCenterOffset", () => {
  it("uses the plus tile's physical x so an RTL empty row is not mirrored", () => {
    const main = { left: 0, top: 0 };
    const plus = { left: 700, top: 200, width: 80, height: 120 };
    const { top, left } = plusCenterOffset(plus, main);
    assert.equal(left, 740);
    assert.equal(top, 260);
  });
});

describe("clampBubble", () => {
  it("keeps the bubble inside the container and points the arrow at the plus", () => {
    // Plus tile at the right edge of a 375px phone, bubble 270px wide.
    const { center, arrow } = clampBubble(330, 270, 375);
    assert.equal(center, 375 - 135 - 8);
    assert.equal(arrow, 330 - (center - 135));
  });

  it("stays centered on the plus when there is room", () => {
    assert.deepEqual(clampBubble(400, 270, 1000), { center: 400, arrow: 135 });
  });
});
