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

// Triggered by Vercel Cron (see vercel.json) — not by a user request, so
// there's no verifyUser() call. Protected by a shared secret instead.
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

  // "today" is based on Philippine time (Asia/Manila, UTC+8).
  const todayPhilippineDay = new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Asia/Manila",
    })
  ).getDay();

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
          .filter((s) => s.days_of_week.includes(todayPhilippineDay))
          .map((s) => s.course_id)
      );

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

        // --- Deadline nudges: things due soon that aren't turned in ---
        const courseWork = await fetchCourseWork(course.id, accessToken).catch(() => []);

        for (const cw of courseWork) {
          const dueAt = combineDueDateTime(cw.dueDate, cw.dueTime);
          if (!dueAt) continue;

          const hoursUntilDue = (new Date(dueAt).getTime() - Date.now()) / 3_600_000;
          if (hoursUntilDue <= 0 || hoursUntilDue > 24) continue;

          const threshold = hoursUntilDue <= 3 ? "3h" : "24h";

          const submissionState = await fetchSubmissionState(course.id, cw.id, accessToken);
          if (submissionState === "TURNED_IN" || submissionState === "RETURNED") continue;

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

  res.status(200).json({ checkedUsers: connectedUsers.length, notificationsCreated });
}

const CANCELLATION_PATTERN =
  /\b(no class(es)?|class(es)? (is |are )?cancel(l)?ed|cancel(l)?ation|will not meet|won't meet|not meeting today|no school|remote (today|this week)|asynchronous today|postponed)\b/i;