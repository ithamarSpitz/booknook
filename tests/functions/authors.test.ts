import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  type AuthorStore,
  catalogAuthorStore,
  englishNames,
  type FoundAuthor,
  hebrewNames,
  nameKey,
  type NewAuthorName,
  recordPair,
} from "../../supabase/functions/_shared/authors.ts";
import {
  ProviderError,
  wikidataHebrewAuthor,
  wikidataHebrewAuthorStrict,
} from "../../supabase/functions/_shared/bridges.ts";
import type { AuthorNameRow } from "../../supabase/functions/_shared/types.ts";
import { FakeDb } from "./helpers/fake-db.ts";

class MemoryStore implements AuthorStore {
  authors: Array<{ id: string; checked: string | null; soundChecked: string | null }> = [];
  names: AuthorNameRow[] = [];
  private next = 1;

  find(lang: "en" | "he", key: string): Promise<FoundAuthor | null> {
    const hit = this.names.find((row) => row.lang === lang && row.name_key === key);
    if (!hit) return Promise.resolve(null);
    const author = this.authors.find((a) => a.id === hit.author_id)!;
    return Promise.resolve({
      author_id: author.id,
      wikidata_checked_at: author.checked,
      sound_checked_at: author.soundChecked,
      names: this.names.filter((row) => row.author_id === author.id).map((row) => ({ ...row })),
    });
  }
  create(): Promise<string> {
    const id = `a${this.next++}`;
    this.authors.push({ id, checked: null, soundChecked: null });
    return Promise.resolve(id);
  }
  addNames(authorId: string, names: NewAuthorName[]): Promise<void> {
    for (const entry of names) {
      const key = nameKey(entry.name);
      if (!key || this.names.some((row) => row.lang === entry.lang && row.name_key === key)) continue;
      this.names.push({ author_id: authorId, lang: entry.lang, name: entry.name, name_key: key, source: entry.source });
    }
    return Promise.resolve();
  }
  merge(keepId: string, dropId: string): Promise<void> {
    for (const row of this.names) if (row.author_id === dropId) row.author_id = keepId;
    this.authors = this.authors.filter((a) => a.id !== dropId);
    return Promise.resolve();
  }
  markWikidataChecked(authorId: string, at: Date): Promise<void> {
    this.authors.find((a) => a.id === authorId)!.checked = at.toISOString();
    return Promise.resolve();
  }
  markSoundChecked(authorId: string, at: Date): Promise<void> {
    this.authors.find((a) => a.id === authorId)!.soundChecked = at.toISOString();
    return Promise.resolve();
  }
}

function stores(): Array<{ label: string; make: () => { store: AuthorStore; rows: () => AuthorNameRow[]; count: () => number } }> {
  return [
    {
      label: "memory",
      make: () => {
        const store = new MemoryStore();
        return { store, rows: () => store.names, count: () => store.authors.length };
      },
    },
    {
      label: "catalog",
      make: () => {
        const db = new FakeDb({ authors: [], author_names: [] });
        return {
          store: catalogAuthorStore(db),
          rows: () => db.tables.author_names as AuthorNameRow[],
          count: () => db.tables.authors.length,
        };
      },
    },
  ];
}

const DAY = 86_400_000;
const T0 = new Date("2026-11-21T00:00:00Z");

