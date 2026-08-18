import { WidgetCard } from "../WidgetCard";

// Skeleton: once built, Atlas will generate this schedule from real due
// dates (via useClassroomSync) and the user's stated free time.
export function StudyPlannerWidget() {
  return (
    <WidgetCard title="Study planner" comingSoon>
      <p className="text-sm text-charcoal">
        Atlas will build a study schedule around your due dates and free time.
      </p>
      <div className="mt-3 space-y-2">
        {["Mon", "Tue", "Wed"].map((day) => (
          <div
            key={day}
            className="flex items-center gap-3 rounded-xl border border-dashed border-mist px-3 py-2"
          >
            <span className="w-8 text-xs font-medium text-slate">{day}</span>
            <div className="h-2 flex-1 rounded-full bg-cloud" />
          </div>
        ))}
      </div>
    </WidgetCard>
  );
}