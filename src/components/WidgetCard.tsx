import type { ReactNode } from "react";

type Props = {
  title: string;
  comingSoon?: boolean;
  className?: string;
  children: ReactNode;
};

// Shared shell for every dashboard widget so new features (real or
// skeleton) all share the same card, header, and "coming soon" treatment.
export function WidgetCard({ title, comingSoon, className = "", children }: Props) {
  return (
    <div className={`rounded-2xl border border-mist bg-white p-5 ${className}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate">{title}</p>
        {comingSoon && (
          <span className="rounded-full bg-cloud px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate">
            Coming soon
          </span>
        )}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}