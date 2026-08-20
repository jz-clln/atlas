import { useRef, useState } from "react";

type Props = {
  courseId: string;
  courseWorkId: string;
  submissionState: string | null;
  onSubmitted: () => void;
};

const MAX_DIMENSION = 1600; // px — keeps a phone photo well under the body size limit
const JPEG_QUALITY = 0.82;

// Resizes/re-encodes an image client-side before base64 upload. Photos
// straight off a phone camera are often 4-12MB, which blows past Vercel's
// ~4.5MB request body cap once base64 adds its ~33% overhead. Non-image
// files (PDFs, docs) are passed through untouched.
async function prepareFile(file: File): Promise<{ mimeType: string; base64: string }> {
  if (!file.type.startsWith("image/")) {
    const base64 = await fileToBase64(file);
    return { mimeType: file.type || "application/octet-stream", base64 };
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

  const base64 = await fileToBase64(blob);
  return { mimeType: "image/jpeg", base64 };
}

function fileToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function SubmitWorkCard({ courseId, courseWorkId, submissionState, onSubmitted }: Props) {
  const [localState, setLocalState] = useState(submissionState);
  const [inputMode, setInputMode] = useState<"file" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [textAnswer, setTextAnswer] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reclaiming, setReclaiming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function pickFile(f: File) {
    setFile(f);
    setPreview(f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
    setStatus("idle");
    setErrorMsg(null);
  }

  async function authHeaders(): Promise<Record<string, string>> {
    const { supabase } = await import("../lib/supabase");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function submitFile() {
    if (!file) return;
    setStatus("uploading");
    setErrorMsg(null);

    try {
      const { mimeType, base64 } = await prepareFile(file);

      const res = await fetch("/api/classroom/submit-task", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          courseId,
          courseWorkId,
          mode: "file",
          fileName: file.name,
          mimeType,
          fileBase64: base64,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Submit failed (${res.status})`);
      }

      setFile(null);
      setPreview(null);
      setLocalState("TURNED_IN");
      onSubmitted();
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
      return;
    }
    setStatus("idle");
  }

  async function submitText() {
    if (!textAnswer.trim()) return;
    setStatus("uploading");
    setErrorMsg(null);

    try {
      const res = await fetch("/api/classroom/submit-task", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          courseId,
          courseWorkId,
          mode: "text",
          textAnswer,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Submit failed (${res.status})`);
      }

      setTextAnswer("");
      setLocalState("TURNED_IN");
      onSubmitted();
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
      return;
    }
    setStatus("idle");
  }

  async function reclaim() {
    setReclaiming(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/classroom/reclaim-task", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ courseId, courseWorkId }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Undo failed (${res.status})`);
      }

      setLocalState(null);
      onSubmitted();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Couldn't undo the submission.");
    } finally {
      setReclaiming(false);
    }
  }

  if (localState === "RETURNED") {
    return (
      <div className="mx-6 mt-2 rounded-2xl border border-mist bg-cloud px-4 py-3 text-sm text-charcoal">
        Graded and returned — turn-in is locked for this one.
      </div>
    );
  }

  if (localState === "TURNED_IN") {
    return (
      <div className="mx-6 mt-2 rounded-2xl border border-mist bg-cloud px-4 py-3">
        <p className="text-sm font-medium text-ink">Turned in.</p>
        <button
          onClick={reclaim}
          disabled={reclaiming}
          className="mt-2 text-sm font-medium text-charcoal underline transition-opacity active:opacity-60 disabled:opacity-50"
        >
          {reclaiming ? "Undoing…" : "Undo submission"}
        </button>
        {errorMsg && <p className="mt-2 text-xs text-red-600">{errorMsg}</p>}
      </div>
    );
  }

  return (
    <div className="mx-6 mt-2 rounded-2xl border border-mist px-4 py-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate">Submit work</p>
        <div className="flex rounded-full bg-cloud p-0.5 text-xs font-medium">
          <button
            onClick={() => setInputMode("file")}
            className={`rounded-full px-3 py-1 transition-colors ${
              inputMode === "file" ? "bg-white text-ink shadow-sm" : "text-slate"
            }`}
          >
            File
          </button>
          <button
            onClick={() => setInputMode("text")}
            className={`rounded-full px-3 py-1 transition-colors ${
              inputMode === "text" ? "bg-white text-ink shadow-sm" : "text-slate"
            }`}
          >
            Text
          </button>
        </div>
      </div>

      {inputMode === "file" && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pickFile(f);
            }}
          />

          {!file && (
            <button
              onClick={() => inputRef.current?.click()}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-mist py-6 text-sm font-medium text-charcoal transition-colors active:bg-cloud"
            >
              Take a photo or choose a file
            </button>
          )}

          {file && (
            <div className="mt-3">
              {preview ? (
                <img
                  src={preview}
                  alt="Selected submission"
                  className="max-h-48 w-full rounded-xl object-cover"
                />
              ) : (
                <p className="truncate rounded-xl bg-cloud px-3 py-2 text-sm text-charcoal">
                  {file.name}
                </p>
              )}

              <div className="mt-3 flex gap-2">
                <button
                  onClick={submitFile}
                  disabled={status === "uploading"}
                  className="flex-1 rounded-xl bg-ink py-3 text-center text-sm font-medium text-white transition-opacity active:opacity-80 disabled:opacity-50"
                >
                  {status === "uploading" ? "Submitting…" : "Turn in to Classroom"}
                </button>
                <button
                  onClick={() => {
                    setFile(null);
                    setPreview(null);
                  }}
                  disabled={status === "uploading"}
                  className="rounded-xl px-4 py-3 text-sm font-medium text-charcoal transition-opacity active:opacity-60"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {inputMode === "text" && (
        <div className="mt-3">
          <textarea
            value={textAnswer}
            onChange={(e) => setTextAnswer(e.target.value)}
            placeholder="Type your answer…"
            rows={6}
            className="w-full resize-none rounded-xl border border-mist bg-white px-3 py-2.5 text-sm text-ink outline-none placeholder:text-slate focus:border-ink"
          />
          <p className="mt-1.5 text-[11px] text-slate">
            This gets saved as a Google Doc and attached to your submission —
            Classroom doesn't support a bare text answer for this task type.
          </p>

          <button
            onClick={submitText}
            disabled={status === "uploading" || !textAnswer.trim()}
            className="mt-3 w-full rounded-xl bg-ink py-3 text-center text-sm font-medium text-white transition-opacity active:opacity-80 disabled:opacity-50"
          >
            {status === "uploading" ? "Submitting…" : "Turn in to Classroom"}
          </button>
        </div>
      )}

      {status === "error" && errorMsg && (
        <p className="mt-2 text-xs text-red-600">{errorMsg}</p>
      )}
    </div>
  );
}