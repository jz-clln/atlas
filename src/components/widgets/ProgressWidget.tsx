import { WidgetCard } from "../WidgetCard";

type Props = {
  completed: number;
  total: number;
};

export function ProgressWidget({ completed, total }: Props) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <WidgetCard title="Progress">
      <div className="flex items-baseline justify-between">
        <p className="text-3xl font-semibold text-ink">{pct}%</p>
        <p className="text-xs text-slate">
          {completed} of {total} done
        </p>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-cloud">
        <div
          className="h-full rounded-full bg-ink transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </WidgetCard>
  );
}