import { createClient } from "@supabase/supabase-js";
import type { VercelRequest } from "@vercel/node";

export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL as string;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY server env vars."
    );
  }

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function verifyUser(req: VercelRequest) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice("Bearer ".length);
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);

  if (error || !data.user) return null;
  return data.user;
}