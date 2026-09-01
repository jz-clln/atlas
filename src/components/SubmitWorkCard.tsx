import { useRef, useState } from "react";

type Props = {
  courseId: string;
  courseWorkId: string;
  workType: string | null;
  submissionState: string | null;
  alternateLink: string | null;
  onSubmitted: () => void;
};

const MAX_DIMENSION = 1600; // px — keeps a phone photo well under the body size limit
const JPEG_QUALITY = 0.82;
const MAX_FILES = 5; // soft client-side cap; backend also caps combined size

type PickedFile = {
  file: File;
  preview: string | null;
};

// Resizes/re-encodes an image client-side before base64 upload. Photos
// straight off a phone camera are often 4-12MB, which blows past Vercel's
// ~4.5MB request body cap once base64 adds its ~33% overhead — and that cap
// now has to cover every file in the batch, not just one. Non-image files
// (PDFs, docs) are passed through untouched.
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

// Shown under an error so the student isn't stuck — points them at
// Classroom's own page for this assignment to submit manually, since the
// API path can be blocked entirely by a school's Workspace admin policy
// (see PERMISSION_DENIED / "Developer Console project is not permitted"),
// which no amount of retrying or client-side fixing gets around.
function ManualFallback({ alternateLink }: { alternateLink: string | null }) {
  if (!alternateLink) return null;
  return (
    <a
      href={alternateLink}
      target="_blank"
      rel="noreferrer"
      className="mt-2 block w-full rounded-xl border border-mist py-2.5 text-center text-sm font-medium text-charcoal transition-colors active:bg-cloud"
    >
      Open in Classroom to submit manually
    </a>
  );
}

export function SubmitWorkCard({
  courseId,
  courseWorkId,
  workType,
  submissionState,
  alternateLink,
  onSubmitted,
}: Props) {
  const isShortAnswer = workType === "SHORT_ANSWER_QUESTION";

  const [localState, setLocalState] = useState(submissionState);
  const [inputMode, setInputMode] = useState<"file" | "text">("file");
  const [pickedFiles, setPickedFiles] = useState<PickedFile[]>([]);
  const [textAnswer, setTextAnswer] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reclaiming, setReclaiming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Adds newly picked files to whatever's already staged, so a student can
  // tap "add another" a few times (e.g. one photo per page of homework)
  // instead of losing earlier picks each time the file dialog reopens.
  function addFiles(fileList: FileList) {
    const incoming = Array.from(fileList).slice(0, MAX_FILES - pickedFiles.length);
    const withPreviews = incoming.map((file) => ({
      file,
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    setPickedFiles((prev) => [...prev, ...withPreviews]);
    setStatus("idle");
    setErrorMsg(null);
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

  async function submitFiles() {
    if (pickedFiles.length === 0) return;
    setStatus("uploading");
    setErrorMsg(null);

    try {
      const files = await Promise.all(
        pickedFiles.map(async ({ file }) => {
          const { mimeType, base64 } = await prepareFile(file);
          return { fileName: file.name, mimeType, fileBase64: base64 };
        })
      );

      const res = await fetch("/api/classroom/submit-task", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          courseId,
          courseWorkId,
          mode: "file",
          files,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Submit failed (${res.status})`);
      }

      pickedFiles.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      setPickedFiles([]);
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

  // Short-answer questions get a real text field only — no file option at
  // all, and no File/Text toggle, since Classroom's shortAnswerSubmission
  // field is the actual, correct place for this answer to live.
  if (isShortAnswer) {
    return (
      <div className="mx-6 mt-2 rounded-2xl border border-mist px-4 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate">
          Submit answer
        </p>

        <textarea
          value={textAnswer}
          onChange={(e) => setTextAnswer(e.target.value)}
          placeholder="Type your answer…"
          rows={4}
          className="mt-3 w-full resize-none rounded-xl border border-mist bg-white px-3 py-2.5 text-sm text-ink outline-none placeholder:text-slate focus:border-ink"
        />

        <button
          onClick={submitText}
          disabled={status === "uploading" || !textAnswer.trim()}
          className="mt-3 w-full rounded-xl bg-ink py-3 text-center text-sm font-medium text-white transition-opacity active:opacity-80 disabled:opacity-50"
        >
          {status === "uploading" ? "Submitting…" : "Turn in to Classroom"}
        </button>

        {status === "error" && errorMsg && (
          <>
            <p className="mt-2 text-xs text-red-600">{errorMsg}</p>
            <ManualFallback alternateLink={alternateLink} />
          </>
        )}
      </div>
    );
  }

  // Everything else is treated as ASSIGNMENT-type: file(s) or a typed
  // answer that gets wrapped in a Google Doc (Classroom has no bare-text
  // field for this work type).
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
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) addFiles(e.target.files);
              e.target.value = ""; // lets picking the same file again re-trigger onChange
            }}
          />

          {pickedFiles.length === 0 && (
            <button
              onClick={() => inputRef.current?.click()}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-mist py-6 text-sm font-medium text-charcoal transition-colors active:bg-cloud"
            >
              Take a photo or choose files
            </button>
          )}

          {pickedFiles.length > 0 && (
            <div className="mt-3 space-y-2">
              {pickedFiles.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-xl bg-cloud px-3 py-2"
                >
                  {f.preview ? (
                    <img
                      src={f.preview}
                      alt={f.file.name}
                      className="h-10 w-10 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="shrink-0 text-lg">📄</span>
                  )}
                  <p className="flex-1 truncate text-sm text-charcoal">{f.file.name}</p>
                  <button
                    onClick={() => removeFile(i)}
                    disabled={status === "uploading"}
                    className="shrink-0 text-xs font-medium text-slate transition-opacity active:opacity-60"
                  >
                    Remove
                  </button>
                </div>
              ))}

              {pickedFiles.length < MAX_FILES && (
                <button
                  onClick={() => inputRef.current?.click()}
                  disabled={status === "uploading"}
                  className="w-full rounded-xl border border-dashed border-mist py-2.5 text-sm font-medium text-charcoal transition-colors active:bg-cloud"
                >
                  + Add another file
                </button>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={submitFiles}
                  disabled={status === "uploading"}
                  className="flex-1 rounded-xl bg-ink py-3 text-center text-sm font-medium text-white transition-opacity active:opacity-80 disabled:opacity-50"
                >
                  {status === "uploading" ? "Submitting…" : "Turn in to Classroom"}
                </button>
                <button
                  onClick={() => {
                    pickedFiles.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
                    setPickedFiles([]);
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
        <>
          <p className="mt-2 text-xs text-red-600">{errorMsg}</p>
          <ManualFallback alternateLink={alternateLink} />
        </>
      )}
    </div>
  );
}