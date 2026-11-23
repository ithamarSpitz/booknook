for (const t of ["Cloud Atlas", "Hamnet", "The Strange Case of Dr Jekyll and Mr Hyde", "Legends & Lattes", "Bossypants", "The Dead Zone"]) {
  const s = await (await fetch("https://www.wikidata.org/w/api.php?" + new URLSearchParams({ action: "wbsearchentities", search: t, language: "en", type: "item", limit: "3", format: "json" }), { headers: { "User-Agent": "booknook-check/1.0" } })).json();
  const ids = s.search.map((x: any) => x.id).join("|");
  const e = ids ? await (await fetch("https://www.wikidata.org/w/api.php?" + new URLSearchParams({ action: "wbgetentities", ids, props: "labels|descriptions", languages: "he|en", format: "json" }), { headers: { "User-Agent": "booknook-check/1.0" } })).json() : { entities: {} };
  console.log(t, "|", Object.values(e.entities).map((x: any) => `${x.labels?.he?.value ?? "-"} (${(x.descriptions?.en?.value ?? "").slice(0, 25)})`).join("; "));
  await new Promise((r) => setTimeout(r, 400));
}
