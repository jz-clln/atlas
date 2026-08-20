import { useRef, useState } from "react";

export type PendingSubmission = {
  courseId: string;
  courseName: string;
  courseWorkId: string;
  taskTitle: string;
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

// Confirmation card for Atlas-proposed Classroom submissions — same
// never-post-without-approval contract as PendingTaskCard. Unlike that
// card, this one makes the /api/classroom/submit-task call itself rather
// than delegating to the parent's onApprove, because file mode needs a
// File the user picks right here, which doesn't fit a simple callback.
export function PendingSubmissionCard({ submission, onDone, onCancel }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

      if (submission.mode === "text") {
        body.mode = "text";
        body.textAnswer = submission.textAnswer;
      } else {
        if (!file) {
          setError("Choose a file first.");
          setSending(false);
          return;
        }
        const { mimeType, base64 } = await prepareFile(file);
        body.mode = "file";
        body.fileName = file.name;
        body.mimeType = mimeType;
        body.fileBase64 = base64;
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

      {submission.mode === "text" && submission.textAnswer && (
        <p className="mt-2 whitespace-pre-line rounded-lg bg-white/5 p-2 text-xs text-white/70">
          {submission.textAnswer}
        </p>
      )}

      {submission.mode === "file" && (
        <div className="mt-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button
            onClick={() => inputRef.current?.click()}
            className="w-full truncate rounded-lg border border-dashed border-white/20 py-2 text-xs font-medium text-white/70 transition-colors active:bg-white/5"
          >
            {file ? file.name : "Choose a file to attach"}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          onClick={confirm}
          disabled={sending || (submission.mode === "file" && !file)}
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