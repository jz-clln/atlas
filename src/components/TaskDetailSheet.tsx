import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { CourseworkItem, CourseworkMaterial } from "../lib/useClassroomSync";
import { getTaskDetail } from "../lib/useClassroomSync";

const EASE_OUT_QUINT: [number, number, number, number] = [0.23, 1, 0.32, 1];

type Props = {
  item: CourseworkItem | null;
  courseName: string;
  onClose: () => void;
};

// Bottom sheet showing full assignment detail: description, materials,
// points, due date. Opens with cached data instantly, then quietly
// refreshes with a live Classroom lookup so materials/description are
// never stale even if the last full sync is old.
export function TaskDetailSheet({ item, courseName, onClose }: Props) {
  const [live, setLive] = useState<CourseworkItem | null>(null);

  useEffect(() => {
    setLive(null);
    if (!item) return;

    let cancelled = false;
    getTaskDetail(item.course_id, item.id)
      .then((task) => {
        if (cancelled) return;
        setLive({
          ...item,
          description: task.description ?? item.description,
          materials: task.materials ?? item.materials,
          max_points: task.maxPoints ?? item.max_points,
        });
      })
      .catch(() => {
        // Silent — the cached item is already showing, live refresh is best-effort.
      });

    return () => {
      cancelled = true;
    };
  }, [item]);

  const shown = live ?? item;

  return (
    <AnimatePresence>
      {item && shown && (
        <>
          <motion.div
            key="backdrop"
            className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={onClose}
          />

          <motion.div
            key="sheet"
            className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto rounded-l-3xl bg-white pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.28, ease: EASE_OUT_QUINT }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0, right: 0.4 }}
            onDragEnd={(_, info) => {
              if (info.offset.x > 120 || info.velocity.x > 800) onClose();
            }}
          >
            <div className="flex justify-center pt-3">
              <div className="h-1 w-9 rounded-full bg-mist" />
            </div>

            <div className="px-6 pb-2 pt-5">
              <p className="text-xs font-medium uppercase tracking-wide text-slate">
                {courseName}
              </p>
              <h2 className="mt-1 text-2xl font-semibold leading-snug text-ink">
                {shown.title}
              </h2>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {shown.due_at && (
                  <Pill>
                    Due{" "}
                    {new Date(shown.due_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </Pill>
                )}
                {shown.max_points != null && <Pill>{shown.max_points} pts</Pill>}
                {shown.work_type && <Pill>{formatWorkType(shown.work_type)}</Pill>}
              </div>
            </div>

            {shown.description && (
              <div className="px-6 py-4">
                <p className="whitespace-pre-line text-[15px] leading-relaxed text-charcoal">
                  {shown.description}
                </p>
              </div>
            )}

            {shown.materials && shown.materials.length > 0 && (
              <div className="px-6 pb-2 pt-2">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate">
                  Attached
                </p>
                <ul className="divide-y divide-mist rounded-2xl border border-mist">
                  {shown.materials.map((m, i) => (
                    <MaterialRow key={i} material={m} />
                  ))}
                </ul>
              </div>
            )}

            <div className="px-6 pb-2 pt-6">
              {shown.alternate_link && (
                <a
                  href={shown.alternate_link}
                  target="_blank"
                  rel="noreferrer"
                  className="block w-full rounded-2xl bg-ink py-3.5 text-center text-[15px] font-medium text-white transition-opacity active:opacity-80"
                >
                  Open in Classroom
                </a>
              )}
              <button
                onClick={onClose}
                className="mt-2 block w-full rounded-2xl py-3.5 text-center text-[15px] font-medium text-charcoal transition-opacity active:opacity-60"
              >
                Close
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-cloud px-2.5 py-1 text-xs font-medium text-charcoal">
      {children}
    </span>
  );
}

function formatWorkType(workType: string) {
  return workType
    .toLowerCase()
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function materialInfo(material: CourseworkMaterial): { title: string; url: string } | null {
  if ("driveFile" in material) {
    return {
      title: material.driveFile.driveFile.title,
      url: material.driveFile.driveFile.alternateLink,
    };
  }
  if ("link" in material) {
    return { title: material.link.title ?? material.link.url, url: material.link.url };
  }
  if ("youTubeVideo" in material) {
    return { title: material.youTubeVideo.title, url: material.youTubeVideo.alternateLink };
  }
  if ("form" in material) {
    return { title: material.form.title ?? "Form", url: material.form.formUrl };
  }
  return null;
}

function MaterialRow({ material }: { material: CourseworkMaterial }) {
  const info = materialInfo(material);
  if (!info) return null;

  return (
    <li>
      <a
        href={info.url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-ink transition-colors active:bg-cloud"
      >
        <span className="truncate">{info.title}</span>
        <span className="shrink-0 text-slate">↗</span>
      </a>
    </li>
  );
}