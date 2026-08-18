import { AtlasOrb } from "./AtlasOrb";

export function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-cloud">
      <AtlasOrb mode="searching" />
      <p className="flex items-center gap-1 text-sm font-medium text-charcoal">
        {label}
      </p>
    </div>
  );
}