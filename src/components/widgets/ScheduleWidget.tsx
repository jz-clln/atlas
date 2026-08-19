import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useSession } from "../../lib/useSession";
import { WidgetCard } from "../WidgetCard";

type Schedule = {
  id: string;
  course_id: string;
  course_name: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
};

type Course = { id: string; name: string };

type Props = {
  courses?: Course[];
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ScheduleWidget({ courses = [] }: Props) {
  const { session } = useSession();
  const userId = session?.user?.id;

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [days, setDays] = useState<number[]>([]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    supabase
      .from("class_schedules")
      .select("id, course_id, course_name, days_of_week, start_time, end_time")
      .eq("user_id", userId)
      .then(({ data }) => {
        if (cancelled) return;
        setSchedules(data ?? []);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  async function save() {
    if (!userId || !courseId || days.length === 0) return;
    const course = courses.find((c) => c.id === courseId);
    if (!course) return;

    const { data, error } = await supabase
      .from("class_schedules")
      .upsert(
        {
          user_id: userId,
          course_id: courseId,
          course_name: course.name,
          days_of_week: days,
          start_time: startTime,
          end_time: endTime,
        },
        { onConflict: "user_id,course_id" }
      )
      .select("id, course_id, course_name, days_of_week, start_time, end_time")
      .single();

    if (!error && data) {
      setSchedules((prev) => [...prev.filter((s) => s.course_id !== courseId), data]);
      setDays([]);
    }
  }

  async function remove(id: string) {
    const prev = schedules;
    setSchedules((s) => s.filter((x) => x.id !== id));
    const { error } = await supabase.from("class_schedules").delete().eq("id", id);
    if (error) setSchedules(prev);
  }

  return (
    <WidgetCard title="Schedule">
      {loading ? (
        <p className="text-sm text-slate">Loading…</p>
      ) : (
        <>
          {schedules.length === 0 ? (
            <p className="text-sm text-slate">
              No subjects scheduled yet. Set one below, or just tell Atlas.
            </p>
          ) : (
            <ul className="space-y-2">
              {schedules.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-xl border border-mist px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium text-ink">{s.course_name}</p>
                    <p className="text-xs text-slate">
                      {s.days_of_week.map((d) => DAY_LABELS[d]).join(" ")} · {s.start_time}–
                      {s.end_time}
                    </p>
                  </div>
                  <button
                    onClick={() => remove(s.id)}
                    aria-label="Remove schedule"
                    className="text-xs text-slate hover:text-charcoal"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          {courses.length > 0 && (
            <div className="mt-3 space-y-2 rounded-xl border border-dashed border-mist p-3">
              <select
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                className="w-full rounded-lg border border-mist bg-white px-2 py-1.5 text-sm text-ink"
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <div className="flex flex-wrap gap-1">
                {DAY_LABELS.map((label, i) => (
                  <button
                    key={i}
                    onClick={() => toggleDay(i)}
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      days.includes(i) ? "bg-ink text-white" : "bg-cloud text-charcoal"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full rounded-lg border border-mist bg-white px-2 py-1.5 text-sm text-ink"
                />
                <span className="text-xs text-slate">to</span>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full rounded-lg border border-mist bg-white px-2 py-1.5 text-sm text-ink"
                />
              </div>

              <button
                onClick={save}
                disabled={days.length === 0}
                className="w-full rounded-lg bg-ink py-1.5 text-sm font-medium text-white transition-opacity active:opacity-70 disabled:opacity-40"
              >
                Save schedule
              </button>
            </div>
          )}
        </>
      )}
    </WidgetCard>
  );
}