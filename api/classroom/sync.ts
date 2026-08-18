import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin, verifyUser } from "../_supabaseServer";
import {
  getValidAccessToken,
  fetchCourses,
  fetchCourseWork,
  fetchSubmissionState,
  combineDueDateTime,
} from "../_google";

const DONE_STATES = new Set(["TURNED_IN", "RETURNED"]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const user = await verifyUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const accessToken = await getValidAccessToken(user.id);
    const admin = supabaseAdmin();

    const googleCourses = await fetchCourses(accessToken);

    const courseRows = googleCourses.map((c) => ({
      id: c.id,
      user_id: user.id,
      name: c.name,
      section: c.section ?? null,
      room: c.room ?? null,
      course_state: c.courseState ?? null,
      alternate_link: c.alternateLink ?? null,
      last_synced_at: new Date().toISOString(),
    }));

    if (courseRows.length > 0) {
      const { error } = await admin.from("courses").upsert(courseRows);
      if (error) throw error;
    }

    const courseworkRows: Record<string, unknown>[] = [];

    for (const course of googleCourses) {
      const work = await fetchCourseWork(course.id, accessToken);

      for (const item of work) {
        const submissionState = await fetchSubmissionState(
          course.id,
          item.id,
          accessToken
        );

        courseworkRows.push({
          id: item.id,
          course_id: course.id,
          user_id: user.id,
          title: item.title,
          description: item.description ?? null,
          due_at: combineDueDateTime(item.dueDate, item.dueTime),
          work_type: item.workType ?? null,
          state: item.state ?? null,
          submission_state: submissionState,
          is_done: submissionState ? DONE_STATES.has(submissionState) : false,
          alternate_link: item.alternateLink ?? null,
          materials: item.materials ?? null,
          max_points: item.maxPoints ?? null,
          creation_time: item.creationTime ?? null,
          update_time: item.updateTime ?? null,
          last_synced_at: new Date().toISOString(),
        });
      }
    }

    if (courseworkRows.length > 0) {
      const { error } = await admin.from("coursework").upsert(courseworkRows);
      if (error) throw error;
    }

    return res.status(200).json({
      courses: courseRows,
      coursework: courseworkRows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}