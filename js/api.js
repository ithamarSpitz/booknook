import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, FUNCTIONS_URL } from "./config.js?v=b90e49c";

let client;

/** @returns {import('@supabase/supabase-js').SupabaseClient} */
export function getClient() {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return client;
}

export async function getSession() {
  const {
    data: { session },
  } = await getClient().auth.getSession();
  return session;
}

/**
 * @param {string} name Edge function name (see `FUNCTIONS` in contract.js)
 * @param {Record<string, unknown>} body
 */
export async function callFunction(name, body) {
  const session = await getSession();
  const token = session?.access_token || SUPABASE_ANON_KEY;
  const headers = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
  };
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof json.error === "string" ? json.error : `שגיאה (${res.status})`;
    throw new Error(msg);
  }
  return json;
}
