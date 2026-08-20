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
  // Only present on an "atlas" message that came with a generate_pdf action.
  pdf?: { name: string; url: string };
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
  | { type: "update_notes"; notes: { mode: "append" | "replace"; content: string } }
  | { type: "set_goal"; goal: { label: string; period: "week" | "month" } }
  | { type: "generate_pdf"; pdf: { title: string; content: string } };

// Signature widget: the seat for Atlas (Academic Tutor & Learning Assistance
// System).
//
// Contract with the backend (see api/atlas/chat.ts):
// - POST /api/atlas/chat, body: { message: string, history: AtlasMessage[] }
// - Auth: Supabase access token in the Authorization header
// - Response: { reply: string, action: null | ChatAction }
// - The server is expected to load the user's todos, notes, courses,
//   coursework, and goals and give Atlas all of it as context — Atlas
//   should never have to be told what's on the dashboard, it should
//   already know.
// - If action.type is "create_classroom_task", Atlas is PROPOSING a task —
//   it must never be posted without the user clicking "Post to Classroom"
//   on the confirmation card below.
// - If action.type is "submit_classroom_work", Atlas is PROPOSING a
//   submission (text answer or file) for an existing assignment — same
//   never-without-confirmation rule, handled by PendingSubmissionCard.
// - "add_todo", "update_notes", and "set_goal" are private (never touch
//   Classroom), so they save immediately, same as set_class_schedule —
//   no approve/cancel card needed for any of them.
// - "generate_pdf" fetches a rendered PDF from /api/atlas/generate-pdf and
//   attaches it to the reply message as a downloadable link.
const ATLAS_CHAT_ENDPOINT = "/api/atlas/chat";
const CLASSROOM_CREATE_ENDPOINT = "/api/classroom/create-task";
const GENERATE_PDF_ENDPOINT = "/api/atlas/generate-pdf";

/** Monday for "week", the 1st for "month" — used as the period_start key on goals. */
function startOfPeriod(period: "week" | "month"): string {
  const now = new Date();
  if (period === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  }
  const day = now.getDay(); // 0 = Sunday ... 6 = Saturday
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

  // Restores a draft submission left over from before a refresh, lost
  // connection, or closed tab — so a typed answer or in-progress file
  // submission isn't silently thrown away.
  useEffect(() => {
    if (!userId) return;

    supabase
      .from("pending_submissions")
      .select("course_id, course_name, course_work_id, task_title, mode, text_answer")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setPendingSubmission({
          courseId: data.course_id,
          courseName: data.course_name,
          courseWorkId: data.course_work_id,
          taskTitle: data.task_title,
          mode: data.mode as "text" | "file",
          textAnswer: data.text_answer ?? undefined,
        });
      });
  }, [userId]);

  // Atlas speaks up on its own the moment the cron job finds a new
  // Classroom announcement — no chat message from the user required.
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
        const s = data.action.submission;
        setPendingSubmission(s);
        if (userId) {
          await supabase.from("pending_submissions").upsert({
            user_id: userId,
            course_id: s.courseId,
            course_name: s.courseName,
            course_work_id: s.courseWorkId,
            task_title: s.taskTitle,
            mode: s.mode,
            text_answer: s.textAnswer ?? null,
          });
        }
      } else if (data.action?.type === "set_class_schedule" && userId) {
        // No Classroom posting involved, so this saves right away rather
        // than needing an approve/cancel card.
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
      } else if (data.action?.type === "update_notes" && userId) {
        const n = data.action.notes;
        const { data: existing } = await supabase
          .from("notes")
          .select("content")
          .eq("user_id", userId)
          .maybeSingle();

        const nextContent =
          n.mode === "append" && existing?.content ? `${existing.content}\n${n.content}` : n.content;

        const { error: notesError } = await supabase
          .from("notes")
          .upsert({ user_id: userId, content: nextContent, updated_at: new Date().toISOString() });

        setHistory((h) => [
          ...h,
          {
            role: "atlas",
            text: notesError ? "Couldn't update your notes, Sir. Try again?" : "Updated your notes.",
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
    <div className="w-full rounded-3xl border border-mist bg-ink p-6 text-white">
      {/* Scoped styles for the thin scrollbar and the thinking-dots animation.
          Kept local to this component so no global CSS or new dependency
          (e.g. framer-motion) is required. */}
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

      <div className="flex items-center gap-3">
        <AtlasOrb mode={sending ? "thinking" : mode === "notified" ? "searching" : "idle"} size={48} />
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-white/60">Atlas</p>
          <p className="text-sm text-white/90">{greeting}</p>
        </div>
      </div>

      <div className="mt-4 h-px w-full bg-white/10" />

      {(history.length > 0 || sending) && (
        <ul className="atlas-thin-scroll mt-4 max-h-40 space-y-2 overflow-y-auto pr-1">
          {history.map((msg, i) => (
            <li
              key={i}
              className={`text-sm ${msg.role === "user" ? "text-white/70" : "text-white"}`}
            >
              <span className="text-white/40">{msg.role === "user" ? "You: " : "Atlas: "}</span>
              <FormattedMessage text={msg.text} />
              {msg.pdf && (
                <a
                  href={msg.pdf.url}
                  download={msg.pdf.name}
                  className="mt-1 flex w-fit items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs font-medium text-white/80 transition-colors hover:border-white/30 hover:text-white"
                >
                  📄 {msg.pdf.name}
                </a>
              )}
            </li>
          ))}

          {sending && (
            <li className="flex items-center gap-1.5 text-sm text-white">
              <span className="text-white/40">Atlas: </span>
              <span className="flex items-center gap-1">
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
              </span>
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
        className="mt-4 flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask Atlas anything…"
          disabled={sending}
          className="w-full bg-transparent text-sm text-white placeholder:text-white/40 outline-none disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={() => setVoiceOpen(true)}
          aria-label="Start voice mode"
          className="shrink-0 rounded-full border border-white/15 p-2 text-white/70 transition-colors hover:border-white/30 hover:text-white"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" strokeLinecap="round" />
            <path d="M12 18v3" strokeLinecap="round" />
          </svg>
        </button>
      </form>
      <p className="mt-2 text-[11px] text-white/40">
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