// Reads the original (Latin) title of a translated book from its Simania book page.
// Parsing is pure; only fetchSimaniaPage touches the network.

const SIMANIA_PAGE_BASE = "https://simania.co.il/bookdetails.php?item_id=";
const FETCH_TIMEOUT_MS = 20_000;
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Longest stretch of the escaped payload decoded after a marker.
const DECODE_WINDOW = 4000;

const LATIN_LETTER = /[A-Za-zÀ-ɏ]/;
const HEBREW_LETTER = /[֐-׿]/;

interface Source {
  // Marker as it appears in the page's escaped React payload (one escaping layer).
  escapedMarker: string;
  // Pattern for the unescaped form; group 1 is the JSON string body of the value.
  pattern: RegExp;
}

const SOURCES: Source[] = [
  {
    escapedMarker: String.raw`\"alternativeHeadline\"`,
    pattern: /"alternativeHeadline"\s*:\s*"((?:[^"\\]|\\.)*)"/,
  },
  {
    escapedMarker: String.raw`\"direction\":\"ltr\"},\"children\":\"`,
    pattern: /"direction"\s*:\s*"ltr"\s*\}\s*,\s*"children"\s*:\s*"((?:[^"\\]|\\.)*)"/,
  },
];

// The Latin original title Simania shows for a translated edition, or null.
export function pageOriginalTitle(html: string): string | null {
  for (const source of SOURCES) {
    const raw = readSource(html, source);
    if (raw === null) continue;
    const title = cleanTitle(raw);
    if (title !== null) return title;
  }
  return null;
}

export function simaniaPageUrl(id: number): string {
  return `${SIMANIA_PAGE_BASE}${id}`;
}

export async function fetchSimaniaPage(
  id: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = simaniaPageUrl(id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { "User-Agent": BROWSER_USER_AGENT },
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Simania page ${id} returned HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function readSource(html: string, source: Source): string | null {
  // Unescaped form (for example a plain JSON-LD script).
  const direct = source.pattern.exec(html);
  if (direct) return parseJsonString(direct[1]);

  // Escaped form inside the React payload: decode one layer, then match.
  const index = html.indexOf(source.escapedMarker);
  if (index < 0) return null;
  const decoded = decodeLayer(html.slice(index, index + DECODE_WINDOW));
  const match = source.pattern.exec(decoded);
  if (!match || match.index !== 0) return null;
  return parseJsonString(match[1]);
}

// Decodes JSON string escapes until the first unescaped quote (end of the outer string).
function decodeLayer(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') break;
    if (c !== "\\") {
      out += c;
      continue;
    }
    const next = text[++i];
    if (next === undefined) break;
    switch (next) {
      case "n":
        out += "\n";
        break;
      case "t":
        out += "\t";
        break;
      case "r":
        out += "\r";
        break;
      case "b":
        out += "\b";
        break;
      case "f":
        out += "\f";
        break;
      case "u": {
        const hex = text.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else {
          out += "u";
        }
        break;
      }
      default:
        out += next;
    }
  }
  return out;
}

function parseJsonString(body: string): string | null {
  try {
    const value = JSON.parse(`"${body}"`);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function cleanTitle(value: string): string | null {
  let title = value.trim();
  const companion = title.indexOf(" + ");
  if (companion >= 0) title = title.slice(0, companion).trim();
  if (!LATIN_LETTER.test(title) || HEBREW_LETTER.test(title)) return null;
  return title;
}
