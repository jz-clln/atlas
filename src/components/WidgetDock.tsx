import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { DraggableResizable } from "./DraggableResizable";
import { ScheduleWidget } from "./widgets/ScheduleWidget";
import { TodoWidget } from "./widgets/TodoWidget";
import { NotesWidget } from "./widgets/NotesWidget";
import { GoalsWidget } from "./widgets/GoalsWidget";
import { StudyPlannerWidget } from "./widgets/StudyPlannerWidget";

const EASE = [0.23, 1, 0.32, 1] as const;

type WidgetKey = "schedule" | "todo" | "notes" | "goals" | "planner";
type Course = { id: string; name: string };
type Position = { x: number; y: number };
type Size = { width: number; height: number };

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

const DEFAULT_SIZE: Size = { width: 380, height: 480 };

export function WidgetDock({ courses }: Props) {
  const [active, setActive] = useState<WidgetKey | null>(null);

  // Remembers each widget's last dragged/resized position+size, so
  // reopening one puts it back where you left it instead of resetting to
  // the default spot every time.
  const positionsRef = useRef<Partial<Record<WidgetKey, Position>>>({});
  const sizesRef = useRef<Partial<Record<WidgetKey, Size>>>({});

  // Bumping a widget's counter forces DraggableResizable to remount with
  // fresh initialPosition/initialSize (via the key prop below) — that's
  // what "reset" actually does, since position/size otherwise only exist
  // as that component's own internal state.
  const [resetCounters, setResetCounters] = useState<Partial<Record<WidgetKey, number>>>({});

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

  function resetActiveWidget() {
    if (!active) return;
    delete positionsRef.current[active];
    delete sizesRef.current[active];
    setResetCounters((prev) => ({ ...prev, [active]: (prev[active] ?? 0) + 1 }));
  }

  const activeItem = ITEMS.find((i) => i.key === active);

  function defaultPositionFor(): Position {
    // Roughly centered vertically, just clear of the rail + its tooltip.
    const y = typeof window !== "undefined" ? Math.max(24, window.innerHeight / 2 - 240) : 24;
    return { x: 96, y };
  }

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

      {/* The popup — draggable/resizable, remembers its last position+size */}
      <AnimatePresence>
        {active && activeItem && (
          <motion.div
            key={active}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="pointer-events-none fixed inset-0 z-50"
          >
            <div className="pointer-events-auto">
              <DraggableResizable
                key={`${active}-${resetCounters[active] ?? 0}`}
                title={
                  <div className="flex flex-1 items-center justify-between">
                    <span>{activeItem.label}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={resetActiveWidget}
                        onPointerDown={(e) => e.stopPropagation()}
                        aria-label="Reset position and size"
                        title="Reset position and size"
                        className="flex h-5 w-5 items-center justify-center rounded-full text-slate hover:bg-cloud hover:text-charcoal"
                      >
                        <ResetIcon />
                      </button>
                      <button
                        onClick={() => setActive(null)}
                        onPointerDown={(e) => e.stopPropagation()}
                        aria-label="Close"
                        className="flex h-5 w-5 items-center justify-center rounded-full text-slate hover:bg-cloud hover:text-charcoal"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                }
                initialPosition={positionsRef.current[active] ?? defaultPositionFor()}
                initialSize={sizesRef.current[active] ?? DEFAULT_SIZE}
                onPositionChange={(p) => {
                  positionsRef.current[active] = p;
                }}
                onSizeChange={(s) => {
                  sizesRef.current[active] = s;
                }}
                className="border border-mist bg-white/95 shadow-2xl backdrop-blur-md"
              >
                <div className="p-4">
                  {active === "schedule" && <ScheduleWidget courses={courses} />}
                  {active === "todo" && <TodoWidget courses={courses} />}
                  {active === "notes" && <NotesWidget />}
                  {active === "goals" && <GoalsWidget />}
                  {active === "planner" && <StudyPlannerWidget />}
                </div>
              </DraggableResizable>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function ResetIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
      <path d="M4 4v5h5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 9A8 8 0 1 1 6 15.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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