import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useSession } from "../../lib/useSession";
import { AtlasOrb } from "../AtlasOrb";
import { FormattedMessage } from "../FormattedMessage";
import { PendingTaskCard, type PendingClassroomTask } from "../PendingTaskCard";
import { VoiceModeOverlay } from "../VoiceModeOverlay";

type Props = {
  greeting: string;
};

type AtlasMessage = { role: "user" | "atlas"; text: string };

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
    };

// Signature widget: the seat for Atlas (Academic Tutor & Learning Assistance
// System).
//
// Contract with the backend (see api/atlas/chat.ts):
// - POST /api/atlas/chat, body: { message: string, history: AtlasMessage[] }
// - Auth: Supabase access token in the Authorization header
// - Response: { reply: string, action: null | ChatAction }
// - The server is expected to load the user's todos, notes, courses, and
//   coursework and give Atlas all of it as context — Atlas should never
//   have to be told what's on the dashboard, it should already know.
// - If action.type is "create_classroom_task", Atlas is PROPOSING a task —
//   it must never be posted without the user clicking "Post to Classroom"
//   on the confirmation card below.
const ATLAS_CHAT_ENDPOINT = "/api/atlas/chat";
const CLASSROOM_CREATE_ENDPOINT = "/api/classroom/create-task";

export function AtlasWidget({ greeting }: Props) {
  const { session } = useSession();
  const userId = session?.user?.id;

  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<AtlasMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingTask, setPendingTask] = useState<PendingClassroomTask | null>(null);
  const [mode, setMode] = useState<"idle" | "notified">("idle");
  const [voiceOpen, setVoiceOpen] = useState(false);

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