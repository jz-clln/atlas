import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyUser } from "../_supabaseServer.js";
import { getValidAccessToken, fetchStudentSubmission, reclaimSubmission } from "../_google.js";

// POST /api/classroom/reclaim-task
// Body: { courseId, courseWorkId }
//
// The undo button for submit-task.ts — pulls a submission back from
// "turned in" so a mistaken or premature submit isn't permanent.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const user = await verifyUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { courseId, courseWorkId } = req.body as {
      courseId?: string;
      courseWorkId?: string;
    };

    if (!courseId || !courseWorkId) {
      return res.status(400).json({ error: "courseId and courseWorkId are required" });
    }

    const accessToken = await getValidAccessToken(user.id);

    const submission = await fetchStudentSubmission(courseId, courseWorkId, accessToken);
    if (!submission) {
      return res.status(404).json({ error: "No submission found for this task" });
    }

    await reclaimSubmission(courseId, courseWorkId, submission.id, accessToken);

    return res.status(200).json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}