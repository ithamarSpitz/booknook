import { wikidataEnglishAuthorStrict, wikidataHebrewAuthorStrict } from "./bridges.ts";
import { nameSoundScore } from "./names.ts";
import type { AuthorNameRow } from "./types.ts";
import { normalize, stripHebrewPoints } from "./utils.ts";
import type { CatalogDb } from "./catalog.ts";

export type AuthorLang = "en" | "he";
export type NewAuthorName = { lang: AuthorLang; name: string; source: "link" | "wikidata" | "sound" };
export type FoundAuthor = {
  author_id: string;
  wikidata_checked_at: string | null;
  sound_checked_at: string | null;
  names: AuthorNameRow[];
};

export interface AuthorStore {
  find(lang: AuthorLang, key: string): Promise<FoundAuthor | null>;
  create(): Promise<string>;
  /** Skips `(lang, name_key)` pairs that already exist. */
  addNames(authorId: string, names: NewAuthorName[]): Promise<void>;
  /** Moves the dropped author's names to `keepId` and deletes the dropped author. */
  merge(keepId: string, dropId: string): Promise<void>;
  markWikidataChecked(authorId: string, at: Date): Promise<void>;
  markSoundChecked(authorId: string, at: Date): Promise<void>;
}

const THIRTY_DAYS = 30 * 86_400_000;
const MIN_SOUND = 0.8;

export function nameKey(name: string): string {
  return normalize(stripHebrewPoints(name)).replace(/\s+/g, " ").trim();
}

function check<T>(result: { data: T; error: { message?: string } | null }): T {
  if (result.error) throw new Error(result.error.message ?? "authors query failed");
  return result.data;
}

export function catalogAuthorStore(db: CatalogDb): AuthorStore {
  return {
    async find(lang, key) {
      const hit = check(await db.from("author_names").select("*").eq("lang", lang).eq("name_key", key)) as
        | AuthorNameRow[]
        | null;
      const authorId = hit?.[0]?.author_id;
      if (!authorId) return null;
      const names = check(await db.from("author_names").select("*").eq("author_id", authorId)) as AuthorNameRow[];
      const authorRows = check(
        await db.from("authors").select("id, wikidata_checked_at, sound_checked_at").eq("id", authorId),
      ) as
        | Array<{ wikidata_checked_at: string | null; sound_checked_at: string | null }>
        | null;
      return {
        author_id: authorId,
        wikidata_checked_at: authorRows?.[0]?.wikidata_checked_at ?? null,
        sound_checked_at: authorRows?.[0]?.sound_checked_at ?? null,
        names: names ?? [],
      };
    },
    async create() {
      const id = crypto.randomUUID();
      check(await db.from("authors").insert({ id }));
      return id;
    },
    async addNames(authorId, names) {
      const fresh = new Map<string, NewAuthorName & { key: string }>();
      for (const entry of names) {
        const key = nameKey(entry.name);
        if (key && !fresh.has(`${entry.lang}|${key}`)) fresh.set(`${entry.lang}|${key}`, { ...entry, key });
      }
      const rows: Array<Record<string, string>> = [];
      for (const lang of ["en", "he"] as const) {
        const wanted = [...fresh.values()].filter((entry) => entry.lang === lang);
        if (!wanted.length) continue;
        const existing = (check(
          await db.from("author_names").select("name_key").eq("lang", lang).in("name_key", wanted.map((e) => e.key)),
        ) ?? []) as Array<{ name_key: string }>;
        const taken = new Set(existing.map((row) => row.name_key));
        for (const entry of wanted) {
          if (!taken.has(entry.key)) {
            rows.push({ author_id: authorId, lang, name: entry.name, name_key: entry.key, source: entry.source });
          }
        }
      }
      if (rows.length) check(await db.from("author_names").insert(rows));
    },
    async merge(keepId, dropId) {
      if (keepId === dropId) return;
      check(await db.from("author_names").update({ author_id: keepId }).eq("author_id", dropId));
      check(await db.from("authors").delete().eq("id", dropId));
    },
    async markWikidataChecked(authorId, at) {
      check(await db.from("authors").update({ wikidata_checked_at: at.toISOString() }).eq("id", authorId));
    },
    async markSoundChecked(authorId, at) {
      check(
        await db.from("authors").update({ sound_checked_at: at.toISOString() })
          .eq("id", authorId),
      );
    },
  };
}

