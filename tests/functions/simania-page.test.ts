import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  fetchSimaniaPage,
  pageOriginalTitle,
  simaniaPageUrl,
} from "../../scripts/lib/simania-page.ts";

function fixture(name: string): Promise<string> {
  return Deno.readTextFile(new URL(`./fixtures/simania-page/${name}`, import.meta.url));
}

// The ltr element as it appears in the page's escaped React payload.
function ltrPayload(text: string): string {
  return String.raw`<html><body>[\"$\",\"h1\",null,{\"children\":\"כותרת\"}],\"$undefined\",` +
    String.raw`[\"$\",\"div\",null,{\"className\":\"text-base\",\"style\":{\"direction\":\"ltr\"},\"children\":\"` +
    text + String.raw`\"}]</body></html>`;
}

// A plain JSON-LD script with an alternativeHeadline.
function jsonLd(headline: string): string {
  return `<script type="application/ld+json">${
    JSON.stringify({ "@type": "Book", name: "ספר", alternativeHeadline: headline })
  }</script>`;
}

Deno.test("pageOriginalTitle reads the ltr element after the title", async () => {
  assertEquals(pageOriginalTitle(await fixture("905132.html")), "Under the Dome");
});

Deno.test("pageOriginalTitle cuts a trailing companion title", async () => {
  assertEquals(pageOriginalTitle(await fixture("1026572.html")), "The Housemaid is Watching");
});

Deno.test("pageOriginalTitle reads the JSON-LD alternativeHeadline", async () => {
  assertEquals(pageOriginalTitle(await fixture("1024649.html")), "Margo's Got Money Troubles");
});

Deno.test("pageOriginalTitle returns null for a Hebrew original", async () => {
  assertEquals(pageOriginalTitle(await fixture("659042.html")), null);
});

Deno.test("pageOriginalTitle trims leading and trailing spaces", () => {
  assertEquals(pageOriginalTitle(ltrPayload(" The Coworker ")), "The Coworker");
  assertEquals(pageOriginalTitle(jsonLd("  The Coworker ")), "The Coworker");
});

Deno.test("pageOriginalTitle keeps a typographic apostrophe", () => {
  const title = "An Ancient Witch’s Guide To Modern Dating";
  assertEquals(pageOriginalTitle(jsonLd(title)), title);
  assertEquals(pageOriginalTitle(ltrPayload(title)), title);
});

Deno.test("pageOriginalTitle unescapes the payload value", () => {
  assertEquals(
    pageOriginalTitle(ltrPayload(String.raw`The \\\"Quoted\\\" Book & Co`)),
    'The "Quoted" Book & Co',
  );
});

Deno.test("pageOriginalTitle returns null for a value with Hebrew letters", () => {
  assertEquals(pageOriginalTitle(ltrPayload("Book ספר")), null);
  assertEquals(pageOriginalTitle(jsonLd("Book ספר")), null);
});

Deno.test("pageOriginalTitle returns null without Latin letters or a source", () => {
  assertEquals(pageOriginalTitle(ltrPayload("1984")), null);
  assertEquals(pageOriginalTitle("<html><body>nothing here</body></html>"), null);
});

Deno.test("simaniaPageUrl builds the book page URL", () => {
  assertEquals(simaniaPageUrl(905132), "https://simania.co.il/bookdetails.php?item_id=905132");
});

Deno.test("fetchSimaniaPage requests the page with a browser User-Agent", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fakeFetch: typeof fetch = (input, init) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(new Response("<html>page</html>", { status: 200 }));
  };
  const html = await fetchSimaniaPage(905132, fakeFetch);
  assertEquals(html, "<html>page</html>");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "https://simania.co.il/bookdetails.php?item_id=905132");
  assertEquals(calls[0].init?.method ?? "GET", "GET");
  const userAgent = new Headers(calls[0].init?.headers).get("User-Agent") ?? "";
  assertEquals(userAgent.startsWith("Mozilla/5.0"), true);
  assertEquals(calls[0].init?.signal instanceof AbortSignal, true);
});

Deno.test("fetchSimaniaPage throws on a non-2xx status", async () => {
  const fakeFetch: typeof fetch = () => Promise.resolve(new Response("gone", { status: 404 }));
  await assertRejects(() => fetchSimaniaPage(1, fakeFetch), Error, "404");
});
