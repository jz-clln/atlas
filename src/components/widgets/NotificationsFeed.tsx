import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useSession } from "../../lib/useSession";
import { WidgetCard } from "../WidgetCard";

type Notification = {
  id: string;
  title: string;
  body: string;
  kind: string;
  read: boolean;
  created_at: string;
};

const KIND_LABEL: Record<string, string> = {
  no_class: "No class",
  cancellation: "Possible change",
  deadline: "Deadline",
  announcement: "Announcement",
};

// Live feed of things Atlas found without being asked — mainly new
// Classroom announcements. The cron job (api/atlas/poll-announcements.ts)
// writes rows into `notifications`; this component subscribes to that
// table via Supabase Realtime, so new rows appear here the moment they're
// written, with no polling or chat message from the user required.
export function NotificationsFeed() {
  const { session } = useSession();
  const userId = session?.user?.id;

  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    setLoading(true);
    supabase
      .from("notifications")
      .select("id, title, body, kind, read, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (cancelled) return;
        setItems(data ?? []);
        setLoading(false);
      });

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          setItems((prev) => [payload.new as Notification, ...prev]);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  async function markRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    await supabase.from("notifications").update({ read: true }).eq("id", id);
  }

  const unreadCount = items.filter((n) => !n.read).length;

  return (
    <WidgetCard title={`Atlas noticed${unreadCount > 0 ? ` (${unreadCount})` : ""}`}>
      {loading ? (
        <p className="text-sm text-slate">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate">Atlas checks Classroom every 15 minutes.</p>
      ) : (
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {items.map((n) => (
            <li
              key={n.id}
              onClick={() => !n.read && markRead(n.id)}
              className={`cursor-pointer rounded-xl border px-3 py-2 transition-colors ${
                n.read ? "border-mist bg-white" : "border-ink/10 bg-cloud"
              }`}
            >
              <p className="text-xs font-medium uppercase tracking-wide text-slate">
                {KIND_LABEL[n.kind] ?? n.kind} · {n.title}
              </p>
              <p className="mt-0.5 line-clamp-2 text-sm text-charcoal">{n.body}</p>
              <p className="mt-1 text-[10px] text-slate">
                {new Date(n.created_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}