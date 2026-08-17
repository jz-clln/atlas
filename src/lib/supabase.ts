import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase env vars. Copy .env.example to .env.local and fill in your project's URL and anon key."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Scopes requested from Google at sign-in.
 * Phase 1: read-only Classroom access only.
 * The write scope for submitting coursework is deliberately NOT
 * requested here — that gets added in Phase 7, with its own
 * explicit consent step, to keep the token's blast radius small
 * while the rest of the app is still being built and tested.
 */
const CLASSROOM_SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
  "https://www.googleapis.com/auth/classroom.announcements.readonly",
].join(" ");

export async function signInWithGoogleClassroom() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      scopes: CLASSROOM_SCOPES,
      // offline access -> refresh token, so we're not forcing
      // a re-login every hour once the token expires
      // consent (not "select_account") -> ensures Google actually
      // issues a refresh token, which it only does on first consent
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
      redirectTo: `${window.location.origin}/dashboard`,
    },
  });

  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
