import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyUser } from "../_supabaseServer";
import { synthesizeSpeech } from "../_elevenlabs";

// Default Vercel function timeout is 10s. ElevenLabs can take longer than
// that to finish generating audio for a longer reply, which was cutting
// playback off mid-sentence once Vercel killed the function. Raising this
// gives it room to actually finish.
export const config = {
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const user = await verifyUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { text } = req.body as { text?: string };
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Missing text" });
    }

    const audio = await synthesizeSpeech(text);

    res.setHeader("Content-Type", "audio/mpeg");
    return res.status(200).send(Buffer.from(audio));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}