import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyOptimisticBookMove,
  applyOptimisticShelfMove,
  bookDropIndexFromCenters,
  bookTilesWithoutPlus,
  cloneLibrary,
  shelfIndexById,
} from "../../public/js/data.js";
import { createRouter } from "../../public/js/router.js";
import { ROUTES } from "../../public/js/contract.js";

describe("layout helpers (data.js)", () => {
  it("bookTilesWithoutPlus skips plus tiles and dragged book", () => {
    const tiles = [{ id: 1 }, { id: 2 }, { id: 3, isPlus: true }];
    assert.equal(bookTilesWithoutPlus(tiles, 1).length, 1);
    assert.equal(bookTilesWithoutPlus(tiles, 1)[0].id, 2);
  });

  it("bookDropIndexFromCenters uses RTL midpoint rule", () => {
    assert.equal(bookDropIndexFromCenters([120, 60], 130), 0);
    assert.equal(bookDropIndexFromCenters([120, 60], 90), 1);
    assert.equal(bookDropIndexFromCenters([120, 60], 50), 2);
    assert.equal(bookDropIndexFromCenters([], 10), 0);
  });

  it("shelfIndexById finds shelf position", () => {
    assert.equal(shelfIndexById(["a", "b", "c"], "b"), 1);
    assert.equal(shelfIndexById(["a", "b", "c"], "missing"), -1);
  });
});

describe("optimistic move revert", () => {
  it("keeps a snapshot to restore after a failed write", () => {
    const state = {
      displayName: "",
      shelves: [
        {
          id: "a",
          name: "א",
          kind: "reading",
          position: 0,
          books: [{ simania_id: 1, shelf_id: "a", position: 0, title: "אחד" }],
        },
        { id: "b", name: "ב", kind: "read", position: 1, books: [] },
      ],
    };
    const snapshot = cloneLibrary(state);
    const moved = applyOptimisticBookMove(state, {
      simaniaId: 1,
      fromShelfId: "a",
      toShelfId: "b",
      toPosition: 0,
    });
    assert.equal(moved.shelves[1].books.length, 1);
    const reverted = snapshot;
    assert.equal(reverted.shelves[0].books.length, 1);
    assert.equal(reverted.shelves[1].books.length, 0);
  });

  it("reverts a shelf reorder the same way", () => {
    const state = {
      displayName: "",
      shelves: [
        { id: "a", name: "א", kind: "reading", position: 0, books: [] },
        { id: "b", name: "ב", kind: "read", position: 1, books: [] },
      ],
    };
    const snapshot = cloneLibrary(state);
    applyOptimisticShelfMove(state, { shelfId: "b", toPosition: 0 });
    assert.equal(snapshot.shelves[0].id, "a");
  });
});

describe("router", () => {
  it("normalize keeps known hashes and maps empty/unknown to library", () => {
    const router = createRouter({ onRoute() {} });
    assert.equal(router.normalize("#library"), ROUTES.LIBRARY);
    assert.equal(router.normalize("#recs"), ROUTES.RECOMMENDATIONS);
    assert.equal(router.normalize("#search"), ROUTES.SEARCH);
    assert.equal(router.normalize("#settings"), ROUTES.SETTINGS);
    assert.equal(router.normalize("#login"), ROUTES.LOGIN);
    assert.equal(router.normalize(""), ROUTES.LIBRARY);
    assert.equal(router.normalize("#nope"), ROUTES.LIBRARY);
  });
});
