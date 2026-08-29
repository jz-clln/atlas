import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { DraggableResizable } from "./DraggableResizable";
import { ScheduleWidget } from "./widgets/ScheduleWidget";
import { TodoWidget } from "./widgets/TodoWidget";
import { NotesWidget } from "./widgets/NotesWidget";
import { GoalsWidget } from "./widgets/GoalsWidget";
import { StudyPlannerWidget } from "./widgets/StudyPlannerWidget";
import { LibraryWidget } from "./widgets/LibraryWidget";

const EASE = [0.23, 1, 0.32, 1] as const;

// Below this width the dock renders as a bottom nav + bottom sheet instead
// of the side rail + draggable window. Matches Tailwind's `md` breakpoint
// so the JS-driven behavior (sheet vs. draggable popup) lines up with the
// CSS-driven layout (bottom bar vs. side rail) below.
const MOBILE_BREAKPOINT = 768;

type WidgetKey = "schedule" | "todo" | "notes" | "goals" | "planner" | "library";
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
  { key: "library", label: "Library", icon: <LibraryIcon /> },
];

const DEFAULT_SIZE: Size = { width: 380, height: 480 };

// Tracks whether we're under the mobile breakpoint. CSS (`hidden md:flex` /
// `flex md:hidden`) handles which nav is visible, but the popup itself needs
// this in JS to decide between a draggable window (desktop) and a bottom
// sheet (mobile) — those are different interaction models, not just
// different styling.
function useIsMobile(breakpoint = MOBILE_BREAKPOINT) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    function onChange() {
      setIsMobile(mql.matches);
    }
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [breakpoint]);

  return isMobile;
}

export function WidgetDock({ courses }: Props) {
  const [active, setActive] = useState<WidgetKey | null>(null);
  const isMobile = useIsMobile();

  // Remembers each widget's last dragged/resized position+size, so
  // reopening one puts it back where you left it instead of resetting to
  // the default spot every time. (Desktop only — the mobile sheet always
  // opens full-width from the bottom, so there's nothing to remember there.)
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

  function renderWidgetContent() {
    return (
      <>
        {active === "schedule" && <ScheduleWidget courses={courses} />}
        {active === "todo" && <TodoWidget courses={courses} />}
        {active === "notes" && <NotesWidget />}
        {active === "goals" && <GoalsWidget />}
        {active === "planner" && <StudyPlannerWidget />}
        {active === "library" && <LibraryWidget />}
      </>
    );
  }

  function renderSheetHeader() {
    return (
      <div className="flex flex-1 items-center justify-between">
        <span>{activeItem?.label}</span>
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
    );
  }

  return (
    <>
      {/* Click-away layer. On mobile it doubles as the sheet's backdrop
          (dimmed), on desktop it stays invisible so it doesn't obscure the
          other floating widgets. No backdrop-blur here on purpose — see the
          note on the sheet below. */}
      {active && (
        <div
          className={`fixed inset-0 z-40 ${isMobile ? "bg-ink/40" : ""}`}
          onClick={() => setActive(null)}
          aria-hidden="true"
        />
      )}

      {/* Desktop side rail — unchanged from before, just now scoped to md+ */}
      <div className="fixed left-4 top-1/2 z-50 hidden -translate-y-1/2 flex-col gap-1 rounded-full border border-mist bg-white/80 p-1.5 shadow-lg backdrop-blur-md md:flex">
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

      {/* Mobile bottom nav — icon + label, safe-area aware, thumb-friendly */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 flex items-stretch justify-around border-t border-mist bg-white/90 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {ITEMS.map((item) => (
          <button
            key={item.key}
            onClick={() => toggle(item.key)}
            aria-label={item.label}
            aria-pressed={active === item.key}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 transition-colors ${
              active === item.key ? "text-ink" : "text-slate"
            }`}
          >
            <span className={active === item.key ? "text-ink" : "text-slate"}>{item.icon}</span>
            <span className="px-0.5 text-center text-[10px] font-medium leading-tight">{item.label}</span>
          </button>
        ))}
      </div>

      {/* The popup: draggable/resizable window on desktop, bottom sheet on mobile */}
      <AnimatePresence>
        {active && activeItem && !isMobile && (
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
                title={renderSheetHeader()}
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
                <div className="p-4">{renderWidgetContent()}</div>
              </DraggableResizable>
            </div>
          </motion.div>
        )}

        {active && activeItem && isMobile && (
          <motion.div
            key={`sheet-${active}`}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.28, ease: EASE }}
            // No backdrop-blur here: blurring everything behind a sliding
            // (transform-animated) element forces a re-sample on every
            // frame of the animation, which is what was causing the frame
            // drops on open. A solid background reads just as well and
            // costs nothing per-frame.
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col overflow-hidden rounded-t-2xl border border-mist bg-white shadow-2xl"
            style={{
              // Clears the bottom nav bar (56px content + safe area) so the
              // sheet never sits underneath it.
              marginBottom: "calc(56px + env(safe-area-inset-bottom))",
              // Compositing hint so the browser promotes this to its own
              // layer up front instead of discovering it mid-animation.
              willChange: "transform",
            }}
          >
            <div className="flex shrink-0 items-center gap-1.5 border-b border-mist px-4 py-3 text-sm font-medium text-charcoal">
              <span aria-hidden className="mr-1 text-slate">⠿</span>
              {renderSheetHeader()}
            </div>
            <div
              className="min-h-0 flex-1 overflow-auto p-4"
              style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
            >
              {renderWidgetContent()}
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

function LibraryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" strokeLinejoin="round" />
    </svg>
  );
}