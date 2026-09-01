import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useSession } from "../../lib/useSession";
import { AtlasOrb } from "../AtlasOrb";
import { FormattedMessage } from "../FormattedMessage";
import { PendingTaskCard, type PendingClassroomTask } from "../PendingTaskCard";
import { PendingSubmissionCard, type PendingSubmission } from "../PendingSubmissionCard";
import { VoiceModeOverlay } from "../VoiceModeOverlay";

type Props = {
  greeting: string;
};

type AtlasMessage = {
  role: "user" | "atlas";
  text: string;
  pdf?: { name: string; url: string };
  file?: { name: string; url: string };
  libraryFile?: { name: string; url: string; folderPath: string };
};

type ChatAction =
  | { type: "create_classroom_task"; task: PendingClassroomTask }
  | {
      type: "set_class_schedule";
      schedule: {
        courseId: string;
        courseName: string;
        daysOfWeek: number[];
        startTime: string;
        endTime: string;
      };
    }
  | { type: "submit_classroom_work"; submission: PendingSubmission }
  | { type: "add_todo"; todo: { text: string } }
  | { type: "add_note"; note: { content: string } }
  | { type: "set_goal"; goal: { label: string; period: "week" | "month" } }
  | { type: "set_course_nickname"; nickname: { courseId: string; nickname: string } }
  | { type: "generate_pdf"; pdf: { title: string; content: string } }
  | { type: "create_file"; file: { filename: string; content: string } }
  | { type: "save_to_library"; library: { folderPath: string; filename: string; content: string; kind: "text" | "pdf" } }
  | { type: "fetch_from_library"; libraryFetch: { folderPath: string; filename: string } };

const ATLAS_CHAT_ENDPOINT = "/api/atlas/chat";
const CLASSROOM_CREATE_ENDPOINT = "/api/classroom/create-task";
const GENERATE_PDF_ENDPOINT = "/api/atlas/generate-pdf";
const LIBRARY_BUCKET = "library";
const LIBRARY_SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Row shape returned by the `.select("id")` queries below. Declared once and
 * reused as an explicit annotation on the ternary results in
 * resolveOrCreateFolderId/resolveFolderId — THIS IS THE FIX for TS7022.
 *
 * `const result = cond ? await a : await b` asks TS to infer result's type
 * from an expression whose own resolution (through supabase-js's generic
 * PostgrestFilterBuilder overloads) circles back to needing result's type
 * first. Giving the ternary a concrete target type breaks that circularity.
 */
type FolderIdRow = { data: { id: string } | null };

function splitFolderPath(path: string): string[] {
  return path.split("/").map((s) => s.trim()).filter(Boolean);
}

async function resolveOrCreateFolderId(userId: string, path: string): Promise<string | null> {
  let parentId: string | null = null;
  for (const segment of splitFolderPath(path)) {
    const query = supabase
      .from("library_folders")
      .select("id")
      .eq("user_id", userId)
      .eq("name", segment);

    // FIXED: explicit `: FolderIdRow` annotation removes the TS7022 error.
    const result: FolderIdRow =
      parentId === null
        ? await query.is("parent_id", null).maybeSingle()
        : await query.eq("parent_id", parentId).maybeSingle();
    const existing = result.data;

    if (existing) {
      parentId = existing.id;
      continue;
    }

    // Same TS7022 circular-inference fix as the ternaries above: annotate
    // explicitly instead of letting TS infer through the query chain.
    const insertResult: { data: { id: string } | null; error: unknown } = await supabase
      .from("library_folders")
      .insert({ user_id: userId, parent_id: parentId, name: segment })
      .select("id")
      .single();
    const { data: created, error } = insertResult;
    if (error || !created) return null;
    parentId = created.id;
  }
  return parentId;
}

async function resolveFolderId(
  userId: string,
  path: string
): Promise<{ id: string | null; found: boolean }> {
  let parentId: string | null = null;
  for (const segment of splitFolderPath(path)) {
    const query = supabase
      .from("library_folders")
      .select("id")
      .eq("user_id", userId)
      .eq("name", segment);

    // FIXED: same explicit `: FolderIdRow` annotation as above.
    const result: FolderIdRow =
      parentId === null
        ? await query.is("parent_id", null).maybeSingle()
        : await query.eq("parent_id", parentId).maybeSingle();
    const existing = result.data;
    if (!existing) return { id: null, found: false };
    parentId = existing.id;
  }
  return { id: parentId, found: true };
}

