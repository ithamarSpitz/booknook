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

export type ProviderRetry = { timeoutMs: number; pauseMs: number };
let providerRetry: ProviderRetry | null = null;

/** Opt-in (scripts only): retry an idempotent request once after a timeout abort or HTTP 5xx. */
export function setProviderRetry(policy: ProviderRetry | null): void {
  providerRetry = policy;
}

export function getProviderRetry(): ProviderRetry | null {
  return providerRetry;
}

/** fetchTimeout plus the optional one-shot retry policy. Do not use for non-idempotent or Hardcover calls. */
export async function fetchRetry(url: string, init: RequestInit = {}, timeoutMs = 12000): Promise<Response> {
  const policy = providerRetry;
  if (!policy) return await fetchTimeout(url, init, timeoutMs);
  let response: Response;
  try {
    response = await fetchTimeout(url, init, timeoutMs);
  } catch (error) {
    if ((error as { name?: string })?.name !== "AbortError") throw error;
    await new Promise((resolve) => setTimeout(resolve, policy.pauseMs));
    return await fetchTimeout(url, init, policy.timeoutMs);
  }
  if (response.status < 500) return response;
  await response.body?.cancel();
  await new Promise((resolve) => setTimeout(resolve, policy.pauseMs));
  return await fetchTimeout(url, init, policy.timeoutMs);
}

export function stripHebrewPoints(value: string): string {
  return value.replace(/[\u0591-\u05c7]/g, (character) =>
    character === "\u05be" ? " " : ""
  );
}

export function normalize(value: unknown): string {
  return stripHebrewPoints(String(value ?? ""))
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

