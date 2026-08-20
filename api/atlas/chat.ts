import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin, verifyUser } from "../_supabaseServer.js";

type ChatMessage = { role: "user" | "atlas"; text: string };

const OPENAI_MODEL = "gpt-5.4-mini";

// Keep token spend predictable regardless of how big todos/notes/history get.
const MAX_HISTORY_MESSAGES = 10;
const MAX_NOTES_CHARS = 1500;
const MAX_TODOS = 30;
const MAX_ANNOUNCEMENTS = 8;
const MAX_TOKENS = 400;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // TEMP DEBUG — remove once the env var issue is confirmed fixed.
  console.log("ENV CHECK — OPENAI_API_KEY loaded:", !!process.env.OPENAI_API_KEY);

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const user = await verifyUser(req);
  if (!user) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }

  const { message, history } = (req.body ?? {}) as { message?: string; history?: ChatMessage[] };
  if (!message) {
    res.status(400).json({ error: "Missing message" });
    return;
  }

  const admin = supabaseAdmin();

  const [
    { data: todos },
    { data: notesRow },
    { data: schedules },
    { data: recentNotifications },
    { data: courseRows },
    { data: courseworkRows },
  ] = await Promise.all([
    admin.from("todos").select("text, done").eq("user_id", user.id).limit(MAX_TODOS),
    admin.from("notes").select("content").eq("user_id", user.id).maybeSingle(),
    admin
      .from("class_schedules")
      .select("course_id, course_name, days_of_week, start_time, end_time")
      .eq("user_id", user.id),
    admin
      .from("notifications")
      .select("title, body, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(MAX_ANNOUNCEMENTS),
    // Read from the tables api/classroom/sync.ts already keeps up to date,
    // instead of hitting Google live on every single chat message. That
    // live-fetch-per-message pattern was the actual cause of slow/failed
    // replies — Classroom API round-trips stacked on top of the AI call
    // itself could exceed the function's execution window.
    admin.from("courses").select("id, name").eq("user_id", user.id),
    admin
      .from("coursework")
      .select("id, course_id, title, due_at, work_type, is_done")
      .eq("user_id", user.id),
  ]);

  // Anchor for "now" — without this the model has no reliable way to judge
  // "today", "overdue", or "this week" from raw ISO timestamps alone.
  const nowDate = new Date();
  const nowISO = nowDate.toISOString();
  const nowHuman = nowDate.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
    timeZoneName: "short",
  });

  const courses = (courseRows ?? []).map((c) => ({ id: c.id, name: c.name }));
  const coursework = (courseworkRows ?? []).map((cw) => ({
    id: cw.id,
    courseId: cw.course_id,
    title: cw.title,
    dueAt: cw.due_at,
    workType: cw.work_type ?? undefined,
    isDone: cw.is_done,
    // Precomputed server-side rather than left for the model to work out
    // from raw timestamps — cheaper, and removes an entire class of "Atlas
    // got the date math wrong" mistakes.
    isOverdue: !cw.is_done && !!cw.due_at && new Date(cw.due_at) < nowDate,
  }));

  const context = {
    currentDateTime: { iso: nowISO, human: nowHuman },
    todos: todos ?? [],
    notes: (notesRow?.content ?? "").slice(0, MAX_NOTES_CHARS),
    courses,
    coursework,
    schedules: schedules ?? [],
    recentAnnouncements: recentNotifications ?? [],
  };

  const systemPrompt = `You are Atlas, an academic assistant embedded in the user's personal dashboard.
You can see their to-do list, notes, class schedule, recent Classroom announcements, and live Google
Classroom courses/coursework below — this is your own memory of their situation, not something you're
being shown for the first time.

Current date and time — use this as "now" for anything relative (today, tomorrow, overdue, this week):
${nowHuman} (ISO: ${nowISO})

Dashboard context (JSON):
${JSON.stringify(context)}

Rules:
- Always address the user as "Sir" in your replies (e.g. "Sir, you have three things due this week.").
- Each coursework item includes "isOverdue", already computed relative to the current date/time above —
  trust that flag rather than recalculating overdue status yourself from "dueAt".
- If the user is busy or asks you to create/post a task, propose exactly ONE Classroom task via the
  "create_classroom_task" action. You must NEVER post it yourself — the user always confirms before
  anything reaches Classroom.
- If the user tells you a subject's meeting days/times (e.g. "CS101 is Tue/Thu 9 to 10:30"), propose a
  "set_class_schedule" action instead. This only saves to their private schedule, not to Classroom, so
  it does not need the same confirm-before-posting caution — but still only propose it when they've
  clearly stated a schedule.
- Only include an action when the request clearly calls for one; otherwise action is null.
- Pick courseId/courseName only from the real "courses" list above — never invent a course. If "courses"
  is empty, say Classroom isn't connected instead of proposing an action.
- Use "schedules" and "recentAnnouncements" to answer questions like "do I have class today" or
  "what did my prof say" directly, in your own words — don't just repeat the raw data structure.
- Respond with STRICT JSON only, no prose outside it, in exactly this shape:
{"reply": string, "action": null | {"type": "create_classroom_task", "task": {"courseId": string, "courseName": string, "title": string, "description": string, "dueDate": string | null}} | {"type": "set_class_schedule", "schedule": {"courseId": string, "courseName": string, "daysOfWeek": number[], "startTime": string, "endTime": string}}}
- Days of week: 0 = Sunday ... 6 = Saturday. Times as 24-hour "HH:MM".
- "reply" is what the user sees in chat — keep it short and conversational.`;

  // Trim to the most recent N turns — old chat history is the single
  // biggest token cost if it's left unbounded.
  const trimmedHistory = (history ?? []).slice(-MAX_HISTORY_MESSAGES);

  const openaiMessages = [
    { role: "system", content: systemPrompt },
    ...trimmedHistory.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text,
    })),
    { role: "user", content: message },
  ];

  const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_completion_tokens: MAX_TOKENS,
      messages: openaiMessages,
      response_format: { type: "json_object" },
    }),
  });

  if (!aiRes.ok) {
    const bodyText = await aiRes.text().catch(() => "");
    console.error(`OpenAI request failed (${aiRes.status}): ${bodyText}`);
    res.status(502).json({ error: "Atlas model request failed" });
    return;
  }

  const aiData = await aiRes.json();
  const text = aiData.choices?.[0]?.message?.content ?? "";

  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    res.status(200).json(parsed);
  } catch {
    res.status(200).json({ reply: text, action: null });
  }
}