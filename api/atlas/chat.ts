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
// Was 400 — nowhere near enough once generate_pdf/create_file responses
// need to fit a real file's content inside the JSON envelope. A truncated
// response isn't valid JSON, so JSON.parse below fails and the raw
// half-finished text falls through as the visible reply instead of being
// parsed into reply/action — which is exactly the raw-JSON-in-chat bug.
const MAX_TOKENS = 3000;
const MAX_DESCRIPTION_CHARS = 800;
// Real cost driver isn't MAX_TOKENS (that's just a ceiling, barely spent on
// an ordinary short reply) — it's this context, resent in full on every
// single message regardless of what's being asked. Capping item count and
// only paying for description/materials on active work keeps a full
// semester's worth of synced coursework from taxing every "hey Atlas".
const MAX_COURSEWORK_ITEMS = 20;
const MAX_MATERIALS_PER_ITEM = 3;
// Same idea, applied to the library — only names/paths are sent (never
// file contents), so this cap is generous relative to its token cost.
const MAX_LIBRARY_FOLDERS = 60;
const MAX_LIBRARY_FILES = 80;

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
    // Atlas cannot see what's inside a Google Form — no Forms API
    // integration exists. Flagging the kind explicitly so the prompt can
    // tell Atlas to be honest about that instead of guessing at content.
    return { title: m.form.title ?? "Google Form", url: m.form.formUrl, kind: "google_form" };
  }
  return null;
}

