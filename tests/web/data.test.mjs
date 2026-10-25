import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyOptimisticBookMove,
  saveDisplayName,
  applyOptimisticDeleteShelf,
  applyOptimisticRemoveBook,
  applyOptimisticRename,
  applyOptimisticShelfMove,
  bookCountLabel,
  cloneLibrary,
  createCustomShelf,
  deleteShelf,
  libraryTitle,
  loadLibrary,
  moveShelf,
  mapLibraryRows,
  moveBook,
  removeBook,
  renameShelf,
  rowToBookCard,
  sortByPosition,
} from "../../public/js/data.js";
import { RPCS } from "../../public/js/contract.js";

function sampleState() {
  return {
    displayName: "איתמר",
    shelves: [
      {
        id: "a",
        name: "קורא עכשיו",
        kind: "reading",
        position: 0,
        books: [
          { simania_id: 1, shelf_id: "a", shelf_name: "קורא עכשיו", shelf_kind: "reading", position: 0, title: "אחד" },
          { simania_id: 2, shelf_id: "a", shelf_name: "קורא עכשיו", shelf_kind: "reading", position: 1, title: "שני" },
        ],
      },
      { id: "b", name: "קראתי", kind: "read", position: 1, books: [] },
      { id: "c", name: "רוצה לקרוא", kind: "want", position: 2, books: [] },
      {
        id: "d",
        name: "קיץ",
        kind: "custom",
        position: 3,
        books: [{ simania_id: 9, shelf_id: "d", shelf_name: "קיץ", shelf_kind: "custom", position: 0, title: "קיץ" }],
      },
    ],
  };
}

