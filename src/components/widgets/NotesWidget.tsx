import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useSession } from "../../lib/useSession";
import { WidgetCard } from "../WidgetCard";

type Status = "idle" | "saving" | "saved";

const SAVE_DELAY_MS = 800;

export function NotesWidget() {
  const { session } = useSession();
  const userId = session?.user?.id;

  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>("idle");
  const saveTimeout = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    setLoading(true);
    supabase
      .from("notes")
      .select("content")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setNotes(data?.content ?? "");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  function handleChange(value: string) {
    setNotes(value);
    setStatus("saving");

    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(async () => {
      if (!userId) return;
      await supabase
        .from("notes")
        .upsert({ user_id: userId, content: value, updated_at: new Date().toISOString() });
      setStatus("saved");
    }, SAVE_DELAY_MS);
  }

  useEffect(() => {
    return () => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
    };
  }, []);

  return (
    <WidgetCard title="Notes">
      <textarea
        value={notes}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={loading ? "Loading…" : "Jot something down…"}
        disabled={loading || !userId}
        rows={4}
        className="w-full resize-none rounded-xl border border-mist bg-cloud px-3 py-2 text-sm text-charcoal outline-none focus:border-charcoal disabled:opacity-50"
      />
      <p className="mt-2 text-[11px] text-slate">
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Synced across your devices"}
      </p>
    </WidgetCard>
  );
}