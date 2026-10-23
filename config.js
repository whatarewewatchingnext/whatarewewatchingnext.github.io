// Public Supabase settings. The publishable key is designed to be public:
// row-level security in supabase/schema.sql is what keeps your data private.
// Never put a secret (sb_secret_...) or service_role key here.
export const SUPABASE_URL = "";
export const SUPABASE_KEY = "";

// Usernames are turned into this pseudo-email for Supabase Auth.
// No mail is ever sent (email confirmation is turned off).
export const USERNAME_EMAIL_DOMAIN = "users.whatarewewatchingnext.app";

// Free TMDB "API Key" (v3) from https://www.themoviedb.org/settings/api, for posters,
// trending titles and search. Leave empty to use a small built-in list instead.
// It ships to every browser, so it is a read-only key, but treat it as semi-public.
export const TMDB_KEY = "";

// Optional: ISO 3166 country for "now playing" and TMDB results (e.g. "IN", "US").
export const TMDB_REGION = "";
