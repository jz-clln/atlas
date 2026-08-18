import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useSession } from "../../lib/useSession";
import { WidgetCard } from "../WidgetCard";

type Todo = { id: string; text: string; done: boolean };

export function TodoWidget() {
  const { session } = useSession();
  const userId = session?.user?.id;

  const [todos, setTodos] = useState<Todo[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    setLoading(true);
    supabase
      .from("todos")
      .select("id, text, done")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data) setTodos(data);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function addTodo() {
    const text = draft.trim();
    if (!text || !userId) return;
    setDraft("");

    const { data, error } = await supabase
      .from("todos")
      .insert({ user_id: userId, text, done: false })
      .select("id, text, done")
      .single();

    if (!error && data) setTodos((t) => [...t, data]);
  }

  async function toggle(id: string) {
    const current = todos.find((t) => t.id === id);
    if (!current) return;
    const nextDone = !current.done;

    setTodos((t) => t.map((item) => (item.id === id ? { ...item, done: nextDone } : item)));
    const { error } = await supabase.from("todos").update({ done: nextDone }).eq("id", id);
    if (error) {
      // Revert on failure.
      setTodos((t) => t.map((item) => (item.id === id ? { ...item, done: current.done } : item)));
    }
  }

  async function remove(id: string) {
    const prev = todos;
    setTodos((t) => t.filter((item) => item.id !== id));
    const { error } = await supabase.from("todos").delete().eq("id", id);
    if (error) setTodos(prev);
  }

  return (
    <WidgetCard title="To-do">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          addTodo();
        }}
        className="flex gap-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a task"
          disabled={!userId}
          className="w-full rounded-xl border border-mist bg-cloud px-3 py-2 text-sm text-ink outline-none focus:border-charcoal disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!userId}
          className="shrink-0 rounded-xl bg-ink px-3 py-2 text-sm font-medium text-white transition-opacity active:opacity-70 disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {loading ? (
        <p className="mt-3 text-sm text-slate">Loading…</p>
      ) : todos.length === 0 ? (
        <p className="mt-3 text-sm text-slate">Nothing on your list yet.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {todos.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              <button
                onClick={() => toggle(item.id)}
                aria-label={item.done ? "Mark as not done" : "Mark as done"}
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                  item.done ? "border-ink bg-ink" : "border-mist"
                }`}
              />
              <span
                className={`flex-1 text-sm ${item.done ? "text-slate line-through" : "text-charcoal"}`}
              >
                {item.text}
              </span>
              <button
                onClick={() => remove(item.id)}
                aria-label="Remove task"
                className="text-xs text-slate hover:text-charcoal"
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