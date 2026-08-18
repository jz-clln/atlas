export type PendingClassroomTask = {
  courseId: string;
  courseName: string;
  title: string;
  description?: string;
  dueDate?: string | null; // ISO date string, optional
};

type Props = {
  task: PendingClassroomTask;
  sending: boolean;
  onApprove: () => void;
  onCancel: () => void;
};

// Nothing reaches Google Classroom without the user clicking "Post" here
// first — this card is the confirmation step for every posting flow
// (Atlas-suggested tasks, and manually sending a to-do).
export function PendingTaskCard({ task, sending, onApprove, onCancel }: Props) {
  const dueLabel = task.dueDate
    ? new Date(task.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;

  return (
    <div className="mt-3 rounded-xl border border-white/15 bg-white/5 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-white/50">
        Ready to post to Classroom
      </p>
      <p className="mt-1 text-sm font-medium text-white">{task.title}</p>
      <p className="text-xs text-white/60">
        {task.courseName}
        {dueLabel ? ` · due ${dueLabel}` : ""}
      </p>
      {task.description && <p className="mt-1 text-xs text-white/50">{task.description}</p>}

      <div className="mt-3 flex gap-2">
        <button
          onClick={onApprove}
          disabled={sending}
          className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-ink transition-opacity active:opacity-70 disabled:opacity-50"
        >
          {sending ? "Posting…" : "Post to Classroom"}
        </button>
        <button
          onClick={onCancel}
          disabled={sending}
          className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-medium text-white/70 transition-opacity active:opacity-70"
        >
          Not now
        </button>
      </div>
    </div>
  );
}