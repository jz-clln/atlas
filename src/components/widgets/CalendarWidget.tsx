import { useMemo } from "react";
import { WidgetCard } from "../WidgetCard";

type Props = {
  dueDates?: Date[];
};

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export function CalendarWidget({ dueDates = [] }: Props) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  const weeks = useMemo(() => {
    const first = new Date(year, month, 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: (number | null)[] = [
      ...Array(startOffset).fill(null),
      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];
    while (cells.length % 7 !== 0) cells.push(null);

    const rows: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [year, month]);

  const dueDays = useMemo(
    () =>
      new Set(
        dueDates
          .filter((d) => d.getFullYear() === year && d.getMonth() === month)
          .map((d) => d.getDate())
      ),
    [dueDates, year, month]
  );

  const monthLabel = today.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <WidgetCard title="Calendar">
      <p className="text-sm font-medium text-ink">{monthLabel}</p>
      <div className="mt-3 grid grid-cols-7 gap-y-1 text-center">
        {WEEKDAY_LABELS.map((d, i) => (
          <span key={i} className="text-[10px] font-medium text-slate">
            {d}
          </span>
        ))}
        {weeks.flat().map((day, i) => {
          const isToday = day === today.getDate();
          const hasDue = day != null && dueDays.has(day);
          return (
            <span
              key={i}
              className={`relative flex h-7 items-center justify-center rounded-full text-xs ${
                isToday ? "bg-ink font-medium text-white" : "text-charcoal"
              }`}
            >
              {day ?? ""}
              {hasDue && !isToday && (
                <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-ink" />
              )}
            </span>
          );
        })}
      </div>
    </WidgetCard>
  );
}