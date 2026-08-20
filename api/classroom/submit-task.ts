import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyUser } from "../_supabaseServer.js";
import {
  getValidAccessToken,
  fetchStudentSubmission,
  uploadFileToDrive,
  createGoogleDocFromText,
  attachDriveFileToSubmission,
  turnInSubmission,
} from "../_google.js";

// POST /api/classroom/submit-task
// Body (file mode): { courseId, courseWorkId, mode: "file", fileName, mimeType, fileBase64 }
// Body (text mode): { courseId, courseWorkId, mode: "text", textAnswer }
//
// File mode uploads directly to Drive. Text mode wraps the typed answer in
// a Google Doc first (see createGoogleDocFromText in _google.ts), since
// ASSIGNMENT-type coursework has no bare-text submission field — only file
// attachments. Either way, the result gets attached to the submission and
// turned in. All Classroom/Drive calls happen server-side so the access
// token never reaches the browser.
//
// NOTE on size: Vercel serverless functions cap the request body around
// 4.5MB by default. Base64 adds ~33% overhead on top of the raw file size,
// so a photo needs to be compressed/resized client-side before this call —
// budget for roughly a 3MB original file as a safe ceiling. Text mode has
// no such concern since it's just a string.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const user = await verifyUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { courseId, courseWorkId, mode, fileName, mimeType, fileBase64, textAnswer } =
      req.body as {
        courseId?: string;
        courseWorkId?: string;
        mode?: "file" | "text";
        fileName?: string;
        mimeType?: string;
        fileBase64?: string;
        textAnswer?: string;
      };

    if (!courseId || !courseWorkId) {
      return res.status(400).json({ error: "courseId and courseWorkId are required" });
    }

    if (mode === "file" && (!fileName || !mimeType || !fileBase64)) {
      return res.status(400).json({
        error: "fileName, mimeType, and fileBase64 are required when mode is 'file'",
      });
    }

    if (mode === "text" && !textAnswer?.trim()) {
      return res.status(400).json({ error: "textAnswer is required when mode is 'text'" });
    }

    if (mode !== "file" && mode !== "text") {
      return res.status(400).json({ error: "mode must be 'file' or 'text'" });
    }

    const accessToken = await getValidAccessToken(user.id);

    const submission = await fetchStudentSubmission(courseId, courseWorkId, accessToken);
    if (!submission) {
      return res.status(404).json({ error: "No submission found for this task" });
    }

    if (submission.state === "TURNED_IN" || submission.state === "RETURNED") {
      return res.status(409).json({
        error: "Already turned in — reclaim it first if you want to resubmit.",
      });
    }

    const driveFile =
      mode === "file"
        ? await uploadFileToDrive(accessToken, fileName!, mimeType!, fileBase64!)
        : await createGoogleDocFromText(accessToken, "Answer", textAnswer!);

    await attachDriveFileToSubmission(
      courseId,
      courseWorkId,
      submission.id,
      driveFile.id,
      accessToken
    );
    await turnInSubmission(courseId, courseWorkId, submission.id, accessToken);

    return res.status(200).json({ ok: true, submissionId: submission.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}