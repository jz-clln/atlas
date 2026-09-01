import { useRef, useState } from "react";

export type PendingSubmission = {
  courseId: string;
  courseName: string;
  courseWorkId: string;
  taskTitle: string;
  workType: string | null;
  alternateLink: string | null;
  mode: "text" | "file";
  textAnswer?: string;
};

type Props = {
  submission: PendingSubmission;
  onDone: () => void;
  onCancel: () => void;
};

const MAX_DIMENSION = 1600; // px — keeps a phone photo well under the body size limit
const JPEG_QUALITY = 0.82;
const MAX_FILES = 5; // soft client-side cap; backend also caps combined size

type PickedFile = {
  file: File;
  preview: string | null;
};

async function prepareFile(file: File): Promise<{ mimeType: string; base64: string }> {
  if (!file.type.startsWith("image/")) {
    return { mimeType: file.type || "application/octet-stream", base64: await fileToBase64(file) };
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Image encoding failed"))),
      "image/jpeg",
      JPEG_QUALITY
    )
  );

  return { mimeType: "image/jpeg", base64: await fileToBase64(blob) };
}

function fileToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Same fallback as SubmitWorkCard: if the automatic submission fails (most
// notably a school Workspace admin blocking third-party API access, which
// no retry or client-side fix gets around), point the student at
// Classroom's own page for this assignment instead of leaving them stuck.
function ManualFallback({ alternateLink }: { alternateLink: string | null }) {
  if (!alternateLink) return null;
  return (
    <a
      href={alternateLink}
      target="_blank"
      rel="noreferrer"
      className="mt-2 block w-full rounded-lg border border-white/20 py-2 text-center text-xs font-medium text-white/70 transition-colors active:bg-white/5"
    >
      Open in Classroom to submit manually
    </a>
  );
}

// Confirmation card for Atlas-proposed Classroom submissions — same
// never-post-without-approval contract as PendingTaskCard. Unlike that
// card, this one makes the /api/classroom/submit-task call itself rather
// than delegating to the parent's onApprove, because file mode needs
// files the user picks right here, which doesn't fit a simple callback.
//
// Mirrors SubmitWorkCard's branching: a real SHORT_ANSWER_QUESTION task
// always confirms as plain text (no file option, no Doc conversion —
// Classroom has a real answer field for that type). Everything else is
// treated as ASSIGNMENT-type and can carry more than one file.
export function PendingSubmissionCard({ submission, onDone, onCancel }: Props) {
  const isShortAnswer = submission.workType === "SHORT_ANSWER_QUESTION";

  const [pickedFiles, setPickedFiles] = useState<PickedFile[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(fileList: FileList) {
    const incoming = Array.from(fileList).slice(0, MAX_FILES - pickedFiles.length);
    const withPreviews = incoming.map((file) => ({
      file,
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    setPickedFiles((prev) => [...prev, ...withPreviews]);
    setError(null);
  }

  function removeFile(index: number) {
    setPickedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function authHeaders(): Promise<Record<string, string>> {
    const { supabase } = await import("../lib/supabase");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function confirm() {
    setSending(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        courseId: submission.courseId,
        courseWorkId: submission.courseWorkId,
      };

      if (isShortAnswer) {
        if (!submission.textAnswer?.trim()) {
          setError("No answer text was provided.");
          setSending(false);
          return;
        }
        body.mode = "text";
        body.textAnswer = submission.textAnswer;
      } else if (submission.mode === "text") {
        body.mode = "text";
        body.textAnswer = submission.textAnswer;
      } else {
        if (pickedFiles.length === 0) {
          setError("Choose at least one file first.");
          setSending(false);
          return;
        }
        const files = await Promise.all(
          pickedFiles.map(async ({ file }) => {
            const { mimeType, base64 } = await prepareFile(file);
            return { fileName: file.name, mimeType, fileBase64: base64 };
          })
        );
        body.mode = "file";
        body.files = files;
      }

      const res = await fetch("/api/classroom/submit-task", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `Submit failed (${res.status})`);
      }

      pickedFiles.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-white/15 bg-white/5 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-white/50">Ready to submit</p>
      <p className="mt-1 text-sm font-medium text-white">{submission.taskTitle}</p>
      <p className="text-xs text-white/60">{submission.courseName}</p>

      {(isShortAnswer || submission.mode === "text") && submission.textAnswer && (
        <p className="mt-2 whitespace-pre-line rounded-lg bg-white/5 p-2 text-xs text-white/70">
          {submission.textAnswer}
        </p>
      )}

      {!isShortAnswer && submission.mode === "file" && (
        <div className="mt-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) addFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {pickedFiles.length === 0 && (
            <button
              onClick={() => inputRef.current?.click()}
              className="w-full truncate rounded-lg border border-dashed border-white/20 py-2 text-xs font-medium text-white/70 transition-colors active:bg-white/5"
            >
              Choose files to attach
            </button>
          )}

          {pickedFiles.length > 0 && (
            <div className="space-y-1.5">
              {pickedFiles.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5"
                >
                  <p className="flex-1 truncate text-xs text-white/70">{f.file.name}</p>
                  <button
                    onClick={() => removeFile(i)}
                    disabled={sending}
                    className="shrink-0 text-[11px] font-medium text-white/50 transition-opacity active:opacity-60"
                  >
                    Remove
                  </button>
                </div>
              ))}

              {pickedFiles.length < MAX_FILES && (
                <button
                  onClick={() => inputRef.current?.click()}
                  disabled={sending}
                  className="w-full rounded-lg border border-dashed border-white/20 py-1.5 text-[11px] font-medium text-white/70 transition-colors active:bg-white/5"
                >
                  + Add another file
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <>
          <p className="mt-2 text-xs text-red-300">{error}</p>
          <ManualFallback alternateLink={submission.alternateLink} />
        </>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={confirm}
          disabled={
            sending || (!isShortAnswer && submission.mode === "file" && pickedFiles.length === 0)
          }
          className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-ink transition-opacity active:opacity-70 disabled:opacity-50"
        >
          {sending ? "Submitting…" : "Turn in to Classroom"}
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