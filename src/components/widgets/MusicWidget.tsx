import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "../../lib/supabase";
import { useSession } from "../../lib/useSession";

type Track = {
  id: string;
  title: string;
  storage_path: string;
};

const BUCKET = "music";
const SIGNED_URL_TTL_SECONDS = 3600;
const EASE = [0.23, 1, 0.32, 1] as const;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// A bottom-left "now playing" pill, iOS-lock-screen-widget style. Tapping it
// expands upward into the full playlist/upload panel; the pill's own
// content (icon + title) is shared via layoutId so it visually becomes the
// expanded panel's header instead of just disappearing and reappearing.
export function MusicWidget() {
  const { session } = useSession();
  const userId = session?.user?.id;

  const [expanded, setExpanded] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    supabase
      .from("tracks")
      .select("id, title, storage_path")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (cancelled) return;
        setTracks(data ?? []);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function handleUpload(files: FileList | null) {
    if (!files || !userId) return;
    setUploading(true);
    setError(null);

    for (const file of Array.from(files)) {
      if (!file.type.includes("audio")) continue;

      const id = crypto.randomUUID();
      const path = `${userId}/${id}.mp3`;

      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || "audio/mpeg",
      });
      if (uploadError) {
        setError(`Couldn't upload ${file.name}.`);
        continue;
      }

      const title = file.name.replace(/\.mp3$/i, "");
      const { data, error: insertError } = await supabase
        .from("tracks")
        .insert({ id, user_id: userId, title, storage_path: path })
        .select("id, title, storage_path")
        .single();

      if (!insertError && data) {
        setTracks((prev) => [...prev, data]);
      }
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function playTrack(index: number) {
    const track = tracks[index];
    if (!track || !audioRef.current) return;

    const { data, error: signError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(track.storage_path, SIGNED_URL_TTL_SECONDS);

    if (signError || !data) {
      setError("Couldn't load that track.");
      return;
    }

    audioRef.current.src = data.signedUrl;
    audioRef.current.play();
    setCurrentIndex(index);
    setPlaying(true);
    setError(null);
  }

  function togglePlayPause() {
    if (currentIndex === null) {
      if (tracks.length > 0) playTrack(0);
      return;
    }
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
    }
  }

  function next() {
    if (currentIndex === null || tracks.length === 0) return;
    playTrack((currentIndex + 1) % tracks.length);
  }

  function previous() {
    if (currentIndex === null || tracks.length === 0) return;
    playTrack((currentIndex - 1 + tracks.length) % tracks.length);
  }

  async function removeTrack(index: number) {
    const track = tracks[index];
    if (!track) return;

    if (currentIndex === index && audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
      setCurrentIndex(null);
    }

    setTracks((prev) => prev.filter((_, i) => i !== index));
    await supabase.storage.from(BUCKET).remove([track.storage_path]);
    await supabase.from("tracks").delete().eq("id", track.id);
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = pct * duration;
  }

  const currentTrack = currentIndex !== null ? tracks[currentIndex] : null;
  const progressPct = duration > 0 ? (progress / duration) * 100 : 0;
  const nowPlayingLabel = currentTrack?.title ?? (tracks.length > 0 ? "Tap to play" : "No music yet");

  return (
    <>
      {/* Audio element persists regardless of expanded/collapsed state, so
          playback never interrupts when the UI morphs. */}
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={next}
        className="hidden"
      />

      {/* Click-away layer when expanded */}
      {expanded && (
        <div className="fixed inset-0 z-40" onClick={() => setExpanded(false)} aria-hidden="true" />
      )}

      <div className="fixed bottom-6 left-6 z-50">
        <AnimatePresence>
          {expanded && (
            <motion.div
              key="panel"
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.96 }}
              transition={{ duration: 0.22, ease: EASE }}
              className="mb-3 w-[320px] max-w-[calc(100vw-3rem)] overflow-hidden rounded-3xl border border-mist bg-white/95 shadow-2xl backdrop-blur-md"
            >
              {/* Player controls */}
              <div className="p-4">
                {currentTrack && (
                  <div className="mb-3">
                    <div
                      onClick={seek}
                      className="h-1.5 w-full cursor-pointer overflow-hidden rounded-full bg-cloud"
                    >
                      <div className="h-full rounded-full bg-ink" style={{ width: `${progressPct}%` }} />
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] text-slate">
                      <span>{formatTime(progress)}</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-center gap-4">
                      <button onClick={previous} aria-label="Previous" className="text-charcoal hover:text-ink">
                        ⏮
                      </button>
                      <button
                        onClick={togglePlayPause}
                        aria-label={playing ? "Pause" : "Play"}
                        className="text-lg text-charcoal hover:text-ink"
                      >
                        {playing ? "⏸" : "▶"}
                      </button>
                      <button onClick={next} aria-label="Next" className="text-charcoal hover:text-ink">
                        ⏭
                      </button>
                    </div>
                  </div>
                )}

                {loading ? (
                  <p className="text-sm text-slate">Loading…</p>
                ) : tracks.length === 0 ? (
                  <p className="text-sm text-slate">No tracks yet — upload some MP3s below.</p>
                ) : (
                  <ul className="max-h-40 space-y-1 overflow-y-auto">
                    {tracks.map((t, i) => (
                      <li
                        key={t.id}
                        className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm ${
                          i === currentIndex ? "bg-cloud text-ink" : "text-charcoal"
                        }`}
                      >
                        <button onClick={() => playTrack(i)} className="min-w-0 flex-1 truncate text-left">
                          {t.title}
                        </button>
                        <button
                          onClick={() => removeTrack(i)}
                          aria-label="Remove track"
                          className="shrink-0 text-xs text-slate hover:text-charcoal"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/mpeg,.mp3"
                  multiple
                  onChange={(e) => handleUpload(e.target.files)}
                  className="hidden"
                  id="mp3-upload"
                />
                <label
                  htmlFor="mp3-upload"
                  className="mt-3 block w-full cursor-pointer rounded-xl border border-dashed border-mist py-2 text-center text-sm font-medium text-charcoal transition-colors hover:border-ink hover:text-ink"
                >
                  {uploading ? "Uploading…" : "Upload MP3s"}
                </label>

                {error && <p className="mt-2 text-xs text-slate">{error}</p>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* The pill itself — always visible, morphs into the panel header
            via layoutId when expanded. */}
        <motion.div
          layoutId="music-pill"
          transition={{ duration: 0.22, ease: EASE }}
          onClick={() => setExpanded((v) => !v)}
          className="flex w-[220px] cursor-pointer items-center gap-2.5 rounded-full border border-mist bg-white/90 py-2 pl-2 pr-4 shadow-lg backdrop-blur-md transition-shadow hover:shadow-xl"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              togglePlayPause();
            }}
            aria-label={playing ? "Pause" : "Play"}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-white"
          >
            {playing ? "⏸" : "▶"}
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-ink">{nowPlayingLabel}</p>
            {playing && <p className="text-[10px] text-slate">Playing</p>}
          </div>
        </motion.div>
      </div>
    </>
  );
}