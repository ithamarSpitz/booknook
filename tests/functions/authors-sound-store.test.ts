import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  type AuthorStore,
  type FoundAuthor,
  nameKey,
  type NewAuthorName,
  soundNames,
} from "../../supabase/functions/_shared/authors.ts";
import type { AuthorNameRow } from "../../supabase/functions/_shared/types.ts";

class MemoryStore implements AuthorStore {
  authors: Array<
    { id: string; wikidata: string | null; sound: string | null }
  > = [];
  names: AuthorNameRow[] = [];
  private next = 1;

  find(lang: "en" | "he", key: string): Promise<FoundAuthor | null> {
    const hit = this.names.find((row) =>
      row.lang === lang && row.name_key === key
    );
    if (!hit) return Promise.resolve(null);
    const author = this.authors.find((row) => row.id === hit.author_id)!;
    return Promise.resolve({
      author_id: author.id,
      wikidata_checked_at: author.wikidata,
      sound_checked_at: author.sound,
      names: this.names.filter((row) => row.author_id === author.id).map((
        row,
      ) => ({ ...row })),
    });
  }

  create(): Promise<string> {
    const id = `a${this.next++}`;
    this.authors.push({ id, wikidata: null, sound: null });
    return Promise.resolve(id);
  }

  addNames(authorId: string, names: NewAuthorName[]): Promise<void> {
    for (const entry of names) {
      const key = nameKey(entry.name);
      if (
        !key ||
        this.names.some((row) =>
          row.lang === entry.lang && row.name_key === key
        )
      ) continue;
      this.names.push({
        author_id: authorId,
        lang: entry.lang,
        name: entry.name,
        name_key: key,
        source: entry.source,
      });
    }
    return Promise.resolve();
  }

  merge(keepId: string, dropId: string): Promise<void> {
    for (const row of this.names) {
      if (row.author_id === dropId) row.author_id = keepId;
    }
    this.authors = this.authors.filter((row) => row.id !== dropId);
    return Promise.resolve();
  }

  markWikidataChecked(authorId: string, at: Date): Promise<void> {
    this.authors.find((row) => row.id === authorId)!.wikidata = at
      .toISOString();
    return Promise.resolve();
  }

  markSoundChecked(authorId: string, at: Date): Promise<void> {
    this.authors.find((row) => row.id === authorId)!.sound = at.toISOString();
    return Promise.resolve();
  }
}

const DAY = 86_400_000;
const T0 = new Date("2026-11-22T00:00:00Z");

Deno.test("soundNames stores and returns a found Hebrew name", async () => {
  const store = new MemoryStore();
  assertEquals(
    await soundNames(
      store,
      "Julia Walton",
      () => Promise.resolve("ג'וליה וולטון"),
      () => T0,
    ),
    [
      "ג'וליה וולטון",
    ],
  );
  assertEquals(
    store.names.map((row) => `${row.lang}:${row.name}:${row.source}`).sort(),
    [
      "en:Julia Walton:wikidata",
      "he:ג'וליה וולטון:sound",
    ],
  );
  assertEquals(store.authors[0].sound, T0.toISOString());
});

Deno.test("soundNames returns a stored link name without lookup", async () => {
  const store = new MemoryStore();
  const id = await store.create();
  await store.addNames(id, [
    { lang: "en", name: "Julia Walton", source: "wikidata" },
    { lang: "he", name: "ג'וליה וולטון", source: "link" },
  ]);
  let calls = 0;
  assertEquals(
    await soundNames(
      store,
      "Julia Walton",
      () => (calls++, Promise.resolve("wrong")),
      () => T0,
    ),
    [
      "ג'וליה וולטון",
    ],
  );
  assertEquals(calls, 0);
});

Deno.test("soundNames caches null for 30 days and retries after 31", async () => {
  const store = new MemoryStore();
  let calls = 0;
  let now = T0;
  const lookup = () => (calls++, Promise.resolve(null));
  assertEquals(await soundNames(store, "Nobody Known", lookup, () => now), []);
  assertEquals(calls, 1);
  now = new Date(T0.getTime() + 29 * DAY);
  assertEquals(await soundNames(store, "Nobody Known", lookup, () => now), []);
  assertEquals(calls, 1);
  now = new Date(T0.getTime() + 31 * DAY);
  assertEquals(await soundNames(store, "Nobody Known", lookup, () => now), []);
  assertEquals(calls, 2);
});

Deno.test("soundNames propagates lookup failures without storing", async () => {
  const store = new MemoryStore();
  const failure = new Error("lookup failed");
  await assertRejects(
    () =>
      soundNames(
        store,
        "Julia Walton",
        () => Promise.reject(failure),
        () => T0,
      ),
    Error,
  );
  assertEquals(store.names, []);
  assertEquals(store.authors, []);

  const id = await store.create();
  await store.addNames(id, [{
    lang: "en",
    name: "Known Author",
    source: "wikidata",
  }]);
  await assertRejects(
    () =>
      soundNames(
        store,
        "Known Author",
        () => Promise.reject(failure),
        () => T0,
      ),
    Error,
  );
  assertEquals(store.authors[0].sound, null);
});

Deno.test("soundNames orders stored names link, wikidata, sound", async () => {
  const store = new MemoryStore();
  const id = await store.create();
  await store.addNames(id, [
    { lang: "en", name: "Julia Walton", source: "wikidata" },
    { lang: "he", name: "צליל", source: "sound" },
    { lang: "he", name: "קישור", source: "link" },
    { lang: "he", name: "ויקינתונים", source: "wikidata" },
  ]);
  let calls = 0;
  assertEquals(
    await soundNames(
      store,
      "Julia Walton",
      () => (calls++, Promise.resolve(null)),
      () => T0,
    ),
    [
      "קישור",
      "ויקינתונים",
      "צליל",
    ],
  );
  assertEquals(calls, 0);
});
