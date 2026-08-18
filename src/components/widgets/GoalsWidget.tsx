import { WidgetCard } from "../WidgetCard";

const PLACEHOLDER_GOALS = [
  { label: "Finish this week's assignments", pct: 60 },
  { label: "Study 5 hrs for midterms", pct: 20 },
];

// Skeleton: shows what goal-tracking will look like once users can set
// their own goals. Swap PLACEHOLDER_GOALS for real state + a form to add.
export function GoalsWidget() {
  return (
    <WidgetCard title="Goals" comingSoon>
      <ul className="space-y-3">
        {PLACEHOLDER_GOALS.map((goal) => (
          <li key={goal.label}>
            <div className="flex items-center justify-between text-sm">
              <span className="text-charcoal">{goal.label}</span>
              <span className="text-xs text-slate">{goal.pct}%</span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-cloud">
              <div className="h-full rounded-full bg-mist" style={{ width: `${goal.pct}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-slate">
        Example goals — setting your own is coming soon.
      </p>
    </WidgetCard>
  );
}