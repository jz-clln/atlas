import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin, verifyUser } from "../_supabaseServer";
import { getValidAccessToken, fetchCourses, fetchCourseWork, combineDueDateTime } from "../_google";

type ChatMessage = { role: "user" | "atlas"; text: string };

// Haiku instead of Sonnet — this is a personal assistant doing structured
// JSON replies, not deep reasoning, so the cheaper model is plenty. Bump
// back to "claude-sonnet-5" if replies feel too shallow.
const CLAUDE_MODEL = "claude-haiku-4-5-20251001";
const OPENAI_FALLBACK_MODEL = "gpt-4o-mini";

// Keep token spend predictable regardless of how big todos/notes/history get.
const MAX_HISTORY_MESSAGES = 10;
const MAX_NOTES_CHARS = 1500;
const MAX_TODOS = 30;
const MAX_ANNOUNCEMENTS = 8;
const MAX_TOKENS = 400;

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

  const [{ data: todos }, { data: notesRow }, { data: schedules }, { data: recentNotifications }] =
    await Promise.all([
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
    ]);

  // Pull live Classroom state the same way api/classroom/sync.ts does —
  // there's no cached courses/coursework table, so this fetches straight
  // from Google. If the user hasn't connected Classroom (or the token
  // refresh fails), Atlas just falls back to todos/notes only.
  let courses: { id: string; name: string }[] = [];
  let coursework: {
    id: string;
    courseId: string;
    title: string;
    dueAt: string | null;
    workType?: string;
  }[] = [];

  try {
    const accessToken = await getValidAccessToken(user.id);
    const rawCourses = await fetchCourses(accessToken);
    courses = rawCourses.map((c) => ({ id: c.id, name: c.name }));

    const perCourseWork = await Promise.all(
      rawCourses.map((c) => fetchCourseWork(c.id, accessToken).catch(() => []))
    );
    coursework = rawCourses.flatMap((c, i) =>
      (perCourseWork[i] ?? []).map((cw) => ({
        id: cw.id,
        courseId: c.id,
        title: cw.title,
        dueAt: combineDueDateTime(cw.dueDate, cw.dueTime),
        workType: cw.workType,
      }))
    );
  } catch {
    // No Google tokens on file, or refresh failed — proceed without
    // Classroom context rather than failing the whole chat request.
  }

  const context = {
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

Dashboard context (JSON):
${JSON.stringify(context)}

Rules:
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

  let text: string | null = null;
  let providerUsed: "claude" | "openai" | null = null;

  const claudeResult = await callClaude(systemPrompt, trimmedHistory, message);
  if (claudeResult.ok) {
    text = claudeResult.text;
    providerUsed = "claude";
  } else if (claudeResult.creditExhausted && process.env.OPENAI_API_KEY) {
    // Claude's out of credit — fall back to OpenAI rather than failing the
    // request outright.
    const openaiResult = await callOpenAI(systemPrompt, trimmedHistory, message);
    if (openaiResult.ok) {
      text = openaiResult.text;
      providerUsed = "openai";
    }
  }

  if (text === null) {
    res.status(502).json({ error: "Atlas model request failed on both providers" });
    return;
  }

  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    res.status(200).json({ ...parsed, _provider: providerUsed });
  } catch {
    res.status(200).json({ reply: text, action: null, _provider: providerUsed });
  }
}

async function callClaude(systemPrompt: string, history: ChatMessage[], message: string) {
  const anthropicMessages = [
    ...history.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text,
    })),
    { role: "user", content: message },
  ];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: anthropicMessages,
    }),
  });

  if (res.ok) {
    const data = await res.json();
    const text = (data.content ?? []).map((b: any) => b.text ?? "").join("");
    return { ok: true as const, text, creditExhausted: false };
  }

  // Anthropic returns 400 invalid_request_error with a message about
  // credit balance when you're out of credits, and 429 for rate/quota
  // limits — treat both as "time to fall back to OpenAI."
  const bodyText = await res.text().catch(() => "");
  const creditExhausted =
    res.status === 429 || (res.status === 400 && /credit|balance|quota/i.test(bodyText));

  return { ok: false as const, text: null, creditExhausted };
}

async function callOpenAI(systemPrompt: string, history: ChatMessage[], message: string) {
  const openaiMessages = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text,
    })),
    { role: "user", content: message },
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_FALLBACK_MODEL,
      max_tokens: MAX_TOKENS,
      messages: openaiMessages,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    return { ok: false as const, text: null };
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  return { ok: true as const, text };
}