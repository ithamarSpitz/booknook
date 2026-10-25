import { RPCS, SHELF_KINDS } from "./contract.js?v=5fedd1b";

/** @param {Array<{ position: number }>} items */
export function sortByPosition(items) {
  return [...items].sort((a, b) => a.position - b.position);
}

/** @param {number} n */
export function bookCountLabel(n) {
  if (n === 0) return "עדיין ריק";
  if (n === 1) return "ספר אחד";
  return `${n} ספרים`;
}

/** @param {string | null | undefined} displayName */
export function libraryTitle(displayName) {
  const name = String(displayName ?? "").trim();
  return name ? `הספרייה של ${name}` : "הספרייה שלי";
}

/**
 * @param {Array<{ id: string, name: string, kind: string, position: number }>} shelves
 * @param {Array<Record<string, unknown>>} shelfBookRows
 */
export function mapLibraryRows(shelves, shelfBookRows) {
  const orderedShelves = sortByPosition(shelves).map((shelf) => ({
    ...shelf,
    books: [],
  }));
  const byId = new Map(orderedShelves.map((s) => [s.id, s]));
  for (const row of sortByPosition(shelfBookRows)) {
    const shelf = byId.get(row.shelf_id);
    if (!shelf) continue;
    shelf.books.push(rowToBookCard(row));
  }
  return orderedShelves;
}

/** @param {Record<string, unknown>} row */
export function rowToBookCard(row) {
  const rawEdition = row.editions ?? row.edition ?? {};
  const edition = Array.isArray(rawEdition) ? (rawEdition[0] ?? {}) : rawEdition;
  return {
    simania_id: row.simania_id,
    work_id: edition.work_id ?? null,
    resolve_status: edition.resolve_status ?? "pending",
    title: edition.title ?? "",
    author: edition.author ?? null,
    translator: edition.translator ?? null,
    publisher: edition.publisher ?? null,
    series: edition.series ?? null,
    category: edition.category ?? null,
    year: edition.year ?? null,
    pages: edition.pages ?? null,
    description: edition.description ?? null,
    cover_url: edition.cover_url ?? null,
    simania_rating: edition.simania_rating != null ? Number(edition.simania_rating) : null,
    simania_rating_count: edition.simania_rating_count ?? null,
    shelf_id: row.shelf_id,
    shelf_name: row.shelf_name ?? null,
    shelf_kind: row.shelf_kind ?? null,
    position: row.position,
    added_at: row.added_at ?? null,
    finished_at: row.finished_at ?? null,
    rating: row.rating ?? null,
  };
}

/**
 * @typedef {{ shelves: ReturnType<typeof mapLibraryRows>, displayName: string, error?: string }} LibraryState
 */

/** @param {LibraryState} state */
export function cloneLibrary(state) {
  return {
    displayName: state.displayName,
    shelves: state.shelves.map((s) => ({
      ...s,
      books: s.books.map((b) => ({ ...b })),
    })),
  };
}

/**
 * @param {LibraryState} state
 * @param {{ simaniaId: number, fromShelfId: string, toShelfId: string, toPosition: number }} move
 */
export function applyOptimisticBookMove(state, move) {
  const next = cloneLibrary(state);
  const from = next.shelves.find((s) => s.id === move.fromShelfId);
  if (!from) return next;
  const idx = from.books.findIndex((b) => b.simania_id === move.simaniaId);
  if (idx === -1) return next;
  const [book] = from.books.splice(idx, 1);
  from.books.forEach((b, i) => {
    b.position = i;
  });

  const to = next.shelves.find((s) => s.id === move.toShelfId);
  if (!to || !book) return next;
  book.shelf_id = to.id;
  book.shelf_name = to.name;
  book.shelf_kind = to.kind;
  const pos = Math.max(0, Math.min(move.toPosition, to.books.length));
  to.books.splice(pos, 0, book);
  to.books.forEach((b, i) => {
    b.position = i;
  });
  return next;
}

/**
 * @param {LibraryState} state
 * @param {{ shelfId: string, toPosition: number }} move
 */
export function applyOptimisticShelfMove(state, move) {
  const next = cloneLibrary(state);
  const shelves = next.shelves;
  const idx = shelves.findIndex((s) => s.id === move.shelfId);
  if (idx === -1) return next;
  const [shelf] = shelves.splice(idx, 1);
  const pos = Math.max(0, Math.min(move.toPosition, shelves.length));
  shelves.splice(pos, 0, shelf);
  shelves.forEach((s, i) => {
    s.position = i;
  });
  return next;
}

/** @param {LibraryState} state @param {number} simaniaId */
export function applyOptimisticRemoveBook(state, simaniaId) {
  const next = cloneLibrary(state);
  for (const shelf of next.shelves) {
    const i = shelf.books.findIndex((b) => b.simania_id === simaniaId);
    if (i === -1) continue;
    shelf.books.splice(i, 1);
    shelf.books.forEach((b, j) => {
      b.position = j;
    });
    break;
  }
  return next;
}

/** @param {LibraryState} state @param {string} shelfId */
export function applyOptimisticDeleteShelf(state, shelfId) {
  const next = cloneLibrary(state);
  const idx = next.shelves.findIndex((s) => s.id === shelfId);
  if (idx === -1) return next;
  const [removed] = next.shelves.splice(idx, 1);
  const want = next.shelves.find((s) => s.kind === SHELF_KINDS.WANT);
  if (want) {
    for (const book of removed.books) {
      book.shelf_id = want.id;
      book.shelf_name = want.name;
      book.shelf_kind = want.kind;
      want.books.push(book);
    }
    want.books.forEach((b, i) => {
      b.position = i;
    });
  }
  next.shelves.forEach((s, i) => {
    s.position = i;
  });
  return next;
}

