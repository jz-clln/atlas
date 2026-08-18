import { useState } from "react";
import { signOut } from "../lib/supabase";
import { useSession } from "../lib/useSession";
import { useClassroomSync } from "../lib/useClassroomSync";
import type { CourseworkItem } from "../lib/useClassroomSync";
import { LoadingScreen } from "../components/LoadingScreen";
import { TaskDetailSheet } from "../components/TaskDetailSheet";

export function Dashboard() {
  const { session } = useSession();
  const { courses, coursework, loading, error, refetch } = useClassroomSync();
  const [showDone, setShowDone] = useState(false);
  const [selected, setSelected] = useState<CourseworkItem | null>(null);

  const user = session?.user;
  const firstName = user?.user_metadata?.full_name?.split(" ")[0] ?? "boss";

  if (loading) {
    return <LoadingScreen label={`Hey ${firstName}, I'm looking for your assignments`} />;
  }

  const hour = new Date().getHours();
  const timeGreeting =
    hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : hour < 22 ? "Evening" : "Still up, huh";

  const active = coursework.filter((c) => !c.is_done);
  const done = coursework.filter((c) => c.is_done);

  const upcoming = active
    .filter((c) => c.due_at)
    .sort((a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime());

  const dueThisWeek = upcoming.filter((c) => {
    const due = new Date(c.due_at!).getTime();
    return due - Date.now() < 7 * 24 * 60 * 60 * 1000;
  });

  function courseName(courseId: string) {
    return courses.find((c) => c.id === courseId)?.name ?? "Unknown course";
  }

  return (
    <div className="min-h-screen bg-cloud">
      <header className="flex items-center justify-between border-b border-mist px-8 py-5">
        <p className="text-lg font-semibold text-ink">ATLAS</p>
        <button
          onClick={() => signOut()}
          className="rounded-full border border-mist px-4 py-2 text-sm font-medium text-charcoal transition-colors hover:border-ink hover:text-ink"
        >
          Sign out
        </button>
      </header>

      <main className="mx-auto max-w-2xl px-8 py-16">
        <h2 className="text-3xl font-semibold leading-snug text-ink">
          Good {timeGreeting}, {firstName}.
          <br />
          <span className="text-charcoal">
            {dueThisWeek.length > 0
              ? `${dueThisWeek.length} thing${dueThisWeek.length === 1 ? "" : "s"} due this week.`
              : "All clear for now."}
          </span>
        </h2>

        {error && (
          <div className="mt-6 rounded-sm border border-mist bg-white px-4 py-3 text-sm text-charcoal">
            Couldn't sync: {error}{" "}
            <button onClick={refetch} className="underline hover:text-ink">
              try again
            </button>
          </div>
        )}

        {!loading && !error && active.length === 0 && (
          <p className="mt-6 text-sm leading-relaxed text-charcoal">
            Nothing pending. Everything's either turned in or there's nothing
            posted yet.
          </p>
        )}

        {upcoming.length > 0 && (
          <ul className="mt-10 divide-y divide-mist border-y border-mist">
            {upcoming.map((item) => (
              <CourseworkRow
                key={item.id}
                item={item}
                courseName={courseName(item.course_id)}
                onSelect={() => setSelected(item)}
              />
            ))}
          </ul>
        )}

        {done.length > 0 && (
          <div className="mt-8">
            <button
              onClick={() => setShowDone((v) => !v)}
              className="text-xs font-medium text-slate hover:text-charcoal"
            >
              {showDone ? "Hide" : "Show"} {done.length} finished
            </button>

            {showDone && (
              <ul className="mt-4 divide-y divide-mist border-y border-mist opacity-60">
                {done.map((item) => (
                  <CourseworkRow
                    key={item.id}
                    item={item}
                    courseName={courseName(item.course_id)}
                    onSelect={() => setSelected(item)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </main>

      <TaskDetailSheet
        item={selected}
        courseName={selected ? courseName(selected.course_id) : ""}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function CourseworkRow({
  item,
  courseName,
  onSelect,
}: {
  item: CourseworkItem;
  courseName: string;
  onSelect: () => void;
}) {
  const due = item.due_at ? new Date(item.due_at) : null;
  const dueLabel = due
    ? due.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;

  return (
    <li>
      <button
        onClick={onSelect}
        className="flex w-full items-center justify-between gap-4 py-4 text-left transition-opacity active:opacity-60"
      >
        <div>
          <p className="text-sm font-medium text-ink">{item.title}</p>
          <p className="mt-0.5 text-xs text-slate">{courseName}</p>
        </div>
        {dueLabel && (
          <span className="whitespace-nowrap text-xs font-medium text-charcoal">
            {dueLabel}
          </span>
        )}
      </button>
    </li>
  );
}