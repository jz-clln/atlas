import { useState } from "react";

type Props = {
  greeting: string;
};

type AtlasMessage = { role: "user" | "atlas"; text: string };

// Signature widget: the seat for Atlas (Academic Tutor & Learning Assistance
// System). Every other widget on the dashboard is meant to eventually be
// readable/actionable by Atlas — this is where that shows up visually.
//
// Wiring notes for when the backend endpoint exists:
// - Point ATLAS_ENDPOINT at your route (e.g. POST /api/atlas/chat).
// - Expected request body: { message: string, history: AtlasMessage[] }
// - Expected response body: { reply: string }
// - Auth: send the Supabase session's access token so the endpoint can scope
//   Atlas's tool access (todos/notes/coursework) to that user.
// - Voice: once you add speech-to-text, feed its transcript into sendMessage
//   the same way typed input is handled below — the mic button just needs
//   its handler swapped in.
const ATLAS_ENDPOINT = "/api/atlas/chat";

export function AtlasWidget({ greeting }: Props) {
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<AtlasMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setDraft("");
    setError(null);
    const nextHistory = [...history, { role: "user" as const, text: trimmed }];
    setHistory(nextHistory);
    setSending(true);

    try {
      const res = await fetch(ATLAS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history }),
      });
      if (!res.ok) throw new Error(`Atlas endpoint returned ${res.status}`);

      const data = await res.json();
      setHistory([...nextHistory, { role: "atlas", text: data.reply }]);
    } catch {
      setError("Couldn't reach Atlas — the backend endpoint isn't live yet.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="w-full rounded-3xl border border-mist bg-ink p-6 text-white">
      <div className="flex items-center gap-3">
        <span className="h-9 w-9 shrink-0 rounded-full bg-gradient-to-br from-white/80 to-white/20" />
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-white/60">Atlas</p>
          <p className="text-sm text-white/90">{greeting}</p>
        </div>
      </div>

      {history.length > 0 && (
        <ul className="mt-4 max-h-40 space-y-2 overflow-y-auto">
          {history.map((msg, i) => (
            <li
              key={i}
              className={`text-sm ${msg.role === "user" ? "text-white/70" : "text-white"}`}
            >
              <span className="text-white/40">{msg.role === "user" ? "You: " : "Atlas: "}</span>
              {msg.text}
            </li>
          ))}
        </ul>
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
          disabled
          aria-label="Voice command — coming soon"
          className="shrink-0 cursor-not-allowed rounded-full border border-white/15 p-2 text-white/50"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" strokeLinecap="round" />
            <path d="M12 18v3" strokeLinecap="round" />
          </svg>
        </button>
      </form>
      <p className="mt-2 text-[11px] text-white/40">
        {error ?? "Voice commands are coming soon — the chat above is live once you build the backend endpoint."}
      </p>
    </div>
  );
}