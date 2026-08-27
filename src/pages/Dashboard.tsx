import { useEffect, useState, type ReactNode } from "react";
import { signOut, supabase } from "../lib/supabase";
import { useSession } from "../lib/useSession";
import { useClassroomSync } from "../lib/useClassroomSync";
import type { CourseworkItem } from "../lib/useClassroomSync";
import { LoadingScreen } from "../components/LoadingScreen";
import { TaskDetailSheet } from "../components/TaskDetailSheet";
import { AtlasWidget } from "../components/widgets/AtlasWidget";
import { ClockWidget } from "../components/widgets/ClockWidget";
import { CalendarWidget } from "../components/widgets/CalendarWidget";
import { ProgressWidget } from "../components/widgets/ProgressWidget";
import { WidgetDock } from "../components/WidgetDock";

export function Dashboard() {
  const { session } = useSession();
  const { courses, coursework, loading, error, refetch } = useClassroomSync();
  const [showDone, setShowDone] = useState(false);
  const [selected, setSelected] = useState<CourseworkItem | null>(null);
  const [nicknames, setNicknames] = useState<Record<string, string>>({});

  // Drives only the compact "Now" tile in the mobile stats row below — a
  // separate, lighter tick than ClockWidget's own (desktop keeps using
  // ClockWidget exactly as before, unaffected by this).
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const user = session?.user;
  const firstName = user?.user_metadata?.full_name?.split(" ")[0] ?? "boss";

  // Nicknames live only in the courses table (set via Atlas chat), separate
  // from useClassroomSync's Google-facing sync — a lightweight lookup here
  // rather than threading it through the sync response.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    supabase
      .from("courses")
      .select("id, nickname")
      .eq("user_id", user.id)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const map: Record<string, string> = {};
        for (const row of data) {
          if (row.nickname) map[row.id] = row.nickname;
        }
        setNicknames(map);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  if (loading) {
    return <LoadingScreen label={`Hey ${firstName}! Looking for your assignments.`} />;
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
    const msUntilDue = new Date(c.due_at!).getTime() - Date.now();
    // Was previously just "< 7 days", which is also true for any negative
    // number — meaning overdue items were silently counted as "due this
    // week" instead of being excluded. Needs a floor at 0 too.
    return msUntilDue >= 0 && msUntilDue < 7 * 24 * 60 * 60 * 1000;
  });

  const dueDates = upcoming.filter((c) => c.due_at).map((c) => new Date(c.due_at!));

  const overdue = active.filter((c) => c.due_at && new Date(c.due_at).getTime() < Date.now());

  // Nickname wins whenever one's been set — this is the single place every
  // course-name display in this file reads from.
  function courseName(courseId: string) {
    if (nicknames[courseId]) return nicknames[courseId];
    return courses.find((c) => c.id === courseId)?.name ?? "Unknown course";
  }

  // Atlas's heads-up, built from what's actually synced — no classes posted,
  // nothing due, or a pointer to the most urgent thing coming up. Overdue
  // items get an explicit mention rather than silently disappearing, since
  // they're excluded from dueThisWeek by design.
  const atlasBrief =
    coursework.length === 0
      ? "Nothing's come through from Classroom yet. Check back in a few minutes."
      : active.length === 0
        ? "Everything's turned in. Nothing pending across any of your classes."
        : dueThisWeek.length === 0 && overdue.length === 0
          ? `${active.length} open item${active.length === 1 ? "" : "s"}, but nothing due in the next 7 days.`
          : dueThisWeek.length === 0
            ? `Nothing due in the next 7 days, but ${overdue.length} thing${overdue.length === 1 ? "" : "s"} overdue and still needs attention.`
            : overdue.length > 0
              ? `${dueThisWeek.length} due this week, and ${overdue.length} overdue. Next up is ${dueThisWeek[0].title} in ${courseName(dueThisWeek[0].course_id)}.`
              : `${dueThisWeek.length} due this week. Next up is ${dueThisWeek[0].title} in ${courseName(dueThisWeek[0].course_id)}.`;

  return (
    <div className="min-h-screen bg-cloud">
      {/* Nav bar — safe-area aware, tighter on mobile so it reads like a
          native iOS bar instead of a desktop header that got squeezed. */}
      <header
        className="sticky top-0 z-30 flex items-center justify-between border-b border-mist bg-cloud/80 px-5 py-4 backdrop-blur-md md:px-8 md:py-5"
        style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
      >
        <p className="text-base font-semibold tracking-tight text-ink md:text-lg">ATLAS</p>
        <button
          onClick={() => signOut()}
          className="flex min-h-9 items-center rounded-full border border-mist px-4 text-[13px] font-medium text-charcoal transition-colors active:bg-cloud md:min-h-0 md:py-2 md:text-sm md:hover:border-ink md:hover:text-ink"
        >
          Sign out
        </button>
      </header>

      <main
        className="mx-auto max-w-6xl px-5 pb-28 pt-6 md:px-8 md:py-16"
        style={{ paddingBottom: "max(7rem, calc(4.5rem + env(safe-area-inset-bottom)))" }}
      >
        <AtlasWidget greeting={atlasBrief} />

        <h2 className="mt-8 text-[26px] font-semibold leading-snug tracking-tight text-ink md:mt-10 md:text-3xl">
          Good {timeGreeting}, {firstName}.
          <br />
          <span className="text-charcoal">
            {dueThisWeek.length > 0
              ? `${dueThisWeek.length} thing${dueThisWeek.length === 1 ? "" : "s"} due this week.`
              : "All clear for now."}
          </span>
        </h2>

        {error && (
          <div className="mt-6 rounded-2xl border border-mist bg-white px-4 py-3 text-sm text-charcoal">
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

        {/* Compact stats row — mobile only. Three full WidgetCards in a
            scroll strip meant extra swiping/scrolling before reaching the
            task list, which is the opposite of "glanceable." This is a
            single non-scrolling row of small at-a-glance tiles instead —
            the iOS "home screen widget" size class, not the "app screen"
            size class. Desktop keeps the original full-size sidebar
            widgets untouched below. */}
        <div className="mt-5 grid grid-cols-3 gap-2 md:hidden">
          <StatTile label="Now">
            <p className="text-lg font-semibold tabular-nums text-ink">
              {now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-slate">
              {now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
            </p>
          </StatTile>

          <StatTile label="Progress">
            <p className="text-lg font-semibold text-ink">
              {coursework.length > 0 ? Math.round((done.length / coursework.length) * 100) : 0}%
            </p>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-cloud">
              <div
                className="h-full rounded-full bg-ink transition-all duration-500 ease-out"
                style={{
                  width: `${coursework.length > 0 ? Math.round((done.length / coursework.length) * 100) : 0}%`,
                }}
              />
            </div>
          </StatTile>

          <StatTile label="Remaining">
            <p className="text-lg font-semibold text-ink">{active.length}</p>
            <p className="mt-0.5 truncate text-[11px] text-slate">
              {overdue.length > 0 ? `${overdue.length} overdue` : "On track"}
            </p>
          </StatTile>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-8 md:mt-10 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {upcoming.length > 0 && (
              <ul className="divide-y divide-mist border-y border-mist">
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
          </div>

          {/* Desktop sidebar — unchanged, just hidden on mobile since the
              strip above covers the same widgets there. */}
          <div className="hidden space-y-4 md:block">
            <ClockWidget />
            <ProgressWidget completed={done.length} total={coursework.length} />
            <CalendarWidget dueDates={dueDates} />
          </div>
        </div>
      </main>

      <WidgetDock courses={courses.map((c) => ({ id: c.id, name: courseName(c.id) }))} />

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
        className="flex min-h-[64px] w-full items-center justify-between gap-3 py-4 text-left transition-opacity active:opacity-60"
      >
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-ink md:text-sm">{item.title}</p>
          <p className="mt-0.5 truncate text-xs text-slate">{courseName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {dueLabel && (
            <span className="whitespace-nowrap text-xs font-medium text-charcoal">
              {dueLabel}
            </span>
          )}
          <ChevronIcon />
        </div>
      </button>
    </li>
  );
}

function StatTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-mist bg-white px-3 py-2.5">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-slate">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className="h-3.5 w-3.5 shrink-0 text-mist md:hidden"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}