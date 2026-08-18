import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyUser } from "../_supabaseServer";
import { getValidAccessToken, fetchCourseWorkDetail } from "../_google";

// GET /api/classroom/task?courseId=...&courseWorkId=...
//
// Fetches full live detail (description, materials, maxPoints, etc.) for a
// single piece of coursework directly from Google, bypassing Supabase.
// Intended for Phase 3's assistant chat: "explain this assignment" should
// always reflect what's on Classroom right now, not just whatever was there
// at last sync.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const user = await verifyUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { courseId, courseWorkId } = req.query;

    if (typeof courseId !== "string" || typeof courseWorkId !== "string") {
      return res
        .status(400)
        .json({ error: "courseId and courseWorkId are required query params" });
    }

    const accessToken = await getValidAccessToken(user.id);
    const task = await fetchCourseWorkDetail(courseId, courseWorkId, accessToken);

    return res.status(200).json({ task });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}