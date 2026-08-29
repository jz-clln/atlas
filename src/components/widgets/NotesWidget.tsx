import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useSession } from "../../lib/useSession";
import { WidgetCard } from "../WidgetCard";

type Note = { id: string; content: string; created_at: string };

export function NotesWidget() {
  const { session } = useSession();
  const userId = session?.user?.id;

  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    setLoading(true);
    supabase
      .from("notes_entries")
      .select("id, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data) setNotes(data);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function addNote() {
    const content = draft.trim();
    if (!content || !userId) return;
    setDraft("");

    const { data, error } = await supabase
      .from("notes_entries")
      .insert({ user_id: userId, content })
      .select("id, content, created_at")
      .single();

    if (!error && data) setNotes((n) => [data, ...n]);
  }

  async function remove(id: string) {
    const prev = notes;
    setNotes((n) => n.filter((item) => item.id !== id));
    const { error } = await supabase.from("notes_entries").delete().eq("id", id);
    if (error) setNotes(prev);
  }

  return (
    <WidgetCard title="Notes">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          addNote();
        }}
        className="flex gap-2"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write something down…"
          disabled={!userId}
          rows={2}
          className="w-full resize-none rounded-xl border border-mist bg-cloud px-3 py-2 text-sm text-charcoal outline-none focus:border-charcoal disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!userId}
          className="shrink-0 self-start rounded-xl bg-ink px-3 py-2 text-sm font-medium text-white transition-opacity active:opacity-70 disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {loading ? (
        <p className="mt-3 text-sm text-slate">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="mt-3 text-sm text-slate">No notes yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {notes.map((note) => (
            <li
              key={note.id}
              className="flex items-start justify-between gap-2 rounded-xl border border-mist bg-cloud px-3 py-2"
            >
              <p className="whitespace-pre-wrap text-sm text-charcoal">{note.content}</p>
              <button
                onClick={() => remove(note.id)}
                aria-label="Remove note"
                className="shrink-0 text-xs text-slate hover:text-charcoal"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}