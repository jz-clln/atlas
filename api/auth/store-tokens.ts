import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin, verifyUser } from "../_supabaseServer";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await verifyUser(req);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { provider_token, provider_refresh_token, expires_in } = req.body as {
    provider_token?: string;
    provider_refresh_token?: string;
    expires_in?: number;
  };

  if (!provider_token) {
    return res.status(400).json({ error: "Missing provider_token" });
  }

  const admin = supabaseAdmin();
  const expiresAt = new Date(
    Date.now() + (expires_in ?? 3600) * 1000
  ).toISOString();

  if (provider_refresh_token) {
    const { error } = await admin.from("google_tokens").upsert({
      user_id: user.id,
      access_token: provider_token,
      refresh_token: provider_refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    });
    if (error) return res.status(500).json({ error: error.message });
  } else {
    const { error } = await admin
      .from("google_tokens")
      .update({
        access_token: provider_token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);
    if (error) return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ ok: true });
}