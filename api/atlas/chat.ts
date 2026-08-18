import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin, verifyUser } from "../_supabaseServer";
import { getValidAccessToken, fetchCourses, fetchCourseWork, combineDueDateTime } from "../_google";

type ChatMessage = { role: "user" | "atlas"; text: string };

const MODEL = "claude-sonnet-5";

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

  const [{ data: todos }, { data: notesRow }] = await Promise.all([
    admin.from("todos").select("text, done").eq("user_id", user.id),
    admin.from("notes").select("content").eq("user_id", user.id).maybeSingle(),
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
    notes: notesRow?.content ?? "",
    courses,
    coursework,
  };

  const systemPrompt = `You are Atlas, an academic assistant embedded in the user's personal dashboard.
You can see their to-do list, notes, and live Google Classroom courses/coursework below — this is your
own memory of their situation, not something you're being shown for the first time.

Dashboard context (JSON):
${JSON.stringify(context)}

Rules:
- If the user is busy or asks you to create/post something, propose exactly ONE Classroom task. You must
  NEVER post it yourself — the user always confirms before anything reaches Classroom.
- Only include an action when the request clearly calls for creating a Classroom task.
- Pick courseId and courseName only from the real "courses" list above — never invent a course. If
  "courses" is empty, say Classroom isn't connected instead of proposing an action.
- Respond with STRICT JSON only, no prose outside it, in exactly this shape:
{"reply": string, "action": null | {"type": "create_classroom_task", "task": {"courseId": string, "courseName": string, "title": string, "description": string, "dueDate": string | null}}}
- "reply" is what the user sees in chat — keep it short and conversational.`;

  const anthropicMessages = [
    ...(history ?? []).map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text,
    })),
    { role: "user", content: message },
  ];

  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      system: systemPrompt,
      messages: anthropicMessages,
    }),
  });

  if (!aiRes.ok) {
    res.status(502).json({ error: "Atlas model request failed" });
    return;
  }

  const aiData = await aiRes.json();
  const text = (aiData.content ?? []).map((b: any) => b.text ?? "").join("");

  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    res.status(200).json(parsed);
  } catch {
    res.status(200).json({ reply: text, action: null });
  }
}