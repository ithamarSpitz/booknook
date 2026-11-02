import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { nliOriginal, ProviderError } from "../../supabase/functions/_shared/bridges.ts";

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