describe("data.js helpers", () => {
  it("sortByPosition orders zero-based positions", () => {
    const sorted = sortByPosition([{ position: 2 }, { position: 0 }, { position: 1 }]);
    assert.deepEqual(sorted.map((x) => x.position), [0, 1, 2]);
  });

  it("bookCountLabel uses Hebrew copy", () => {
    assert.equal(bookCountLabel(0), "עדיין ריק");
    assert.equal(bookCountLabel(1), "ספר אחד");
    assert.equal(bookCountLabel(4), "4 ספרים");
  });

  it("libraryTitle uses display_name", () => {
    assert.equal(libraryTitle("איתמר"), "הספרייה של איתמר");
    assert.equal(libraryTitle(""), "הספרייה שלי");
    assert.equal(libraryTitle(null), "הספרייה שלי");
  });

  it("rowToBookCard maps edition join and numeric rating", () => {
    const card = rowToBookCard({
      simania_id: 7,
      shelf_id: "s",
      position: 2,
      editions: { title: "כותרת", simania_rating: "4.50", resolve_status: "wikidata" },
      shelf_name: "קראתי",
      shelf_kind: "read",
    });
    assert.equal(card.title, "כותרת");
    assert.equal(card.simania_rating, 4.5);
    assert.equal(card.resolve_status, "wikidata");
    assert.equal(card.position, 2);
  });

  it("rowToBookCard uses the first editions array element", () => {
    const card = rowToBookCard({
      simania_id: 8,
      shelf_id: "s",
      position: 0,
      editions: [{ title: "ראשון" }, { title: "שני" }],
    });
    assert.equal(card.title, "ראשון");
  });

  it("mapLibraryRows nests books under shelves and skips unknown shelves", () => {
    const shelves = [
      { id: "a", name: "קורא עכשיו", kind: "reading", position: 0 },
      { id: "b", name: "קראתי", kind: "read", position: 1 },
    ];
    const rows = [
      {
        simania_id: 1,
        shelf_id: "b",
        position: 0,
        editions: { title: "ספר", resolve_status: "pending" },
        shelf_name: "קראתי",
        shelf_kind: "read",
      },
      {
        simania_id: 2,
        shelf_id: "a",
        position: 0,
        editions: { title: "שני", resolve_status: "pending" },
        shelf_name: "קורא עכשיו",
        shelf_kind: "reading",
      },
      {
        simania_id: 3,
        shelf_id: "missing",
        position: 0,
        editions: { title: "אבוד", resolve_status: "pending" },
      },
    ];
    const mapped = mapLibraryRows(shelves, rows);
    assert.equal(mapped[0].books[0].simania_id, 2);
    assert.equal(mapped[1].books[0].title, "ספר");
    assert.equal(mapped.every((s) => s.books.every((b) => b.simania_id !== 3)), true);
  });

  it("applyOptimisticBookMove moves and reindexes", () => {
    const state = sampleState();
    const next = applyOptimisticBookMove(state, {
      simaniaId: 1,
      fromShelfId: "a",
      toShelfId: "b",
      toPosition: 0,
    });
    assert.equal(next.shelves[0].books.length, 1);
    assert.equal(next.shelves[1].books[0].simania_id, 1);
    assert.equal(next.shelves[0].books[0].position, 0);
    assert.equal(next.shelves[1].books[0].shelf_kind, "read");
    const reverted = cloneLibrary(state);
    assert.deepEqual(reverted, state);
    assert.equal(state.shelves[0].books.length, 2);
  });

  it("applyOptimisticBookMove reorders within a shelf", () => {
    const next = applyOptimisticBookMove(sampleState(), {
      simaniaId: 1,
      fromShelfId: "a",
      toShelfId: "a",
      toPosition: 1,
    });
    assert.deepEqual(
      next.shelves[0].books.map((b) => b.simania_id),
      [2, 1],
    );
    assert.deepEqual(
      next.shelves[0].books.map((b) => b.position),
      [0, 1],
    );
  });

  it("applyOptimisticShelfMove reorders shelves", () => {
    const next = applyOptimisticShelfMove(sampleState(), { shelfId: "d", toPosition: 0 });
    assert.equal(next.shelves[0].id, "d");
    assert.equal(next.shelves[3].id, "c");
    assert.equal(next.shelves[3].position, 3);
  });

  it("applyOptimisticRemoveBook closes the gap", () => {
    const next = applyOptimisticRemoveBook(sampleState(), 1);
    assert.equal(next.shelves[0].books.length, 1);
    assert.equal(next.shelves[0].books[0].simania_id, 2);
    assert.equal(next.shelves[0].books[0].position, 0);
  });

  it("applyOptimisticDeleteShelf appends books onto want", () => {
    const next = applyOptimisticDeleteShelf(sampleState(), "d");
    assert.equal(next.shelves.some((s) => s.id === "d"), false);
    const want = next.shelves.find((s) => s.kind === "want");
    assert.equal(want.books[0].simania_id, 9);
    assert.equal(want.books[0].shelf_id, "c");
    assert.equal(next.shelves[2].position, 2);
  });

  it("applyOptimisticRename updates shelf and book labels", () => {
    const next = applyOptimisticRename(sampleState(), "d", "חורף");
    assert.equal(next.shelves[3].name, "חורף");
    assert.equal(next.shelves[3].books[0].shelf_name, "חורף");
  });
});

