import { useEffect, useState } from "react";
import { WidgetCard } from "../WidgetCard";

export function ClockWidget() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
  const date = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <WidgetCard title="Clock">
      <p className="font-mono text-3xl font-semibold tabular-nums text-ink">{time}</p>
      <p className="mt-1 text-sm text-charcoal">{date}</p>
    </WidgetCard>
  );
}