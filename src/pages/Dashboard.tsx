import { signOut } from "../lib/supabase";
import { useSession } from "../lib/useSession";
import { useClassroomSync } from "../lib/useClassroomSync";
import type { CourseworkItem } from "../lib/useClassroomSync";

export function Dashboard() {
  const { session } = useSession();
  const { courses, coursework, loading, error, refetch } = useClassroomSync();

  const user = session?.user;
  const firstName = user?.user_metadata?.full_name?.split(" ")[0] ?? "boss";

  const hour = new Date().getHours();
  const timeGreeting =
    hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : hour < 22 ? "Evening" : "Still up, huh";

  const upcoming = coursework
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
          {timeGreeting}, {firstName}.
          <br />
          <span className="text-charcoal">
            {loading
              ? "Pulling in your classes…"
              : dueThisWeek.length > 0
              ? `${dueThisWeek.length} thing${dueThisWeek.length === 1 ? "" : "s"} due this week.`
              : "Nothing due this week — you're clear."}
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

        {!loading && !error && coursework.length === 0 && (
          <p className="mt-6 text-sm leading-relaxed text-charcoal">
            No active coursework found. Either you're all caught up, or your
            classes aren't posting assignments through Classroom.
          </p>
        )}

        {upcoming.length > 0 && (
          <ul className="mt-10 divide-y divide-mist border-y border-mist">
            {upcoming.map((item) => (
              <CourseworkRow key={item.id} item={item} courseName={courseName(item.course_id)} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function CourseworkRow({
  item,
  courseName,
}: {
  item: CourseworkItem;
  courseName: string;
}) {
  const due = item.due_at ? new Date(item.due_at) : null;
  const dueLabel = due
    ? due.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;

  return (
    <li className="flex items-center justify-between gap-4 py-4">
      <div>
        <p className="text-sm font-medium text-ink">{item.title}</p>
        <p className="mt-0.5 text-xs text-slate">{courseName}</p>
      </div>
      {dueLabel && (
        <span className="whitespace-nowrap text-xs font-medium text-charcoal">
          {dueLabel}
        </span>
      )}
    </li>
  );
}