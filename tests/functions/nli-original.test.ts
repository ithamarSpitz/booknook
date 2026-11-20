import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { nliHebrew, nliOriginal, ProviderError } from "../../supabase/functions/_shared/bridges.ts";

function sruResponse(recordsXml: string): string {
  return `<?xml version="1.0"?><searchRetrieveResponse><records>${recordsXml}</records></searchRetrieveResponse>`;
}

function parisApartmentRecord(): string {
  return `<record>
    <datafield tag="245"><subfield code="a">הדירה בפריז /</subfield></datafield>
    <datafield tag="100"><subfield code="a">פולי, לוסי</subfield></datafield>
    <datafield tag="240"><subfield code="a">Paris apartment.</subfield></datafield>
  </record>`;
}

function otherAcceptedRecord(): string {
  return `<record>
    <datafield tag="245"><subfield code="a">ספר בדיקה</subfield></datafield>
    <datafield tag="100"><subfield code="a">מחבר</subfield></datafield>
    <datafield tag="240"><subfield code="a">Test book</subfield></datafield>
  </record>`;
}

function versoRecord(
  hebrewTitle: string,
  versoTitle: string,
  versoAuthor: string,
  language = '<datafield tag="041"><subfield code="a">heb</subfield><subfield code="h">eng</subfield></datafield>',
  indication = "Title page verso:",
): string {
  return `<record>
    <datafield tag="245"><subfield code="a">${hebrewTitle} /</subfield></datafield>
    ${language}
    <datafield tag="246"><subfield code="i">${indication}</subfield><subfield code="a">${versoTitle} :</subfield><subfield code="b">${versoAuthor}</subfield></datafield>
  </record>`;
}

function queryFromUrl(url: string): string {
  return new URL(url).searchParams.get("query") ?? "";
}

