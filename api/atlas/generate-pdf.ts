import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyUser } from "../_supabaseServer";
import { buildPdf } from "../_pdf";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const user = await verifyUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { title, content } = req.body as { title?: string; content?: string };
    if (!title || !content) {
      return res.status(400).json({ error: "Missing title or content" });
    }

    const pdfBytes = await buildPdf(title, content);

    res.setHeader("Content-Type", "application/pdf");
    return res.status(200).send(Buffer.from(pdfBytes));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}