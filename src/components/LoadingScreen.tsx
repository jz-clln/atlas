import { AtlasOrb } from "./AtlasOrb";

export function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-cloud">
      <AtlasOrb mode="searching" />
      <p className="flex items-center gap-1 text-sm font-medium text-charcoal">
        {label}
        <span className="ml-1 flex gap-0.5">
          <span className="h-1 w-1 animate-atlas-dot-pulse rounded-full bg-charcoal [animation-delay:0ms]" />
          <span className="h-1 w-1 animate-atlas-dot-pulse rounded-full bg-charcoal [animation-delay:200ms]" />
          <span className="h-1 w-1 animate-atlas-dot-pulse rounded-full bg-charcoal [animation-delay:400ms]" />
        </span>
      </p>
    </div>
  );
}