/** Stores a linked (Hebrew, English) author pair when the names sound alike. */
export async function recordPair(store: AuthorStore, he: string, en: string): Promise<void> {
  const heKey = nameKey(he ?? "");
  const enKey = nameKey(en ?? "");
  if (!heKey || !enKey) return;
  if (nameSoundScore(he, [en]) < MIN_SOUND) return;
  const byEn = await store.find("en", enKey);
  const byHe = await store.find("he", heKey);
  const names: NewAuthorName[] = [
    { lang: "he", name: he.trim(), source: "link" },
    { lang: "en", name: en.trim(), source: "link" },
  ];
  if (byEn && byHe) {
    if (byEn.author_id !== byHe.author_id) await store.merge(byEn.author_id, byHe.author_id);
    return;
  }
  if (byEn || byHe) {
    await store.addNames((byEn ?? byHe)!.author_id, names);
    return;
  }
  const id = await store.create();
  await store.addNames(id, names);
}

async function namesFor(
  store: AuthorStore,
  fromLang: AuthorLang,
  from: string,
  lookup: (name: string) => Promise<string | null>,
  now: () => Date,
): Promise<string[]> {
  const toLang: AuthorLang = fromLang === "en" ? "he" : "en";
  const key = nameKey(from ?? "");
  if (!key) return [];
  const found = await store.find(fromLang, key);
  if (found) {
    const stored = found.names
      .filter((row) => row.lang === toLang)
      .sort((a, b) => sourceRank(a.source) - sourceRank(b.source))
      .map((row) => row.name);
    if (stored.length) return stored;
    if (found.wikidata_checked_at) {
      const age = now().getTime() - new Date(found.wikidata_checked_at).getTime();
      if (age < THIRTY_DAYS) return [];
    }
  }
  // A provider failure throws here, before anything is stored.
  const answer = (await lookup(from.trim()))?.trim() || null;
  const authorId = found?.author_id ?? await store.create();
  if (!found) await store.addNames(authorId, [{ lang: fromLang, name: from.trim(), source: "wikidata" }]);
  if (answer) await store.addNames(authorId, [{ lang: toLang, name: answer, source: "wikidata" }]);
  await store.markWikidataChecked(authorId, now());
  return answer ? [answer] : [];
}

function sourceRank(source: AuthorNameRow["source"]): number {
  return source === "link" ? 0 : source === "wikidata" ? 1 : 2;
}

export async function soundNames(
  store: AuthorStore,
  en: string,
  lookup: (name: string) => Promise<string | null>,
  now: () => Date,
): Promise<string[]> {
  const key = nameKey(en ?? "");
  if (!key) return [];
  const found = await store.find("en", key);
  if (found) {
    const stored = found.names
      .filter((row) => row.lang === "he")
      .sort((a, b) => sourceRank(a.source) - sourceRank(b.source))
      .map((row) => row.name);
    if (stored.length) return stored;
    if (found.sound_checked_at) {
      const age = now().getTime() - new Date(found.sound_checked_at).getTime();
      if (age < THIRTY_DAYS) return [];
    }
  }
  // A provider failure throws here, before anything is stored.
  const answer = (await lookup(en.trim()))?.trim() || null;
  const checkedAt = now();
  const authorId = found?.author_id ?? await store.create();
  if (!found) {
    await store.addNames(authorId, [{
      lang: "en",
      name: en.trim(),
      source: "wikidata",
    }]);
  }
  if (answer) {
    await store.addNames(authorId, [{
      lang: "he",
      name: answer,
      source: "sound",
    }]);
  }
  await store.markSoundChecked(authorId, checkedAt);
  return answer ? [answer] : [];
}

export async function hebrewNames(
  store: AuthorStore,
  en: string,
  deps: { wikidataHebrewAuthorStrict: (name: string) => Promise<string | null>; now: () => Date } = {
    wikidataHebrewAuthorStrict,
    now: () => new Date(),
  },
): Promise<string[]> {
  return await namesFor(store, "en", en, deps.wikidataHebrewAuthorStrict, deps.now);
}

export async function englishNames(
  store: AuthorStore,
  he: string,
  deps: { wikidataEnglishAuthorStrict: (name: string) => Promise<string | null>; now: () => Date } = {
    wikidataEnglishAuthorStrict,
    now: () => new Date(),
  },
): Promise<string[]> {
  return await namesFor(store, "he", he, deps.wikidataEnglishAuthorStrict, deps.now);
}