function startOfPeriod(period: "week" | "month"): string {
  const now = new Date();
  if (period === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  }
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  return monday.toISOString().slice(0, 10);
}

export function AtlasWidget({ greeting }: Props) {
  const { session } = useSession();
  const userId = session?.user?.id;

  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<AtlasMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingTask, setPendingTask] = useState<PendingClassroomTask | null>(null);
  const [pendingSubmission, setPendingSubmission] = useState<PendingSubmission | null>(null);
  const [mode, setMode] = useState<"idle" | "notified">("idle");
  const [voiceOpen, setVoiceOpen] = useState(false);

  useEffect(() => {
    if (!userId) return;

    supabase
      .from("pending_submissions")
      // NOTE: this requires `work_type` and `alternate_link` columns on
      // pending_submissions — see the migration note below.
      .select(
        "course_id, course_name, course_work_id, task_title, work_type, alternate_link, mode, text_answer"
      )
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setPendingSubmission({
          courseId: data.course_id,
          courseName: data.course_name,
          courseWorkId: data.course_work_id,
          taskTitle: data.task_title,
          workType: data.work_type ?? null,
          alternateLink: data.alternate_link ?? null,
          mode: data.mode as "text" | "file",
          textAnswer: data.text_answer ?? undefined,
        });
      });
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`atlas-notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as { title: string; body: string; kind?: string };
          const icon = n.kind === "deadline" ? "⏰ " : n.kind === "no_class" ? "📭 " : "";
          setHistory((h) => [...h, { role: "atlas", text: `${icon}${n.title}: ${n.body}` }]);
          setMode("notified");
          setTimeout(() => setMode("idle"), 4000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  async function authHeaders(): Promise<Record<string, string>> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setDraft("");
    setError(null);
    const nextHistory = [...history, { role: "user" as const, text: trimmed }];
    setHistory(nextHistory);
    setSending(true);

    try {
      const res = await fetch(ATLAS_CHAT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ message: trimmed, history }),
      });
      if (!res.ok) throw new Error(`Atlas endpoint returned ${res.status}`);

      const data: { reply: string; action: ChatAction | null } = await res.json();
      setHistory([...nextHistory, { role: "atlas", text: data.reply }]);

      if (data.action?.type === "create_classroom_task") {
        setPendingTask(data.action.task);
      } else if (data.action?.type === "submit_classroom_work") {
        // NOTE: this trusts /api/atlas/chat to include workType and
        // alternateLink on the submission object it returns — both were
        // added to that endpoint's prompt and schema alongside this change.
        const s = data.action.submission;
        setPendingSubmission(s);
        if (userId) {
          await supabase.from("pending_submissions").upsert({
            user_id: userId,
            course_id: s.courseId,
            course_name: s.courseName,
            course_work_id: s.courseWorkId,
            task_title: s.taskTitle,
            work_type: s.workType ?? null,
            alternate_link: s.alternateLink ?? null,
            mode: s.mode,
            text_answer: s.textAnswer ?? null,
          });
        }
      } else if (data.action?.type === "set_class_schedule" && userId) {
        const s = data.action.schedule;
        await supabase.from("class_schedules").upsert(
          {
            user_id: userId,
            course_id: s.courseId,
            course_name: s.courseName,
            days_of_week: s.daysOfWeek,
            start_time: s.startTime,
            end_time: s.endTime,
          },
          { onConflict: "user_id,course_id" }
        );
        setHistory((h) => [...h, { role: "atlas", text: `Saved the schedule for ${s.courseName}.` }]);
      } else if (data.action?.type === "add_todo" && userId) {
        const t = data.action.todo;
        const { error: todoError } = await supabase
          .from("todos")
          .insert({ user_id: userId, text: t.text, done: false });
        setHistory((h) => [
          ...h,
          {
            role: "atlas",
            text: todoError
              ? "Couldn't add that to your list, Sir. Try again?"
              : `Added to your list: "${t.text}".`,
          },
        ]);
      } else if (data.action?.type === "add_note" && userId) {
        const n = data.action.note;
        const { error: noteError } = await supabase
          .from("notes_entries")
          .insert({ user_id: userId, content: n.content });
        setHistory((h) => [
          ...h,
          {
            role: "atlas",
            text: noteError ? "Couldn't save that note, Sir. Try again?" : "Saved a new note.",
          },
        ]);
      } else if (data.action?.type === "set_goal" && userId) {
        const g = data.action.goal;
        const { error: goalError } = await supabase.from("goals").insert({
          user_id: userId,
          label: g.label,
          period: g.period,
          period_start: startOfPeriod(g.period),
          pct: 0,
        });
        setHistory((h) => [
          ...h,
          {
            role: "atlas",
            text: goalError
              ? "Couldn't save that goal, Sir. Try again?"
              : `Added a new ${g.period}ly goal: "${g.label}".`,
          },
        ]);
      } else if (data.action?.type === "generate_pdf") {
        const p = data.action.pdf;
        try {
          const pdfRes = await fetch(GENERATE_PDF_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(await authHeaders()) },
            body: JSON.stringify({ title: p.title, content: p.content }),
          });
          if (!pdfRes.ok) throw new Error(`PDF endpoint returned ${pdfRes.status}`);

          const blob = await pdfRes.blob();
          const url = URL.createObjectURL(blob);
          setHistory((h) => [
            ...h,
            { role: "atlas", text: `Here's your PDF, Sir.`, pdf: { name: `${p.title}.pdf`, url } },
          ]);
        } catch {
          setHistory((h) => [
            ...h,
            { role: "atlas", text: "Couldn't generate that PDF, Sir. Try again?" },
          ]);
        }
      } else if (data.action?.type === "set_course_nickname") {
        const n = data.action.nickname;
        const { error: nicknameError } = await supabase
          .from("courses")
          .update({ nickname: n.nickname })
          .eq("id", n.courseId);
        setHistory((h) => [
          ...h,
          {
            role: "atlas",
            text: nicknameError
              ? "Couldn't save that nickname, Sir. Try again?"
              : `Got it. I'll call it "${n.nickname}" from now on.`,
          },
        ]);
      } else if (data.action?.type === "create_file") {
        const f = data.action.file;
        const safeName = f.filename.endsWith(".txt") ? f.filename : `${f.filename}.txt`;
        try {
          const blob = new Blob([f.content], { type: "text/plain" });
          const url = URL.createObjectURL(blob);
          setHistory((h) => [
            ...h,
            { role: "atlas", text: `Here's your file, Sir.`, file: { name: safeName, url } },
          ]);
        } catch {
          setHistory((h) => [
            ...h,
            { role: "atlas", text: "Couldn't put that file together, Sir. Try again?" },
          ]);
        }
      } else if (data.action?.type === "save_to_library" && userId) {
        const lib = data.action.library;
        try {
          const folderId = await resolveOrCreateFolderId(userId, lib.folderPath);
          const wantsPdf = lib.kind === "pdf";
          const safeName = wantsPdf
            ? lib.filename.endsWith(".pdf")
              ? lib.filename
              : `${lib.filename}.pdf`
            : lib.filename.includes(".")
              ? lib.filename
              : `${lib.filename}.txt`;

          let blob: Blob;
          if (wantsPdf) {
            const pdfRes = await fetch(GENERATE_PDF_ENDPOINT, {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(await authHeaders()) },
              body: JSON.stringify({ title: lib.filename, content: lib.content }),
            });
            if (!pdfRes.ok) throw new Error(`PDF endpoint returned ${pdfRes.status}`);
            blob = await pdfRes.blob();
          } else {
            blob = new Blob([lib.content], { type: "text/plain" });
          }

          const id = crypto.randomUUID();
          const storagePath = `${userId}/${id}-${safeName}`;
          const { error: uploadError } = await supabase.storage
            .from(LIBRARY_BUCKET)
            .upload(storagePath, blob, { contentType: wantsPdf ? "application/pdf" : "text/plain" });
          if (uploadError) throw uploadError;

          await supabase.from("library_files").insert({
            id,
            user_id: userId,
            folder_id: folderId,
            name: safeName,
            storage_path: storagePath,
            mime_type: wantsPdf ? "application/pdf" : "text/plain",
            size_bytes: blob.size,
            created_by: "atlas",
          });

          const { data: signed } = await supabase.storage
            .from(LIBRARY_BUCKET)
            .createSignedUrl(storagePath, LIBRARY_SIGNED_URL_TTL_SECONDS);

          setHistory((h) => [
            ...h,
            {
              role: "atlas",
              text: `Saved to your library under "${lib.folderPath || "Library"}", Sir.`,
              libraryFile: signed
                ? { name: safeName, url: signed.signedUrl, folderPath: lib.folderPath }
                : undefined,
            },
          ]);
        } catch {
          setHistory((h) => [
            ...h,
            { role: "atlas", text: "Couldn't save that to your library, Sir. Try again?" },
          ]);
        }
      } else if (data.action?.type === "fetch_from_library" && userId) {
        const lookup = data.action.libraryFetch;
        try {
          const { id: folderId, found } = await resolveFolderId(userId, lookup.folderPath);
          if (!found) {
            setHistory((h) => [
              ...h,
              { role: "atlas", text: `I can't find a "${lookup.folderPath}" folder in your library, Sir.` },
            ]);
          } else {
            const query = supabase
              .from("library_files")
              .select("name, storage_path")
              .eq("user_id", userId)
              .eq("name", lookup.filename);
            const fileResult =
              folderId === null
                ? await query.is("folder_id", null).maybeSingle()
                : await query.eq("folder_id", folderId).maybeSingle();
            const fileRow = fileResult.data;

            if (!fileRow) {
              setHistory((h) => [
                ...h,
                { role: "atlas", text: `I can't find "${lookup.filename}" in there, Sir.` },
              ]);
            } else {
              const { data: signed, error: signError } = await supabase.storage
                .from(LIBRARY_BUCKET)
                .createSignedUrl(fileRow.storage_path, LIBRARY_SIGNED_URL_TTL_SECONDS);
              if (signError || !signed) throw signError ?? new Error("No signed URL");

              setHistory((h) => [
                ...h,
                {
                  role: "atlas",
                  text: `Here it is, Sir.`,
                  libraryFile: { name: fileRow.name, url: signed.signedUrl, folderPath: lookup.folderPath },
                },
              ]);
            }
          }
        } catch {
          setHistory((h) => [
            ...h,
            { role: "atlas", text: "Couldn't pull that up from your library, Sir. Try again?" },
          ]);
        }
      }
    } catch {
      setError("Couldn't reach Atlas — check that /api/atlas/chat is deployed.");
    } finally {
      setSending(false);
    }
  }

  async function approveTask() {
    if (!pendingTask) return;
    setPosting(true);
    setError(null);

    try {
      const res = await fetch(CLASSROOM_CREATE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(pendingTask),
      });
      if (!res.ok) throw new Error(`Classroom endpoint returned ${res.status}`);

      setHistory((h) => [
        ...h,
        { role: "atlas", text: `Posted "${pendingTask.title}" to ${pendingTask.courseName}.` },
      ]);
      setPendingTask(null);
    } catch {
      setError("Couldn't post to Classroom — check /api/classroom/create-task.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-ink p-3.5 text-white md:rounded-3xl md:border-mist md:p-6">
      <style>{`
        .atlas-thin-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
        }
        .atlas-thin-scroll::-webkit-scrollbar {
          width: 3px;
        }
        .atlas-thin-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .atlas-thin-scroll::-webkit-scrollbar-thumb {
          background-color: rgba(255, 255, 255, 0.18);
          border-radius: 9999px;
        }
        .atlas-thin-scroll::-webkit-scrollbar-thumb:hover {
          background-color: rgba(255, 255, 255, 0.3);
        }

        @keyframes atlas-typing-bounce {
          0%, 60%, 100% {
            transform: translateY(0);
            opacity: 0.4;
          }
          30% {
            transform: translateY(-3px);
            opacity: 1;
          }
        }
        .atlas-typing-dot {
          animation: atlas-typing-bounce 1.1s ease-in-out infinite;
        }
      `}</style>

      <div className="flex items-center gap-2.5 md:gap-3">
        <div className="shrink-0">
          <AtlasOrb mode={sending ? "thinking" : mode === "notified" ? "searching" : "idle"} size={40} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-white/60 md:text-xs md:font-medium">
            Atlas
          </p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-white/90 md:mt-0 md:text-sm">
            {greeting}
          </p>
        </div>
      </div>

      <div className="mt-3 h-px w-full bg-white/10 md:mt-4" />

      {(history.length > 0 || sending) && (
        <ul className="atlas-thin-scroll mt-3 max-h-52 space-y-2 overflow-y-auto pr-1 md:mt-4 md:max-h-40 md:space-y-2">
          {history.map((msg, i) => (
            <li key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-snug md:px-3.5 md:py-2 md:text-sm ${
                  msg.role === "user"
                    ? "rounded-br-md bg-white text-ink"
                    : "rounded-bl-md border border-white/10 bg-white/[0.08] text-white md:border-0 md:bg-white/10"
                }`}
              >
                <FormattedMessage text={msg.text} />
                {msg.pdf && (
                  <a
                    href={msg.pdf.url}
                    download={msg.pdf.name}
                    className={`mt-1.5 flex w-fit items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      msg.role === "user"
                        ? "border-ink/10 text-ink/70 hover:border-ink/20 hover:text-ink"
                        : "border-white/15 text-white/80 hover:border-white/30 hover:text-white"
                    }`}
                  >
                    ➤  {msg.pdf.name}
                  </a>
                )}
                {msg.file && (
                  <a
                    href={msg.file.url}
                    download={msg.file.name}
                    className={`mt-1.5 flex w-fit items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      msg.role === "user"
                        ? "border-ink/10 text-ink/70 hover:border-ink/20 hover:text-ink"
                        : "border-white/15 text-white/80 hover:border-white/30 hover:text-white"
                    }`}
                  >
                    ➤  {msg.file.name}
                  </a>
                )}
                {msg.libraryFile && (
                  <a
                    href={msg.libraryFile.url}
                    target="_blank"
                    rel="noreferrer"
                    className={`mt-1.5 flex w-fit items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      msg.role === "user"
                        ? "border-ink/10 text-ink/70 hover:border-ink/20 hover:text-ink"
                        : "border-white/15 text-white/80 hover:border-white/30 hover:text-white"
                    }`}
                  >
                    🗀  {msg.libraryFile.name}
                  </a>
                )}
              </div>
            </li>
          ))}

          {sending && (
            <li className="flex justify-start">
              <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.08] px-3.5 py-2.5 md:border-0 md:bg-white/10">
                <span
                  className="atlas-typing-dot h-1.5 w-1.5 rounded-full bg-white/60"
                  style={{ animationDelay: "0ms" }}
                />
                <span
                  className="atlas-typing-dot h-1.5 w-1.5 rounded-full bg-white/60"
                  style={{ animationDelay: "150ms" }}
                />
                <span
                  className="atlas-typing-dot h-1.5 w-1.5 rounded-full bg-white/60"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
            </li>
          )}
        </ul>
      )}

      {pendingTask && (
        <PendingTaskCard
          task={pendingTask}
          sending={posting}
          onApprove={approveTask}
          onCancel={() => setPendingTask(null)}
        />
      )}

      {pendingSubmission && (
        <PendingSubmissionCard
          submission={pendingSubmission}
          onDone={() => {
            setHistory((h) => [
              ...h,
              { role: "atlas", text: `Turned in "${pendingSubmission.taskTitle}".` },
            ]);
            setPendingSubmission(null);
            if (userId) {
              supabase.from("pending_submissions").delete().eq("user_id", userId);
            }
          }}
          onCancel={() => {
            setPendingSubmission(null);
            if (userId) {
              supabase.from("pending_submissions").delete().eq("user_id", userId);
            }
          }}
        />
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage(draft);
        }}
        className="mt-3 flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.06] py-1.5 pl-3.5 pr-1.5 transition-colors duration-150 focus-within:border-white/20 focus-within:bg-white/[0.09] md:mt-4 md:border-white/15 md:bg-white/5 md:py-1.5 md:focus-within:border-white/15 md:focus-within:bg-white/5"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask Atlas anything…"
          disabled={sending}
          className="w-full bg-transparent text-[14px] text-white placeholder:text-white/40 outline-none disabled:cursor-not-allowed md:text-sm"
        />
        <button
          type="button"
          onClick={() => setVoiceOpen(true)}
          aria-label="Start voice mode"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/70 transition-all duration-150 hover:bg-white/10 hover:text-white active:scale-90 md:h-11 md:w-11 md:bg-transparent md:active:scale-100"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5 md:h-4 md:w-4">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" strokeLinecap="round" />
            <path d="M12 18v3" strokeLinecap="round" />
          </svg>
        </button>
      </form>
      <p className="mt-1.5 text-[10.5px] text-white/40 md:mt-2 md:text-[11px]">
        {error ?? "Atlas always asks before posting anything to Classroom."}
      </p>

      {voiceOpen && (
        <VoiceModeOverlay
          history={history}
          sending={sending}
          sendMessage={sendMessage}
          onClose={() => setVoiceOpen(false)}
        />
      )}
    </div>
  );
}