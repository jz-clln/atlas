import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyUser } from "../_supabaseServer.js";
import {
  getValidAccessToken,
  fetchCourseWorkDetail,
  fetchStudentSubmission,
  uploadFilesToDrive,
  createGoogleDocFromText,
  submitShortAnswer,
  attachDriveFilesToSubmission,
  turnInSubmission,
} from "../_google.js";

// POST /api/classroom/submit-task
// Body (file mode):  { courseId, courseWorkId, mode: "file", files: [{ fileName, mimeType, fileBase64 }, ...] }
// Body (text mode):  { courseId, courseWorkId, mode: "text", textAnswer }
//
// `files` replaces the old single fileName/mimeType/fileBase64 trio (Phase 2)
// so a submission can carry more than one attachment — Classroom itself has
// always supported multiple attachments per submission, the old one-file
// limit was purely this endpoint only ever uploading and attaching one.
//
// The server does not trust `mode` alone to decide how a submission gets
// written to Classroom — it looks up the coursework's real workType first:
//   - SHORT_ANSWER_QUESTION -> textAnswer goes straight into Classroom's
//     shortAnswerSubmission field. No Drive upload, no Google Doc, no files
//     at all — this type doesn't support attachments.
//   - anything else (treated as ASSIGNMENT) -> real files go to Drive as-is
//     (one or many); typed text gets wrapped in a single Google Doc, because
//     ASSIGNMENT-type submissions only accept file/link/video attachments,
//     not bare text.
// Either path ends the same way: attach (if needed) and turn in.
//
// NOTE on size: Vercel serverless functions cap the request body around
// 4.5MB by default. Base64 adds ~33% overhead on top of raw file size, and
// that cap is shared across ALL files in one request now, not just one photo.
// MAX_TOTAL_BASE64_CHARS below is a soft guard so a too-large batch fails
// with a clear message instead of a confusing platform-level request error.
const MAX_TOTAL_BASE64_CHARS = 4_000_000; // ~3MB of real files, combined

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const user = await verifyUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { courseId, courseWorkId, mode, files, textAnswer } = req.body as {
      courseId?: string;
      courseWorkId?: string;
      mode?: "file" | "text";
      files?: { fileName?: string; mimeType?: string; fileBase64?: string }[];
      textAnswer?: string;
    };

    if (!courseId || !courseWorkId) {
      return res.status(400).json({ error: "courseId and courseWorkId are required" });
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

    // Determined server-side, never trusted from the client.
    const courseWork = await fetchCourseWorkDetail(courseId, courseWorkId, accessToken);
    const isShortAnswer = courseWork.workType === "SHORT_ANSWER_QUESTION";

    if (isShortAnswer) {
      if (!textAnswer?.trim()) {
        return res.status(400).json({
          error: "textAnswer is required for a short-answer question",
        });
      }

      await submitShortAnswer(courseId, courseWorkId, submission.id, textAnswer, accessToken);
      await turnInSubmission(courseId, courseWorkId, submission.id, accessToken);

      return res.status(200).json({ ok: true, submissionId: submission.id });
    }

    // --- ASSIGNMENT-type path ---

    if (mode === "text" && !textAnswer?.trim()) {
      return res.status(400).json({ error: "textAnswer is required when mode is 'text'" });
    }

    if (mode === "file") {
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "At least one file is required when mode is 'file'" });
      }

      for (const f of files) {
        if (!f.fileName || !f.mimeType || !f.fileBase64) {
          return res.status(400).json({
            error: "Each file needs a fileName, mimeType, and fileBase64",
          });
        }
      }

      const totalBase64Chars = files.reduce((sum, f) => sum + (f.fileBase64?.length ?? 0), 0);
      if (totalBase64Chars > MAX_TOTAL_BASE64_CHARS) {
        return res.status(413).json({
          error: "These files are too large combined — try fewer files or smaller photos.",
        });
      }
    }

    if (mode !== "file" && mode !== "text") {
      return res.status(400).json({ error: "mode must be 'file' or 'text'" });
    }

    const driveFileIds: string[] =
      mode === "file"
        ? (
            await uploadFilesToDrive(
              accessToken,
              files!.map((f) => ({
                fileName: f.fileName!,
                mimeType: f.mimeType!,
                base64Data: f.fileBase64!,
              }))
            )
          ).map((f) => f.id)
        : [(await createGoogleDocFromText(accessToken, "Answer", textAnswer!)).id];

    await attachDriveFilesToSubmission(
      courseId,
      courseWorkId,
      submission.id,
      driveFileIds,
      accessToken
    );
    await turnInSubmission(courseId, courseWorkId, submission.id, accessToken);

    return res.status(200).json({ ok: true, submissionId: submission.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}