// Walks a folder's parent_id chain up to the root and joins the names with
// "/" — this is the same path format the two library chat actions use, so
// what Atlas is shown here is exactly what it can reference back.
function buildFolderPath(folderId: string | null, foldersById: Map<string, { name: string; parent_id: string | null }>): string {
  if (!folderId) return "";
  const parts: string[] = [];
  let cur: string | null = folderId;
  while (cur) {
    const f = foldersById.get(cur);
    if (!f) break;
    parts.unshift(f.name);
    cur = f.parent_id;
  }
  return parts.join("/");
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

  const { message, history, lightweight } = (req.body ?? {}) as {
    message?: string;
    history?: ChatMessage[];
    // Set by AtlasWidget for the read_library_file follow-up call only —
    // that call already has everything it needs (the file content and the
    // user's original question) embedded directly in `message`, so it has
    // no use for the full dashboard context or the action-proposal rules.
    // Skipping straight to a short prompt here avoids re-running all 9
    // Supabase queries and re-sending the whole todos/schedule/goals/
    // coursework/library JSON dump (plus the entire action-schema block)
    // for a call that was never going to use any of it.
    lightweight?: boolean;
  };
  if (!message) {
    res.status(400).json({ error: "Missing message" });
    return;
  }

  if (lightweight) {
    const trimmedHistory = (history ?? []).slice(-MAX_HISTORY_MESSAGES);
    const lightweightSystemPrompt = `You are Atlas, an academic assistant.
Always address the user as "Sir" in your replies. Never use em dashes (—) — write in plain, natural
spoken language, like a normal assistant talking to someone, not like a written essay.
The user's message below already contains everything you need: some file content they asked you to
read, and what they originally wanted from it. Just answer directly and helpfully using that content.
Respond with STRICT JSON only, no prose outside it, in exactly this shape: {"reply": string}`;

    const lightweightMessages = [
      { role: "system", content: lightweightSystemPrompt },
      ...trimmedHistory.map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text,
      })),
      { role: "user", content: message },
    ];

    const liteRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        // Lower than the normal MAX_TOKENS on purpose — this path never
        // needs to emit a generated PDF/file's worth of content, just a
        // conversational answer about a file that's already been read.
        max_completion_tokens: 1200,
        messages: lightweightMessages,
        response_format: { type: "json_object" },
      }),
    });

    if (!liteRes.ok) {
      const bodyText = await liteRes.text().catch(() => "");
      console.error(`OpenAI request failed (${liteRes.status}): ${bodyText}`);
      res.status(502).json({ error: "Atlas model request failed" });
      return;
    }

    const liteData = await liteRes.json();
    const liteText = liteData.choices?.[0]?.message?.content ?? "";
    try {
      const clean = liteText.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      res.status(200).json({ reply: parsed.reply ?? liteText, action: null });
    } catch {
      res.status(200).json({ reply: liteText, action: null });
    }
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
    { data: libraryFolderRows },
    { data: libraryFileRows },
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
    admin.from("courses").select("id, name, nickname").eq("user_id", user.id),
    admin
      .from("coursework")
      .select("id, course_id, title, due_at, work_type, is_done, description, materials, alternate_link")
      .eq("user_id", user.id),
    admin
      .from("goals")
      .select("label, period, pct, period_start")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(MAX_GOALS),
    admin
      .from("library_folders")
      .select("id, parent_id, name")
      .eq("user_id", user.id)
      .limit(MAX_LIBRARY_FOLDERS),
    admin
      .from("library_files")
      .select("folder_id, name, created_by")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(MAX_LIBRARY_FILES),
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

  const courses = (courseRows ?? []).map((c) => ({ id: c.id, name: c.name, nickname: c.nickname }));

  // Not-done items first (sorted soonest-due first among those), so if
  // there's more coursework than the cap allows, what gets dropped is old
  // completed work, not something still active.
  const sortedCoursework = [...(courseworkRows ?? [])].sort((a, b) => {
    if (a.is_done !== b.is_done) return a.is_done ? 1 : -1;
    const aDue = a.due_at ? new Date(a.due_at).getTime() : Infinity;
    const bDue = b.due_at ? new Date(b.due_at).getTime() : Infinity;
    return aDue - bDue;
  });

  const coursework = sortedCoursework.slice(0, MAX_COURSEWORK_ITEMS).map((cw) => ({
    id: cw.id,
    courseId: cw.course_id,
    title: cw.title,
    dueAt: cw.due_at,
    workType: cw.work_type ?? undefined,
    alternateLink: cw.alternate_link ?? null,
    isDone: cw.is_done,
    // Precomputed server-side rather than left for the model to work out
    // from raw timestamps — cheaper, and removes an entire class of "Atlas
    // got the date math wrong" mistakes.
    isOverdue: !cw.is_done && !!cw.due_at && new Date(cw.due_at) < nowDate,
    // Full description/materials only for work that's still open — a
    // finished assignment's content is rarely what a message is about, and
    // it's the single biggest per-item cost otherwise.
    description: !cw.is_done && cw.description ? cw.description.slice(0, MAX_DESCRIPTION_CHARS) : null,
    materials: !cw.is_done
      ? ((cw.materials ?? []) as CourseworkMaterial[])
          .slice(0, MAX_MATERIALS_PER_ITEM)
          .map(summarizeMaterial)
          .filter((m): m is NonNullable<typeof m> => m !== null)
      : [],
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

  // Library: only names/paths ever go to the model, never file contents —
  // Atlas can tell you what exists and where, and can save/fetch by name,
  // but can't read what's inside a file you uploaded yourself.
  const foldersById = new Map(
    (libraryFolderRows ?? []).map((f) => [f.id, { name: f.name, parent_id: f.parent_id }])
  );
  const libraryFolders = (libraryFolderRows ?? []).map((f) => buildFolderPath(f.id, foldersById)).sort();
  const libraryFiles = (libraryFileRows ?? []).map((f) => ({
    path: buildFolderPath(f.folder_id, foldersById),
    name: f.name,
    createdBy: f.created_by,
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
    library: { folders: libraryFolders, files: libraryFiles },
  };

  const systemPrompt = `You are Atlas, an academic assistant embedded in the user's personal dashboard.
You can see their to-do list, notes, class schedule, recent Classroom announcements, live Google
Classroom courses/coursework, current goals, and their personal file library below — this is your own
memory of their situation, not something you're being shown for the first time.

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
  Classroom provided one) and "materials" (attached files, links, videos, or Google Forms). These are only
  included for items that are still open (isDone is false) — a finished item will always show null/empty
  for both, that's expected and not missing data, don't comment on it. For open items, use description and
  materials to actually help with content — explaining a question, drafting an answer — instead of only
  ever referring to the title. If a material has kind "google_form", you cannot see what's inside it (no
  Forms API integration exists) — say so plainly and ask the user to paste or photograph the question
  instead of guessing or pretending you can see it. Same if description is null/empty and there's no
  useful material: tell them you don't have the content and ask them to share it.
- "library.folders" lists every existing folder path (e.g. "Networks/Notes"), and "library.files" lists
  every file with its folder "path" ("" means the root) and "createdBy" ("user" for something they
  uploaded, "atlas" for something you saved earlier. You know these files EXIST and WHERE, but you do NOT
  automatically see what's inside any of them — that would mean re-sending file contents on every single
  message, which is wasteful. If the user wants a file's contents actually read or used, propose
  "read_library_file" (see below) to fetch it on demand for that turn only, regardless of whether
  createdBy is "user" or "atlas" — don't claim you already know its contents just because you wrote it,
  since you don't have that from a past session. You CAN discuss a file you saved yourself earlier in
  THIS SAME conversation without re-reading it, since its content is already right there in your own
  recent reply.
- Each course may have a "nickname" the user has set for it. If present, always refer to that course by
  its nickname in your replies instead of its raw Classroom name — that's what they've told you to call
  it. Still match on the real "id" (not the nickname) whenever an action needs a courseId.
- If the user tells you to call a course by a different name (e.g. "call CC4 'Data Structures' from now
  on", "nickname my algorithms class DSA"), propose a "set_course_nickname" action. Match courseId to a
  real course from the "courses" list above using whatever they said (its current name or nickname) —
  never invent a course. This is private and saves immediately, no confirmation card needed.
- If the user is busy or asks you to create/post a task, propose exactly ONE Classroom task via the
  "create_classroom_task" action. You must NEVER post it yourself — the user always confirms before
  anything reaches Classroom.
- If the user tells you a subject's meeting days/times (e.g. "CS101 is Tue/Thu 9 to 10:30"), propose a
  "set_class_schedule" action instead. This only saves to their private schedule, not to Classroom, so
  it does not need the same confirm-before-posting caution — but still only propose it when they've
  clearly stated a schedule.
- If the user asks to submit or turn in work for a specific Classroom assignment, propose a
  "submit_classroom_work" action. This is supported for coursework where workType is "ASSIGNMENT" or
  "SHORT_ANSWER_QUESTION" — if the item they mean has any other workType, tell them that's not supported
  yet instead of proposing an action. Match courseWorkId to a real "id" from the "coursework" list above;
  never invent one. Always set "workType" in the action to that matched item's real workType value — the
  confirmation card uses it to decide how to submit, so it must be accurate, not guessed. Always also set
  "alternateLink" to that matched item's real alternateLink value (its actual Classroom URL) — the
  confirmation card uses this to offer a manual "open in Classroom" fallback if the automatic submission
  fails, so it must be the real value from the coursework list, never invented or left as a guess.
  - If workType is "SHORT_ANSWER_QUESTION": this type has no file option at all, only a real typed answer.
    Always use mode "text". If they already gave you the answer text in their message, put it in
    textAnswer. If they haven't given you an answer yet, do not propose the action this turn — ask them
    for their answer first, and only propose it once you actually have text to put in textAnswer.
  - If workType is "ASSIGNMENT": if they give you the actual answer text in their message, use mode "text"
    and put that text in textAnswer. If they instead want to attach a photo or file (one or several), or
    they haven't given you text, use mode "file" and leave textAnswer null — you never receive the file(s)
    yourself, the user picks them when confirming.
  Exactly like the other two actions, you are only proposing this; it is never sent to Classroom without
  the user confirming on the card.
- If the user asks you to add, remember, or remind them of something as a task (e.g. "add buy pens to my
  list", "remind me to email my professor"), propose an "add_todo" action. This is private and saves
  immediately, same as set_class_schedule — no confirmation card needed.
- If the user asks you to write down, note, or save something SHORT (e.g. "note that the deadline moved
  to Friday", "write down that my professor said the exam is open-book"), propose an "add_note" action.
  This creates a new, separate private note (never filed in the library) — it never edits or merges into
  an existing one, since notes are independent entries, not one running document. This is private and
  saves immediately, no confirmation card needed.
- If the user asks you to WRITE NOTES on a topic (e.g. "write me notes on photosynthesis", "write study
  notes for the Networks quiz") — actually composing real note content, not just logging a short one-line
  reminder like add_note above — handle it across two turns instead of saving right away:
  1. In this reply, draft the actual notes as normal readable text in "reply" (headings/bullets are fine),
     and ask which folder to save them in. Set "action" to null on this turn — do not propose
     save_to_library yet. Skip asking only if the user's own message already named a folder/path to save
     to, or if they said not to save it at all (in which case just give them the notes with action null
     and don't ask anything).
  2. Once they answer with a folder (typically their very next message, e.g. "Networks" or "put it in
     Study/Bio"), propose a "save_to_library" action with "kind": "text", "folderPath" from their answer,
     and "content" equal to the notes you already drafted in the previous turn (tidy the formatting for a
     saved document rather than repeating your chat reply verbatim, but keep the same substance — don't
     redo the research or change what it says).
- If the user asks you to set a goal for the week or the month (e.g. "set a goal to finish 3 assignments
  this week", "my goal this month is to keep my grades up"), propose a "set_goal" action. Pick "period"
  as "week" or "month" based on what they said, and write "label" as a short, clear restatement of the
  goal in their own intent, not a verbatim copy of their message.
- If the user explicitly asks for a PDF, downloadable file, or document (e.g. "make me a PDF of my
  to-do list", "give me a study guide as a PDF") WITHOUT asking you to save/file/put it in their library,
  propose a "generate_pdf" action. Compose "content" yourself as clean, well-organized plain text with
  newlines separating sections or list items — don't just dump the raw JSON context into it.
- If the user asks you to write code and wants it saved/downloaded as a plain text file (not a PDF, not
  saved to their library), propose a "create_file" action with a filename ending in ".txt" and the code
  as its content. Write the code in a deliberately rough, unpolished style — inconsistent spacing, few or
  no comments, plain uninspired variable names (x, temp, data1, result) — like a high schooler's homework,
  NOT clean production code. The code must still actually work correctly despite looking messy; only the
  style is rough, not the logic. Only propose this when the user clearly wants a file created, not for
  ordinary code shown inline in chat.
- If the user asks you to SAVE, FILE, STORE, or PUT something into their library (e.g. "save this to my
  Networks folder", "file my to-do list under Personal/Lists", "put this study guide in the library"),
  propose a "save_to_library" action instead of generate_pdf/create_file. "folderPath" is "/"-separated
  (e.g. "Networks/Notes") built from whatever the user said or implied — it does not need to already
  exist in "library.folders", it will be created automatically if it's new. "kind" is "pdf" for a
  formatted document or "text" for plain text/code/notes; pick whichever fits what's being saved. Compose
  "content" the same way you would for generate_pdf/create_file. This is private and saves immediately,
  no confirmation card needed.
- If the user asks you to GET, OPEN, PULL UP, FIND, or SHOW a specific file that's listed in
  "library.files" (e.g. "get me the study guide from my Networks folder", "open my to-do list PDF"),
  propose a "fetch_from_library" action. Match "folderPath" and "filename" EXACTLY against an entry in
  "library.files" (using its "path" and "name") — never invent a path or filename. If nothing in
  "library.files" matches what they're describing, do not propose this action; tell them plainly you
  can't find it and ask them to check the name or folder.
- If the user asks you to READ, OPEN AND EXPLAIN, LOOK AT, or otherwise actually use the CONTENTS of a
  specific file (e.g. "read Array.h for me", "what does main.cpp say", "open the template and explain
  it", "check my notes file and summarize it"), propose a "read_library_file" action instead of
  fetch_from_library. Match "folderPath" and "filename" EXACTLY against an entry in "library.files", same
  rule as fetch_from_library — never invent one, and if nothing matches, don't propose this action, just
  say you can't find it. You do NOT have this file's contents yet in this turn — they get fetched and
  handed to you in a follow-up turn after this action runs. So keep "reply" this turn to a short
  acknowledgement only (e.g. "Let me take a look, Sir.") — never guess, summarize, or make up what the
  file might contain before you've actually seen it. Only propose this when they clearly want the
  content read/used, not just located — a plain "get me X" or "open X" with no further intent is
  fetch_from_library, not this.
- Only include an action when the request clearly calls for one; otherwise action is null. Propose at
  most ONE action per reply, whichever type best matches what the user asked for.
- Pick courseId/courseName only from the real "courses" list above — never invent a course. If "courses"
  is empty, say Classroom isn't connected instead of proposing a create_classroom_task, set_class_schedule,
  submit_classroom_work, or set_course_nickname action.
- Use "schedules", "recentAnnouncements", and "goals" to answer questions like "do I have class today",
  "what did my prof say", or "what are my goals this month" directly, in your own words — don't just
  repeat the raw data structure.
- Respond with STRICT JSON only, no prose outside it, in exactly this shape:
{"reply": string, "action": null
  | {"type": "create_classroom_task", "task": {"courseId": string, "courseName": string, "title": string, "description": string, "dueDate": string | null}}
  | {"type": "set_class_schedule", "schedule": {"courseId": string, "courseName": string, "daysOfWeek": number[], "startTime": string, "endTime": string}}
  | {"type": "submit_classroom_work", "submission": {"courseId": string, "courseName": string, "courseWorkId": string, "taskTitle": string, "workType": string, "alternateLink": string | null, "mode": "text" | "file", "textAnswer": string | null}}
  | {"type": "add_todo", "todo": {"text": string}}
  | {"type": "add_note", "note": {"content": string}}
  | {"type": "set_goal", "goal": {"label": string, "period": "week" | "month"}}
  | {"type": "set_course_nickname", "nickname": {"courseId": string, "nickname": string}}
  | {"type": "generate_pdf", "pdf": {"title": string, "content": string}}
  | {"type": "create_file", "file": {"filename": string, "content": string}}
  | {"type": "save_to_library", "library": {"folderPath": string, "filename": string, "content": string, "kind": "text" | "pdf"}}
  | {"type": "fetch_from_library", "libraryFetch": {"folderPath": string, "filename": string}}
  | {"type": "read_library_file", "libraryRead": {"folderPath": string, "filename": string}}
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