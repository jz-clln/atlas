import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_supabaseServer";
import {
  getValidAccessToken,
  fetchCourses,
  fetchAnnouncements,
  fetchCourseWork,
  fetchSubmissionState,
  combineDueDateTime,
} from "../_google";

const DONE_STATES = new Set(["TURNED_IN", "RETURNED"]);

// This now does meaningfully more work per run (full course/coursework
// sync, not just announcements) and runs far more often than before —
// raising the timeout gives it room to finish even on a slower run.
export const config = {
  maxDuration: 60,
};

// Triggered by Vercel Cron (see vercel.json) — not by a user request, so
// there's no verifyUser() call. Protected by a shared secret instead.
//
// Three jobs per run, sharing the same courses/courseWork fetch to avoid
// duplicate Classroom API calls:
// 1. Sync courses/coursework into Supabase — this is what api/atlas/chat.ts
//    reads from, so this poll interval IS Atlas's freshness window.
// 2. Flag cancellation-language announcements against the saved schedule.
// 3. Nudge on anything due within 24h that isn't turned in yet.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const admin = supabaseAdmin();

  const { data: connectedUsers, error } = await admin.from("google_tokens").select("user_id");
  if (error || !connectedUsers) {
    res.status(500).json({ error: "Couldn't list connected users" });
    return;
  }

  let notificationsCreated = 0;
  let coursesSynced = 0;
  let courseworkSynced = 0;

  // NOTE: "today" here is computed in UTC, since there's no stored user
  // timezone yet. For a user far from UTC this can be off by a few hours
  // around midnight — worth adding a timezone column to fix properly.
  const todayUTCDay = new Date().getUTCDay();

  for (const { user_id } of connectedUsers) {
    try {
      const accessToken = await getValidAccessToken(user_id);
      const courses = await fetchCourses(accessToken);

      const { data: schedules } = await admin
        .from("class_schedules")
        .select("course_id, days_of_week")
        .eq("user_id", user_id);

      const scheduledToday = new Set(
        (schedules ?? [])
          .filter((s) => s.days_of_week.includes(todayUTCDay))
          .map((s) => s.course_id)
      );

      // --- 1. Sync courses ---
      const courseRows = courses.map((c) => ({
        id: c.id,
        user_id,
        name: c.name,
        section: c.section ?? null,
        room: c.room ?? null,
        course_state: c.courseState ?? null,
        alternate_link: c.alternateLink ?? null,
        last_synced_at: new Date().toISOString(),
      }));
      if (courseRows.length > 0) {
        await admin.from("courses").upsert(courseRows);
        coursesSynced += courseRows.length;
      }

      for (const course of courses) {
        // --- Announcements, with cancellation-language detection ---
        const announcements = await fetchAnnouncements(course.id, accessToken).catch(() => []);

        for (const a of announcements) {
          if (!a.text) continue;

          const looksLikeCancellation = CANCELLATION_PATTERN.test(a.text);
          const kind = looksLikeCancellation
            ? scheduledToday.has(course.id)
              ? "no_class"
              : "cancellation"
            : "announcement";
          const title = kind === "no_class" ? `No class today: ${course.name}` : course.name;

          const { error: insertError, count } = await admin.from("notifications").upsert(
            {
              user_id,
              kind,
              title,
              body: a.text,
              course_id: course.id,
              external_id: a.id,
            },
            { onConflict: "user_id,external_id", ignoreDuplicates: true, count: "exact" }
          );
          if (!insertError && count) notificationsCreated += count;
        }

        // --- Coursework: sync to Supabase + deadline nudges, sharing one fetch ---
        const courseWork = await fetchCourseWork(course.id, accessToken).catch(() => []);

        const submissionStates = await Promise.all(
          courseWork.map((cw) =>
            fetchSubmissionState(course.id, cw.id, accessToken).catch(() => null)
          )
        );

        const courseworkRows = courseWork.map((cw, i) => ({
          id: cw.id,
          course_id: course.id,
          user_id,
          title: cw.title,
          description: cw.description ?? null,
          due_at: combineDueDateTime(cw.dueDate, cw.dueTime),
          work_type: cw.workType ?? null,
          state: cw.state ?? null,
          submission_state: submissionStates[i],
          is_done: submissionStates[i] ? DONE_STATES.has(submissionStates[i]!) : false,
          alternate_link: cw.alternateLink ?? null,
          materials: cw.materials ?? null,
          max_points: cw.maxPoints ?? null,
          creation_time: cw.creationTime ?? null,
          update_time: cw.updateTime ?? null,
          last_synced_at: new Date().toISOString(),
        }));

        if (courseworkRows.length > 0) {
          await admin.from("coursework").upsert(courseworkRows);
          courseworkSynced += courseworkRows.length;
        }

        // --- Deadline nudges, reusing the submission states just fetched ---
        for (let i = 0; i < courseWork.length; i++) {
          const cw = courseWork[i];
          const submissionState = submissionStates[i];
          const dueAt = combineDueDateTime(cw.dueDate, cw.dueTime);
          if (!dueAt) continue;

          const hoursUntilDue = (new Date(dueAt).getTime() - Date.now()) / 3_600_000;
          if (hoursUntilDue <= 0 || hoursUntilDue > 24) continue;
          if (submissionState === "TURNED_IN" || submissionState === "RETURNED") continue;

          const threshold = hoursUntilDue <= 3 ? "3h" : "24h";
          const timeLabel = threshold === "3h" ? "about 3 hours" : "less than 24 hours";

          const { error: insertError, count } = await admin.from("notifications").upsert(
            {
              user_id,
              kind: "deadline",
              title: course.name,
              body: `"${cw.title}" is due in ${timeLabel} and hasn't been turned in yet.`,
              course_id: course.id,
              external_id: `deadline:${cw.id}:${threshold}`,
            },
            { onConflict: "user_id,external_id", ignoreDuplicates: true, count: "exact" }
          );
          if (!insertError && count) notificationsCreated += count;
        }
      }
    } catch {
      // No tokens, refresh failure, or a Classroom error for this user —
      // skip them and keep going for everyone else.
      continue;
    }
  }

  res.status(200).json({
    checkedUsers: connectedUsers.length,
    coursesSynced,
    courseworkSynced,
    notificationsCreated,
  });
}

const CANCELLATION_PATTERN =
  /\b(no class(es)?|class(es)? (is |are )?cancel(l)?ed|cancel(l)?ation|will not meet|won't meet|not meeting today|no school|remote (today|this week)|asynchronous today|postponed)\b/i;