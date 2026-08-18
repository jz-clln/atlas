import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ScheduleWidget } from "./widgets/ScheduleWidget";
import { TodoWidget } from "./widgets/TodoWidget";
import { NotesWidget } from "./widgets/NotesWidget";
import { GoalsWidget } from "./widgets/GoalsWidget";
import { StudyPlannerWidget } from "./widgets/StudyPlannerWidget";

const EASE = [0.23, 1, 0.32, 1] as const;

type WidgetKey = "schedule" | "todo" | "notes" | "goals" | "planner";
type Course = { id: string; name: string };

type Props = {
  courses: Course[];
};

const ITEMS: { key: WidgetKey; label: string; icon: ReactNode }[] = [
  { key: "schedule", label: "Schedule", icon: <CalendarIcon /> },
  { key: "todo", label: "To-do", icon: <CheckIcon /> },
  { key: "notes", label: "Notes", icon: <PencilIcon /> },
  { key: "goals", label: "Goals", icon: <TargetIcon /> },
  { key: "planner", label: "Study planner", icon: <BookIcon /> },
];

export function WidgetDock({ courses }: Props) {
  const [active, setActive] = useState<WidgetKey | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setActive(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggle(key: WidgetKey) {
    setActive((prev) => (prev === key ? null : key));
  }

  const activeItem = ITEMS.find((i) => i.key === active);

  return (
    <>
      {/* Click-away layer — invisible, just closes the popup */}
      {active && (
        <div className="fixed inset-0 z-40" onClick={() => setActive(null)} aria-hidden="true" />
      )}

      {/* The rail itself */}
      <div className="fixed left-4 top-1/2 z-50 flex -translate-y-1/2 flex-col gap-1 rounded-full border border-mist bg-white/80 p-1.5 shadow-lg backdrop-blur-md">
        {ITEMS.map((item) => (
          <button
            key={item.key}
            onClick={() => toggle(item.key)}
            aria-label={item.label}
            aria-pressed={active === item.key}
            className={`group relative flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
              active === item.key ? "bg-ink text-white" : "text-charcoal hover:bg-cloud"
            }`}
          >
            {item.icon}
            <span className="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1 text-xs font-medium text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100">
              {item.label}
            </span>
          </button>
        ))}
      </div>

      {/* The popup */}
      <AnimatePresence>
        {active && activeItem && (
          <motion.div
            key={active}
            initial={{ opacity: 0, x: -12, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -12, scale: 0.97 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="fixed left-20 top-1/2 z-50 max-h-[70vh] w-[360px] max-w-[calc(100vw-6rem)] -translate-y-1/2 overflow-y-auto rounded-3xl border border-mist bg-white/95 p-1 shadow-2xl backdrop-blur-md"
          >
            <div className="flex items-center justify-between px-4 pt-3">
              <p className="text-sm font-semibold text-ink">{activeItem.label}</p>
              <button
                onClick={() => setActive(null)}
                aria-label="Close"
                className="flex h-6 w-6 items-center justify-center rounded-full text-slate hover:bg-cloud hover:text-charcoal"
              >
                ✕
              </button>
            </div>
            <div className="p-4 pt-2">
              {active === "schedule" && <ScheduleWidget courses={courses} />}
              {active === "todo" && <TodoWidget courses={courses} />}
              {active === "notes" && <NotesWidget />}
              {active === "goals" && <GoalsWidget />}
              {active === "planner" && <StudyPlannerWidget />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M4 10h16M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
      <path d="M4 20l1-4.5L15.5 5 19 8.5 8.5 19 4 20z" strokeLinejoin="round" />
      <path d="M13 7l4 4" />
    </svg>
  );
}

function TargetIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.75" fill="currentColor" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
      <path d="M4 5.5c2-1 5-1 8 0v13c-3-1-6-1-8 0v-13z" strokeLinejoin="round" />
      <path d="M20 5.5c-2-1-5-1-8 0v13c3-1 6-1 8 0v-13z" strokeLinejoin="round" />
    </svg>
  );
}