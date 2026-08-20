import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useSession } from "../../lib/useSession";
import { WidgetCard } from "../WidgetCard";

type Goal = { id: string; label: string; period: "week" | "month"; pct: number; period_start: string };

/** Monday for "week", the 1st for "month" — matches AtlasWidget's startOfPeriod. */
function startOfPeriod(period: "week" | "month"): string {
  const now = new Date();
  if (period === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  }
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  return monday.toISOString().slice(0, 10);
}

export function GoalsWidget() {
  const { session } = useSession();
  const userId = session?.user?.id;

  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    setLoading(true);
    supabase
      .from("goals")
      .select("id, label, period, pct, period_start")
      .eq("user_id", userId)
      // Only the current week's and current month's goals — older ones
      // stay in the table for history but drop off this view.
      .in("period_start", [startOfPeriod("week"), startOfPeriod("month")])
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data) setGoals(data);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <WidgetCard title="Goals">
      {loading ? (
        <p className="text-sm text-slate">Loading…</p>
      ) : goals.length === 0 ? (
        <p className="text-sm text-slate">
          No goals yet. Try telling Atlas something like "set a goal to finish 3 assignments this
          week."
        </p>
      ) : (
        <ul className="space-y-3">
          {goals.map((goal) => (
            <li key={goal.id}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-charcoal">{goal.label}</span>
                <span className="text-xs text-slate">{goal.pct}%</span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-cloud">
                <div className="h-full rounded-full bg-mist" style={{ width: `${goal.pct}%` }} />
              </div>
              <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate">This {goal.period}</p>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}