/** @param {LibraryState} state @param {string} shelfId @param {string} name */
export function applyOptimisticRename(state, shelfId, name) {
  const next = cloneLibrary(state);
  const shelf = next.shelves.find((s) => s.id === shelfId);
  if (shelf) shelf.name = name;
  for (const s of next.shelves) {
    for (const book of s.books) {
      if (book.shelf_id === shelfId) book.shelf_name = name;
    }
  }
  return next;
}

/** @param {import('@supabase/supabase-js').SupabaseClient} client */
async function currentUserId(client) {
  if (!client?.auth || typeof client.auth.getUser !== "function") return null;
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data?.user?.id ?? null;
}

/**
 * PostgREST refuses an UPDATE without a filter, so target the caller's own row.
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} displayName
 */
export async function saveDisplayName(client, displayName) {
  const userId = await currentUserId(client);
  if (!userId) throw new Error("נא להתחבר מחדש");
  const { error } = await client.from("profiles").update({ display_name: displayName }).eq("id", userId);
  if (error) throw new Error(error.message || "לא הצלחנו לשמור");
}

/** @param {import('@supabase/supabase-js').SupabaseClient} client */
export async function loadProfile(client) {
  const { data, error } = await client.from("profiles").select("display_name").maybeSingle();
  if (error) throw error;
  return data?.display_name ?? "";
}

/** @param {import('@supabase/supabase-js').SupabaseClient} client */
export async function loadLibrary(client) {
  const [displayName, shelvesRes, booksRes] = await Promise.all([
    loadProfile(client),
    client.from("shelves").select("id, name, kind, position").order("position"),
    client
      .from("shelf_books")
      .select(
        `simania_id, shelf_id, position, added_at, finished_at, rating,
        editions (
          simania_id, work_id, resolve_status, title, author, translator, publisher,
          series, category, year, pages, description, cover_url, simania_rating, simania_rating_count
        )`,
      )
      .order("position"),
  ]);
  if (shelvesRes.error) throw shelvesRes.error;
  if (booksRes.error) throw booksRes.error;

  const shelfMeta = new Map(
    (shelvesRes.data ?? []).map((s) => [s.id, { name: s.name, kind: s.kind }]),
  );
  const enriched = (booksRes.data ?? []).map((row) => {
    const meta = shelfMeta.get(row.shelf_id);
    return {
      ...row,
      shelf_name: meta?.name ?? null,
      shelf_kind: meta?.kind ?? null,
    };
  });

  const shelves = mapLibraryRows(shelvesRes.data ?? [], enriched);
  return { displayName, shelves };
}

/** @param {import('@supabase/supabase-js').SupabaseClient} client */
export async function renameShelf(client, shelfId, name) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("שם מדף ריק");
  const { error } = await client
    .from("shelves")
    .update({ name: trimmed })
    .eq("id", shelfId)
    .eq("kind", SHELF_KINDS.CUSTOM);
  if (error) throw error;
  return trimmed;
}

/** @param {import('@supabase/supabase-js').SupabaseClient} client */
export async function createCustomShelf(client, name) {
  const trimmed = (name || "מדף חדש").trim();
  const userId = await currentUserId(client);
  if (!userId) throw new Error("צריך להתחבר");
  const row = { name: trimmed, kind: SHELF_KINDS.CUSTOM, user_id: userId };
  const { data, error } = await client
    .from("shelves")
    .insert(row)
    .select("id, name, kind, position")
    .single();
  if (error) throw error;
  return { ...data, books: [] };
}

/** @param {import('@supabase/supabase-js').SupabaseClient} client */
export async function moveBook(client, simaniaId, toShelfId, toPosition) {
  const { error } = await client.rpc(RPCS.MOVE_BOOK.name, {
    p_simania_id: simaniaId,
    p_to_shelf: toShelfId,
    p_to_position: toPosition,
  });
  if (error) throw error;
}

/** @param {import('@supabase/supabase-js').SupabaseClient} client */
export async function moveShelf(client, shelfId, toPosition) {
  const { error } = await client.rpc(RPCS.MOVE_SHELF.name, {
    p_shelf_id: shelfId,
    p_to_position: toPosition,
  });
  if (error) throw error;
}

/** @param {import('@supabase/supabase-js').SupabaseClient} client */
export async function deleteShelf(client, shelfId) {
  const { error } = await client.rpc(RPCS.DELETE_SHELF.name, {
    p_shelf_id: shelfId,
  });
  if (error) throw error;
}

/** @param {import('@supabase/supabase-js').SupabaseClient} client */
export async function removeBook(client, simaniaId) {
  const { error } = await client.rpc(RPCS.REMOVE_BOOK.name, {
    p_simania_id: simaniaId,
  });
  if (error) throw error;
}

/**
 * @param {Array<{ id: unknown, isPlus?: boolean }>} tiles
 * @param {unknown} draggedId
 */
export function bookTilesWithoutPlus(tiles, draggedId) {
  return tiles.filter((t) => !t.isPlus && t.id !== draggedId);
}

/**
 * RTL: drop before index when clientX is right of each tile center.
 * @param {number[]} centerXs
 * @param {number} clientX
 */
export function bookDropIndexFromCenters(centerXs, clientX) {
  for (let i = 0; i < centerXs.length; i++) {
    if (clientX > centerXs[i]) return i;
  }
  return centerXs.length;
}

/** @param {string[]} shelfIds @param {string} shelfId */
export function shelfIndexById(shelfIds, shelfId) {
  return shelfIds.indexOf(shelfId);
}
