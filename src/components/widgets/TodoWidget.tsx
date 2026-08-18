import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useSession } from "../../lib/useSession";
import { WidgetCard } from "../WidgetCard";
import { PendingTaskCard, type PendingClassroomTask } from "../PendingTaskCard";

type Todo = { id: string; text: string; done: boolean; sent_to_classroom: boolean };
type Course = { id: string; name: string };

type Props = {
  courses?: Course[];
};

const CLASSROOM_CREATE_ENDPOINT = "/api/classroom/create-task";

export function TodoWidget({ courses = [] }: Props) {
  const { session } = useSession();
  const userId = session?.user?.id;

  const [todos, setTodos] = useState<Todo[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);

  const [sendingTodoId, setSendingTodoId] = useState<string | null>(null);
  const [pendingCourseId, setPendingCourseId] = useState<string>(courses[0]?.id ?? "");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    setLoading(true);
    supabase
      .from("todos")
      .select("id, text, done, sent_to_classroom")
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

  async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

  async function addTodo() {
    const text = draft.trim();
    if (!text || !userId) return;
    setDraft("");

    const { data, error } = await supabase
      .from("todos")
      .insert({ user_id: userId, text, done: false })
      .select("id, text, done, sent_to_classroom")
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
      setTodos((t) => t.map((item) => (item.id === id ? { ...item, done: current.done } : item)));
    }
  }

  async function remove(id: string) {
    const prev = todos;
    setTodos((t) => t.filter((item) => item.id !== id));
    if (sendingTodoId === id) setSendingTodoId(null);
    const { error } = await supabase.from("todos").delete().eq("id", id);
    if (error) setTodos(prev);
  }

  function startSend(id: string) {
    setError(null);
    setPendingCourseId(courses[0]?.id ?? "");
    setSendingTodoId(id);
  }

  async function confirmSend() {
    const todo = todos.find((t) => t.id === sendingTodoId);
    const course = courses.find((c) => c.id === pendingCourseId);
    if (!todo || !course) return;

    setPosting(true);
    setError(null);

    const task: PendingClassroomTask = {
      courseId: course.id,
      courseName: course.name,
      title: todo.text,
    };

    try {
      const res = await fetch(CLASSROOM_CREATE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(task),
      });
      if (!res.ok) throw new Error(`Classroom endpoint returned ${res.status}`);

      await supabase.from("todos").update({ sent_to_classroom: true }).eq("id", todo.id);
      setTodos((t) =>
        t.map((item) => (item.id === todo.id ? { ...item, sent_to_classroom: true } : item))
      );
      setSendingTodoId(null);
    } catch {
      setError("Couldn't post to Classroom — check /api/classroom/create-task.");
    } finally {
      setPosting(false);
    }
  }

  const sendingTodo = todos.find((t) => t.id === sendingTodoId);

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
                className={`flex-1 truncate text-sm ${
                  item.done ? "text-slate line-through" : "text-charcoal"
                }`}
              >
                {item.text}
              </span>

              {item.sent_to_classroom ? (
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-slate">
                  Sent
                </span>
              ) : (
                courses.length > 0 && (
                  <button
                    onClick={() => startSend(item.id)}
                    className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-slate hover:text-charcoal"
                  >
                    → Classroom
                  </button>
                )
              )}
              <button
                onClick={() => remove(item.id)}
                aria-label="Remove task"
                className="shrink-0 text-xs text-slate hover:text-charcoal"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {sendingTodo && (
        <div className="mt-3 rounded-xl border border-mist bg-cloud p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate">
            Send to which class?
          </p>
          <select
            value={pendingCourseId}
            onChange={(e) => setPendingCourseId(e.target.value)}
            className="mt-2 w-full rounded-lg border border-mist bg-white px-2 py-1.5 text-sm text-ink"
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <div className="mt-2 rounded-xl bg-ink p-1">
            <PendingTaskCard
              task={{
                courseId: pendingCourseId,
                courseName: courses.find((c) => c.id === pendingCourseId)?.name ?? "",
                title: sendingTodo.text,
              }}
              sending={posting}
              onApprove={confirmSend}
              onCancel={() => setSendingTodoId(null)}
            />
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-slate">{error}</p>}
    </WidgetCard>
  );
}