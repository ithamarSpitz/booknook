import type { Sql } from "npm:postgres@3.4.5";
import {
  type AuthorStore,
  nameKey,
  type NewAuthorName,
} from "../../supabase/functions/_shared/authors.ts";
import type { AuthorNameRow } from "../../supabase/functions/_shared/types.ts";

/** `AuthorStore` over a `postgres` connection, for operator scripts. */
export function sqlAuthorStore(sql: Sql): AuthorStore {
  return {
    async find(lang, key) {
      const hit = await sql<{ author_id: string }[]>`
        select author_id from public.author_names where lang = ${lang} and name_key = ${key}
      `;
      const authorId = hit[0]?.author_id;
      if (!authorId) return null;
      const names = await sql<AuthorNameRow[]>`
        select author_id, lang, name, name_key, source from public.author_names
        where author_id = ${authorId}
      `;
      const author = await sql<{ wikidata_checked_at: Date | string | null }[]>`
        select wikidata_checked_at from public.authors where id = ${authorId}
      `;
      const checked = author[0]?.wikidata_checked_at ?? null;
      return {
        author_id: authorId,
        wikidata_checked_at: checked === null ? null : new Date(checked).toISOString(),
        names: [...names],
      };
    },
    async create() {
      const rows = await sql<{ id: string }[]>`insert into public.authors default values returning id`;
      return rows[0].id;
    },
    async addNames(authorId: string, names: NewAuthorName[]) {
      const seen = new Set<string>();
      for (const entry of names) {
        const key = nameKey(entry.name);
        if (!key || seen.has(`${entry.lang}|${key}`)) continue;
        seen.add(`${entry.lang}|${key}`);
        await sql`
          insert into public.author_names (author_id, lang, name, name_key, source)
          values (${authorId}, ${entry.lang}, ${entry.name}, ${key}, ${entry.source})
          on conflict (lang, name_key) do nothing
        `;
      }
    },
    async merge(keepId, dropId) {
      if (keepId === dropId) return;
      await sql.begin(async (tx) => {
        await tx`update public.author_names set author_id = ${keepId} where author_id = ${dropId}`;
        await tx`delete from public.authors where id = ${dropId}`;
      });
    },
    async markWikidataChecked(authorId, at) {
      await sql`update public.authors set wikidata_checked_at = ${at.toISOString()} where id = ${authorId}`;
    },
  };
}
