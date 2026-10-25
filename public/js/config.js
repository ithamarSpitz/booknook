const isLocal =
  location.hostname === "localhost" || location.hostname === "127.0.0.1";

// --- OPERATOR: production Supabase (anon key is public by design; never put the service-role key here) ---
const PRODUCTION_SUPABASE_URL = "https://zheosjpootcwvuazwjzh.supabase.co";
const PRODUCTION_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoZW9zanBvb3Rjd3Z1YXp3anpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5MTU4MzcsImV4cCI6MjEwODQ5MTgzN30.XFICFLqnrR5d0vYXzNefwepbjSAx2bIiwVtgAonulW0";

const localSupabaseUrl = "http://127.0.0.1:54321";
const localAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const supabaseUrl = isLocal ? localSupabaseUrl : PRODUCTION_SUPABASE_URL;
const supabaseAnonKey = isLocal ? localAnonKey : PRODUCTION_SUPABASE_ANON_KEY;

/** Supabase project URL (`npx supabase status -o env` when developing locally). */
export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_ANON_KEY = supabaseAnonKey;
export const FUNCTIONS_URL = `${supabaseUrl}/functions/v1`;
