import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin, verifyUser } from "../_supabaseServer.js";

type ChatMessage = { role: "user" | "atlas"; text: string };

const OPENAI_MODEL = "gpt-5.4-mini";

// Keep token spend predictable regardless of how big todos/notes/history get.
const MAX_HISTORY_MESSAGES = 10;
const MAX_TODOS = 30;
const MAX_ANNOUNCEMENTS = 8;
const MAX_GOALS = 10;
const MAX_NOTES = 20;
const MAX_NOTE_CHARS = 500;
const MAX_TOKENS = 400;
const MAX_DESCRIPTION_CHARS = 800;

// Same materials union Classroom returns everywhere else in this app —
// flattened here to {title, url} pairs so Atlas gets something useful
// without the raw nested JSON eating into the token budget.
type CourseworkMaterial =
  | { driveFile: { driveFile: { title: string; alternateLink: string } } }
  | { link: { url: string; title?: string } }
  | { youTubeVideo: { title: string; alternateLink: string } }
  | { form: { formUrl: string; title?: string } };

function summarizeMaterial(m: CourseworkMaterial): { title: string; url: string; kind: string } | null {
  if ("driveFile" in m) {
    return { title: m.driveFile.driveFile.title, url: m.driveFile.driveFile.alternateLink, kind: "file" };
  }
  if ("link" in m) {
    return { title: m.link.title ?? m.link.url, url: m.link.url, kind: "link" };
  }
  if ("youTubeVideo" in m) {
    return { title: m.youTubeVideo.title, url: m.youTubeVideo.alternateLink, kind: "video" };
  }
  if ("form" in m) {
    // Atlas cannot read what's inside a Google Form — no Forms API
    // integration exists. Flagging the kind explicitly so the prompt can
    // tell Atlas to be honest about that instead of guessing at content.
    return { title: m.form.title ?? "Google Form", url: m.form.formUrl, kind: "google_form" };
  }
  return null;
}

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
    { data: noteRows },
    { data: schedules },
    { data: recentNotifications },
    { data: courseRows },
    { data: courseworkRows },
    { data: goalRows },
  ] = await Promise.all([
    admin.from("todos").select("text, done").eq("user_id", user.id).limit(MAX_TODOS),
    admin
      .from("notes_entries")
      .select("content, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(MAX_NOTES),
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
      .select("id, course_id, title, due_at, work_type, is_done, description, materials")
      .eq("user_id", user.id),
    admin
      .from("goals")
      .select("label, period, pct, period_start")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(MAX_GOALS),
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
    description: cw.description ? cw.description.slice(0, MAX_DESCRIPTION_CHARS) : null,
    materials: ((cw.materials ?? []) as CourseworkMaterial[])
      .map(summarizeMaterial)
      .filter((m): m is NonNullable<typeof m> => m !== null),
  }));
  const goals = (goalRows ?? []).map((g) => ({
    label: g.label,
    period: g.period,
    pct: g.pct,
    periodStart: g.period_start,
  }));
  const notes = (noteRows ?? []).map((n) => ({
    content: n.content.slice(0, MAX_NOTE_CHARS),
    createdAt: n.created_at,
  }));

  const context = {
    currentDateTime: { iso: nowISO, human: nowHuman },
    todos: todos ?? [],
    notes,
    courses,
    coursework,
    schedules: schedules ?? [],
    recentAnnouncements: recentNotifications ?? [],
    goals,
  };

  const systemPrompt = `You are Atlas, an academic assistant embedded in the user's personal dashboard.
You can see their to-do list, notes, class schedule, recent Classroom announcements, live Google
Classroom courses/coursework, and current goals below — this is your own memory of their situation, not
something you're being shown for the first time.

Current date and time — use this as "now" for anything relative (today, tomorrow, overdue, this week):
${nowHuman} (ISO: ${nowISO})

Dashboard context (JSON):
${JSON.stringify(context)}

Rules:
- Always address the user as "Sir" in your replies (e.g. "Sir, you have three things due this week.").
- Never use em dashes (—) in replies. Write in plain, natural spoken language, like a normal AI assistant talking to someone, not like a written essay.
- Each coursework item includes "isOverdue", already computed relative to the current date/time above —
  trust that flag rather than recalculating overdue status yourself from "dueAt".
- Each coursework item may include "description" (the actual assignment instructions/question text, when
  Classroom provided one) and "materials" (attached files, links, videos, or Google Forms). Use these to
  actually help with content — explaining a question, drafting an answer — instead of only ever referring
  to the title. If a material has kind "google_form", you cannot see what's inside it (no Forms API
  integration exists) — say so plainly and ask the user to paste or photograph the question instead of
  guessing or pretending you can see it. Same if description is null/empty and there's no useful material:
  tell them you don't have the content and ask them to share it.
- If the user is busy or asks you to create/post a task, propose exactly ONE Classroom task via the
  "create_classroom_task" action. You must NEVER post it yourself — the user always confirms before
  anything reaches Classroom.
- If the user tells you a subject's meeting days/times (e.g. "CS101 is Tue/Thu 9 to 10:30"), propose a
  "set_class_schedule" action instead. This only saves to their private schedule, not to Classroom, so
  it does not need the same confirm-before-posting caution — but still only propose it when they've
  clearly stated a schedule.
- If the user asks to submit or turn in work for a specific Classroom assignment, propose a
  "submit_classroom_work" action. This is ONLY supported for coursework where workType is "ASSIGNMENT" —
  if the item they mean has a different workType, tell them that's not supported yet instead of proposing
  an action. Match courseWorkId to a real "id" from the "coursework" list above; never invent one. If they
  give you the actual answer text in their message, use mode "text" and put that text in textAnswer. If
  they instead want to attach a photo or file, or they haven't given you text, use mode "file" and leave
  textAnswer null — you never receive the file yourself, the user picks it when confirming. Exactly like
  the other two actions, you are only proposing this; it is never sent to Classroom without the user
  confirming on the card.
- If the user asks you to add, remember, or remind them of something as a task (e.g. "add buy pens to my
  list", "remind me to email my professor"), propose an "add_todo" action. This is private and saves
  immediately, same as set_class_schedule — no confirmation card needed.
- If the user asks you to write down, note, or save something (e.g. "note that the deadline moved to
  Friday", "write down that my professor said the exam is open-book"), propose an "add_note" action.
  This creates a new, separate note — it never edits or merges into an existing one, since notes are
  now independent entries, not one running document. This is private and saves immediately, no
  confirmation card needed.
- If the user asks you to set a goal for the week or the month (e.g. "set a goal to finish 3 assignments
  this week", "my goal this month is to keep my grades up"), propose a "set_goal" action. Pick "period"
  as "week" or "month" based on what they said, and write "label" as a short, clear restatement of the
  goal in their own intent, not a verbatim copy of their message.
- If the user explicitly asks for a PDF, downloadable file, or document (e.g. "make me a PDF of my
  to-do list", "give me a study guide as a PDF"), propose a "generate_pdf" action. Compose "content"
  yourself as clean, well-organized plain text with newlines separating sections or list items — don't
  just dump the raw JSON context into it.
- Only include an action when the request clearly calls for one; otherwise action is null. Propose at
  most ONE action per reply, whichever type best matches what the user asked for.
- Pick courseId/courseName only from the real "courses" list above — never invent a course. If "courses"
  is empty, say Classroom isn't connected instead of proposing a create_classroom_task, set_class_schedule,
  or submit_classroom_work action.
- Use "schedules", "recentAnnouncements", and "goals" to answer questions like "do I have class today",
  "what did my prof say", or "what are my goals this month" directly, in your own words — don't just
  repeat the raw data structure.
- Respond with STRICT JSON only, no prose outside it, in exactly this shape:
{"reply": string, "action": null
  | {"type": "create_classroom_task", "task": {"courseId": string, "courseName": string, "title": string, "description": string, "dueDate": string | null}}
  | {"type": "set_class_schedule", "schedule": {"courseId": string, "courseName": string, "daysOfWeek": number[], "startTime": string, "endTime": string}}
  | {"type": "submit_classroom_work", "submission": {"courseId": string, "courseName": string, "courseWorkId": string, "taskTitle": string, "mode": "text" | "file", "textAnswer": string | null}}
  | {"type": "add_todo", "todo": {"text": string}}
  | {"type": "add_note", "note": {"content": string}}
  | {"type": "set_goal", "goal": {"label": string, "period": "week" | "month"}}
  | {"type": "generate_pdf", "pdf": {"title": string, "content": string}}
}
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