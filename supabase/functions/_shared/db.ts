import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { HttpError } from "./utils.ts";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new HttpError(500, `${name} is not configured.`);
  return value;
}

export function serviceClient(): SupabaseClient {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export function userClient(req: Request): SupabaseClient {
  const authorization = req.headers.get("Authorization") ?? "";
  return createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_ANON_KEY"),
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authorization } },
    },
  );
}

export async function requireUser(req: Request): Promise<string> {
  if (!req.headers.get("Authorization")) throw new HttpError(401, "Authentication required.");
  const { data, error } = await userClient(req).auth.getUser();
  if (error || !data.user) throw new HttpError(401, "Authentication required.");
  return data.user.id;
}