Deno.test("nliOriginal searches by title and author surname first and stops when accepted", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = String(input);
    calls.push(url);
    return Promise.resolve(new Response(sruResponse(parisApartmentRecord()), { status: 200 }));
  };
  try {
    const result = await nliOriginal("הדירה בפריז", "לוסי פולי");
    assertEquals(calls.length, 1);
    assertEquals(
      queryFromUrl(calls[0]),
      'alma.title all "הדירה בפריז" AND alma.creator all "פולי"',
    );
    assertEquals(result, { title: "Paris apartment", author: "פולי, לוסי", source: "NLI" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("nliOriginal falls back to plain title when author search has no accepted record", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = String(input);
    calls.push(url);
    const query = queryFromUrl(url);
    const body = query.includes("alma.creator")
      ? sruResponse("")
      : sruResponse(otherAcceptedRecord());
    return Promise.resolve(new Response(body, { status: 200 }));
  };
  try {
    const result = await nliOriginal("ספר בדיקה", "מחבר כלשהו");
    assertEquals(calls.length, 2);
    assertEquals(queryFromUrl(calls[0]), 'alma.title all "ספר בדיקה" AND alma.creator all "כלשהו"');
    assertEquals(queryFromUrl(calls[1]), 'alma.title all "ספר בדיקה"');
    assertEquals(result, { title: "Test book", author: "מחבר", source: "NLI" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("nliOriginal with empty author uses only plain title search", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input) => {
    calls.push(String(input));
    return Promise.resolve(new Response(sruResponse(otherAcceptedRecord()), { status: 200 }));
  };
  try {
    await nliOriginal("ספר בדיקה", "");
    assertEquals(calls.length, 1);
    assertEquals(queryFromUrl(calls[0]), 'alma.title all "ספר בדיקה"');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("nliOriginal surname comes from text before first comma", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input) => {
    calls.push(String(input));
    return Promise.resolve(new Response(sruResponse(parisApartmentRecord()), { status: 200 }));
  };
  try {
    await nliOriginal("הדירה בפריז", "לוסי פולי, קטיה בנוביץ'");
    assertEquals(
      queryFromUrl(calls[0]),
      'alma.title all "הדירה בפריז" AND alma.creator all "פולי"',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("nliOriginal throws ProviderError on non-2xx response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response("error", { status: 503 }));
  try {
    await assertRejects(
      () => nliOriginal("הדירה בפריז", "לוסי פולי"),
      ProviderError,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("nliOriginal uses a title page verso candidate and returns its author", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(
    sruResponse(versoRecord("סודות", "Secrets", "Jacqueline Wilson")),
    { status: 200 },
  ));
  try {
    assertEquals(await nliOriginal("סודות"), {
      title: "Secrets",
      author: "",
      versoAuthor: "Jacqueline Wilson",
      source: "NLI",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("nliOriginal trims a title page verso author before credits", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(
    sruResponse(versoRecord("מסיבת פיג'מות", "Sleepovers", "Jacqueline Wilson ; illustrations, Nick Sharratt.")),
    { status: 200 },
  ));
  try {
    const result = await nliOriginal("מסיבת פיג'מות");
    assertEquals(result?.title, "Sleepovers");
    assertEquals(result?.versoAuthor, "Jacqueline Wilson");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("nliOriginal ignores title page verso without a translation language", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(
    sruResponse(versoRecord("תנו לגדול בשקט", "Leave them kids alone", "Liat Rotner", "")),
    { status: 200 },
  ));
  try {
    assertEquals(await nliOriginal("תנו לגדול בשקט"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("nliOriginal ignores title page verso when 041 h is heb", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(
    sruResponse(versoRecord(
      "סודות",
      "Secrets",
      "Jacqueline Wilson",
      '<datafield tag="041"><subfield code="h">heb</subfield></datafield>',
    )),
    { status: 200 },
  ));
  try {
    assertEquals(await nliOriginal("סודות"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("nliOriginal prefers 240 over a title page verso candidate", async () => {
  const record = versoRecord("ילדות רעות", "Verso title", "Verso Author").replace(
    '<datafield tag="245">',
    '<datafield tag="240"><subfield code="a">Bad girls.</subfield></datafield><datafield tag="245">',
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(sruResponse(record), { status: 200 }));
  try {
    assertEquals(await nliOriginal("ילדות רעות"), { title: "Bad girls", author: "", source: "NLI" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("nliOriginal ignores a parallel-title 246 field", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(
    sruResponse(versoRecord("סודות", "Secrets", "Jacqueline Wilson", undefined, "Parallel title:")),
    { status: 200 },
  ));
  try {
    assertEquals(await nliOriginal("סודות"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("nliOriginal scores the 245 main title without its subtitle", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(sruResponse(`<record>
    <datafield tag="245"><subfield code="a">טואיצ'י שלי :</subfield><subfield code="b">הסיפור שטרם סופר /</subfield></datafield>
    <datafield tag="041"><subfield code="a">heb</subfield><subfield code="h">eng</subfield></datafield>
    <datafield tag="100"><subfield code="a">גייל, קווין פ'</subfield></datafield>
    <datafield tag="240"><subfield code="a">Jungle - to the edge.</subfield><subfield code="l">Hebrew</subfield></datafield>
  </record>`), { status: 200 }));
  try {
    assertEquals((await nliOriginal("טואיצ'י שלי", "קווין פ' גייל"))?.title, "Jungle - to the edge");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("nliOriginal scores a short 245 main title", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(sruResponse(`<record>
    <datafield tag="245"><subfield code="a">מדהימות :</subfield><subfield code="b">[היופי הוא חיצוני בלבד] /</subfield></datafield>
    <datafield tag="240"><subfield code="a">Flawless.</subfield></datafield>
  </record>`), { status: 200 }));
  try {
    assertEquals((await nliOriginal("מדהימות"))?.title, "Flawless");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("nliOriginal scores a Hebrew 246 title", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(sruResponse(`<record>
    <datafield tag="245"><subfield code="a">WILD :</subfield><subfield code="b">מסע רגלי לגילוי עצמי /</subfield></datafield>
    <datafield tag="246"><subfield code="i">על המעטפת:</subfield><subfield code="a">הולכת רחוק</subfield></datafield>
    <datafield tag="240"><subfield code="a">Wild.</subfield></datafield>
  </record>`), { status: 200 }));
  try {
    assertEquals((await nliOriginal("הולכת רחוק"))?.title, "Wild");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("nliOriginal drops records when every Hebrew title form is below the threshold", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(sruResponse(`<record>
    <datafield tag="245"><subfield code="a">כותרת אחרת :</subfield><subfield code="b">כותרת משנה /</subfield></datafield>
    <datafield tag="246"><subfield code="a">שם חלופי אחר</subfield></datafield>
    <datafield tag="240"><subfield code="a">Different title.</subfield></datafield>
  </record>`), { status: 200 }));
  try {
    assertEquals(await nliOriginal("הספר המבוקש"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("nliOriginal does not score a Latin 246 title as a Hebrew title", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(sruResponse(`<record>
    <datafield tag="245"><subfield code="a">כותרת אחרת /</subfield></datafield>
    <datafield tag="246"><subfield code="a">Flawless /</subfield></datafield>
    <datafield tag="240"><subfield code="a">Different title.</subfield></datafield>
  </record>`), { status: 200 }));
  try {
    assertEquals(await nliOriginal("Flawless"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("nliHebrew finds a Hebrew record through its title page verso", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(
    sruResponse(versoRecord("סודות", "Secrets", "Jacqueline Wilson")),
    { status: 200 },
  ));
  try {
    assertEquals(await nliHebrew("Secrets", "Jacqueline Wilson"), {
      title: "סודות",
      author: "",
      source: "NLI",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
