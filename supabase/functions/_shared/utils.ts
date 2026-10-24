export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: corsHeaders });
}

export function options(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders }) : null;
}

export async function body<T>(req: Request): Promise<T> {
  if (req.method !== "POST") throw new HttpError(405, "POST is required.");
  try {
    return await req.json() as T;
  } catch {
    throw new HttpError(400, "The request body must be valid JSON.");
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function errorResponse(error: unknown): Response {
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  console.error(error);
  return json({ error: message }, status);
}

export async function fetchTimeout(url: string, init: RequestInit = {}, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function similarity(a: unknown, b: unknown): number {
  const aa = new Set(normalize(a).split(/\s+/).filter(Boolean));
  const bb = new Set(normalize(b).split(/\s+/).filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const word of aa) if (bb.has(word)) common++;
  return (2 * common) / (aa.size + bb.size);
}

