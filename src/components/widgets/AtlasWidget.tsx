import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useSession } from "../../lib/useSession";
import { AtlasOrb } from "../AtlasOrb";
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
      <div className="flex items-center gap-3 border-b border-white/10 pb-4">
        <AtlasOrb mode={sending ? "thinking" : mode === "notified" ? "searching" : "idle"} size={48} />
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-white/60">Atlas</p>
          <p className="text-sm text-white/90">{greeting}</p>
        </div>
      </div>

      {(history.length > 0 || sending) && (
        <div
          className="mt-4 max-h-40 space-y-2 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-thumb:hover]:bg-white/25"
          style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.15) transparent" }}
        >
          <style>{`
            @keyframes atlas-typing-dot {
              0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
              30% { transform: translateY(-3px); opacity: 1; }
            }
          `}</style>

          {history.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "rounded-br-sm bg-white text-ink"
                    : "rounded-bl-sm bg-white/10 text-white"
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-white/10 px-3.5 py-2.5">
                <span
                  className="h-1.5 w-1.5 rounded-full bg-white/70"
                  style={{
                    animation: "atlas-typing-dot 1.3s cubic-bezier(0.45, 0, 0.55, 1) infinite",
                    animationDelay: "0ms",
                  }}
                />
                <span
                  className="h-1.5 w-1.5 rounded-full bg-white/70"
                  style={{
                    animation: "atlas-typing-dot 1.3s cubic-bezier(0.45, 0, 0.55, 1) infinite",
                    animationDelay: "160ms",
                  }}
                />
                <span
                  className="h-1.5 w-1.5 rounded-full bg-white/70"
                  style={{
                    animation: "atlas-typing-dot 1.3s cubic-bezier(0.45, 0, 0.55, 1) infinite",
                    animationDelay: "320ms",
                  }}
                />
              </div>
            </div>
          )}
        </div>
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