for (const { label, make } of stores()) {
  Deno.test(`${label}: recordPair stores a sounding pair and ignores a mismatch`, async () => {
    const { store, rows, count } = make();
    await recordPair(store, "הולי ג'קסון", "Alice Feeney");
    assertEquals(rows().length, 0);
    assertEquals(count(), 0);
    await recordPair(store, "אליס פיני", "Alice Feeney");
    assertEquals(count(), 1);
    assertEquals(rows().map((r) => `${r.lang}:${r.name}:${r.source}`).sort(), [
      "en:Alice Feeney:link",
      "he:אליס פיני:link",
    ]);
    await recordPair(store, "אליס פיני", "Alice Feeney");
    assertEquals(rows().length, 2);
  });

  Deno.test(`${label}: a third pair merges two authors and keeps all names`, async () => {
    const { store, rows, count } = make();
    await recordPair(store, "אליס פיני", "Alice Feeney");
    await recordPair(store, "אליס פייני", "A. Feeny");
    // Force two separate authors by pairing names that share no key.
    assertEquals(count() >= 1, true);
    const a = await store.create();
    await store.addNames(a, [{ lang: "en", name: "Stephen King", source: "link" }]);
    const b = await store.create();
    await store.addNames(b, [{ lang: "he", name: "סטיבן קינג", source: "link" }]);
    assertEquals(count() >= 3, true);
    const before = count();
    await recordPair(store, "סטיבן קינג", "Stephen King");
    assertEquals(count(), before - 1);
    const found = await store.find("en", nameKey("Stephen King"));
    assertEquals(found?.author_id, a);
    assertEquals(found?.names.map((n) => n.name).sort(), ["Stephen King", "סטיבן קינג"]);
    assertEquals(rows().filter((r) => r.author_id === b).length, 0);
  });

  Deno.test(`${label}: hebrewNames returns stored names, link first, without Wikidata`, async () => {
    const { store } = make();
    const id = await store.create();
    await store.addNames(id, [
      { lang: "en", name: "Alice Feeney", source: "link" },
      { lang: "he", name: "אליס פיני צליל", source: "sound" },
      { lang: "he", name: "אליס פיני וי", source: "wikidata" },
      { lang: "he", name: "אליס פיני", source: "link" },
    ]);
    let calls = 0;
    const deps = { wikidataHebrewAuthorStrict: () => (calls++, Promise.resolve("x")), now: () => T0 };
    assertEquals(await hebrewNames(store, "alice feeney", deps), [
      "אליס פיני",
      "אליס פיני וי",
      "אליס פיני צליל",
    ]);
    assertEquals(calls, 0);
  });

  Deno.test(`${label}: hebrewNames asks Wikidata once for an unknown name`, async () => {
    const { store, rows } = make();
    let calls = 0;
    const deps = { wikidataHebrewAuthorStrict: () => (calls++, Promise.resolve("ניל גיימן")), now: () => T0 };
    assertEquals(await hebrewNames(store, "Neil Gaiman", deps), ["ניל גיימן"]);
    assertEquals(calls, 1);
    assertEquals(rows().map((r) => `${r.lang}:${r.source}`).sort(), ["en:wikidata", "he:wikidata"]);
    assertEquals(await hebrewNames(store, "Neil Gaiman", deps), ["ניל גיימן"]);
    assertEquals(calls, 1);
  });

  Deno.test(`${label}: a null Wikidata answer is checked and retried after 30 days`, async () => {
    const { store } = make();
    let calls = 0;
    let now = T0;
    const deps = { wikidataHebrewAuthorStrict: () => (calls++, Promise.resolve(null)), now: () => now };
    assertEquals(await hebrewNames(store, "Nobody Known", deps), []);
    assertEquals(calls, 1);
    now = new Date(T0.getTime() + 29 * DAY);
    assertEquals(await hebrewNames(store, "Nobody Known", deps), []);
    assertEquals(calls, 1);
    now = new Date(T0.getTime() + 31 * DAY);
    assertEquals(await hebrewNames(store, "Nobody Known", deps), []);
    assertEquals(calls, 2);
  });

  Deno.test(`${label}: a Wikidata failure propagates and stores nothing`, async () => {
    const { store, rows, count } = make();
    const deps = {
      wikidataHebrewAuthorStrict: () => Promise.reject(new ProviderError("429")),
      now: () => T0,
    };
    await assertRejects(() => hebrewNames(store, "Neil Gaiman", deps), ProviderError);
    assertEquals(rows().length, 0);
    assertEquals(count(), 0);

    const id = await store.create();
    await store.addNames(id, [{ lang: "en", name: "Known Author", source: "link" }]);
    await assertRejects(() => hebrewNames(store, "Known Author", deps), ProviderError);
    assertEquals((await store.find("en", nameKey("Known Author")))?.wikidata_checked_at, null);
  });

  Deno.test(`${label}: englishNames mirrors hebrewNames`, async () => {
    const { store } = make();
    const id = await store.create();
    await store.addNames(id, [
      { lang: "he", name: "סטיבן קינג", source: "link" },
      { lang: "en", name: "Stephen King", source: "link" },
    ]);
    let calls = 0;
    const deps = { wikidataEnglishAuthorStrict: () => (calls++, Promise.resolve("Neil Gaiman")), now: () => T0 };
    assertEquals(await englishNames(store, "סטיבן קינג", deps), ["Stephen King"]);
    assertEquals(calls, 0);
    assertEquals(await englishNames(store, "ניל גיימן", deps), ["Neil Gaiman"]);
    assertEquals(calls, 1);
    assertEquals(await englishNames(store, "ניל גיימן", deps), ["Neil Gaiman"]);
    assertEquals(calls, 1);
  });
}

Deno.test("wikidataHebrewAuthor returns null where the strict lookup throws", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls += 1;
    return Promise.resolve(new Response("down", { status: 500 }));
  };
  try {
    await assertRejects(() => wikidataHebrewAuthorStrict("Neil Gaiman"), ProviderError);
    calls = 0;
    assertEquals(await wikidataHebrewAuthor("Neil Gaiman"), null);
    assertEquals(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});