describe("data.js client", () => {
  it("loadLibrary joins shelves and shelf books", async () => {
    const client = {
      from(table) {
        if (table === "profiles") {
          return {
            select() {
              return { maybeSingle: async () => ({ data: { display_name: "דנה" }, error: null }) };
            },
          };
        }
        if (table === "shelves") {
          return {
            select() {
              return {
                order: async () => ({
                  data: [{ id: "s1", name: "קורא עכשיו", kind: "reading", position: 0 }],
                  error: null,
                }),
              };
            },
          };
        }
        if (table === "shelf_books") {
          return {
            select() {
              return {
                order: async () => ({
                  data: [
                    {
                      simania_id: 9,
                      shelf_id: "s1",
                      position: 0,
                      editions: { title: "כותרת", resolve_status: "pending" },
                    },
                  ],
                  error: null,
                }),
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    const lib = await loadLibrary(client);
    assert.equal(lib.displayName, "דנה");
    assert.equal(lib.shelves[0].books[0].title, "כותרת");
  });

  it("loadLibrary throws when the shelves query fails", async () => {
    const client = {
      from(table) {
        if (table === "profiles") {
          return {
            select() {
              return { maybeSingle: async () => ({ data: { display_name: "דנה" }, error: null }) };
            },
          };
        }
        if (table === "shelves") {
          return {
            select() {
              return { order: async () => ({ data: null, error: new Error("denied") }) };
            },
          };
        }
        if (table === "shelf_books") {
          return {
            select() {
              return { order: async () => ({ data: [], error: null }) };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    await assert.rejects(() => loadLibrary(client), /denied/);
  });

  it("moveBook calls move_book RPC", async () => {
    const calls = [];
    const client = {
      rpc(name, args) {
        calls.push({ name, args });
        return Promise.resolve({ error: null });
      },
    };
    await moveBook(client, 42, "shelf", 1);
    assert.equal(calls[0].name, RPCS.MOVE_BOOK.name);
    assert.deepEqual(calls[0].args, {
      p_simania_id: 42,
      p_to_shelf: "shelf",
      p_to_position: 1,
    });
  });

  it("moveShelf calls move_shelf RPC", async () => {
    const calls = [];
    const client = {
      rpc(name, args) {
        calls.push({ name, args });
        return Promise.resolve({ error: null });
      },
    };
    await moveShelf(client, "shelf-2", 0);
    assert.equal(calls[0].name, RPCS.MOVE_SHELF.name);
    assert.deepEqual(calls[0].args, { p_shelf_id: "shelf-2", p_to_position: 0 });
  });

  it("deleteShelf and removeBook use contract RPC names", async () => {
    const calls = [];
    const client = {
      rpc(name, args) {
        calls.push({ name, args });
        return Promise.resolve({ error: null });
      },
    };
    await deleteShelf(client, "shelf-1");
    await removeBook(client, 99);
    assert.equal(calls[0].name, RPCS.DELETE_SHELF.name);
    assert.deepEqual(calls[0].args, { p_shelf_id: "shelf-1" });
    assert.equal(calls[1].name, RPCS.REMOVE_BOOK.name);
    assert.deepEqual(calls[1].args, { p_simania_id: 99 });
  });

  it("createCustomShelf inserts custom kind and user_id", async () => {
    const client = {
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      },
      from(table) {
        assert.equal(table, "shelves");
        return {
          insert(row) {
            assert.equal(row.kind, "custom");
            assert.equal(row.user_id, "user-1");
            return {
              select() {
                return {
                  single: async () => ({
                    data: { id: "c1", name: row.name, kind: "custom", position: 4 },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      },
    };
    const shelf = await createCustomShelf(client, "קיץ");
    assert.equal(shelf.name, "קיץ");
    assert.deepEqual(shelf.books, []);
  });

  it("createCustomShelf rejects when there is no user", async () => {
    const client = {
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    };
    await assert.rejects(() => createCustomShelf(client, "קיץ"), /צריך להתחבר/);
  });

  it("renameShelf updates custom shelves only", async () => {
    const filters = [];
    const client = {
      from() {
        return {
          update(row) {
            assert.equal(row.name, "חדש");
            return {
              eq(col, val) {
                filters.push([col, val]);
                return this;
              },
            };
          },
        };
      },
    };
    const name = await renameShelf(client, "s1", "חדש");
    assert.equal(name, "חדש");
    assert.deepEqual(filters, [
      ["id", "s1"],
      ["kind", "custom"],
    ]);
  });
});

describe("saveDisplayName", () => {
  it("updates only the caller's profile row (PostgREST rejects an unfiltered UPDATE)", async () => {
    const calls = [];
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
      from: (table) => ({
        update: (values) => ({
          eq: async (column, value) => {
            calls.push({ table, values, column, value });
            return { error: null };
          },
        }),
      }),
    };
    await saveDisplayName(client, "איתמר");
    assert.deepEqual(calls, [{ table: "profiles", values: { display_name: "איתמר" }, column: "id", value: "u1" }]);
  });
});
