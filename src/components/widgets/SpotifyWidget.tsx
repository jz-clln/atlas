import { WidgetCard } from "../WidgetCard";

// Skeleton: wire this up to Spotify's OAuth + Web Playback SDK later.
// The "Connect Spotify" button is disabled until that's in place.
export function SpotifyWidget() {
  return (
    <WidgetCard title="Music" comingSoon>
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 shrink-0 rounded-lg bg-cloud" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">Not connected</p>
          <p className="truncate text-xs text-slate">Link Spotify to see what's playing</p>
        </div>
      </div>
      <button
        disabled
        className="mt-3 w-full cursor-not-allowed rounded-xl border border-mist py-2 text-sm font-medium text-slate"
      >
        Connect Spotify
      </button>
    </WidgetCard>
  );
}