import { useEffect, useRef, useState } from "react";

type AtlasOrbProps = {
  /**
   * "idle" — eyes follow the cursor, gentle breathing scale (default, used on Login).
   * "searching" — eyes sweep on their own in a scan pattern, orb hops/tilts as if
   * looking around for something. Used on loading screens.
   */
  mode?: "idle" | "searching";
};

const SCAN_SEQUENCE: { x: number; y: number }[] = [
  { x: 0, y: 0 },
  { x: -5, y: 0 },
  { x: -5, y: 0 },
  { x: 0, y: 0 },
  { x: 5, y: 0 },
  { x: 5, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: -3 },
  { x: 0, y: 0 },
];

export function AtlasOrb({ mode = "idle" }: AtlasOrbProps) {
  const orbRef = useRef<HTMLDivElement>(null);
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const [blinking, setBlinking] = useState(false);

  // Idle mode: eyes follow the cursor within a small radius.
  useEffect(() => {
    if (mode !== "idle") return;

    function handleMouseMove(e: MouseEvent) {
      const orb = orbRef.current;
      if (!orb) return;
      const rect = orb.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const maxOffset = 5;
      const falloff = Math.min(dist, 240) / 240;
      setEyeOffset({
        x: (dx / dist) * maxOffset * falloff,
        y: (dy / dist) * maxOffset * falloff,
      });
    }
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [mode]);

  // Searching mode: eyes sweep through a scan pattern on their own,
  // like ATLAS is scanning the room for your assignments.
  useEffect(() => {
    if (mode !== "searching") return;

    let index = 0;
    const intervalId = window.setInterval(() => {
      index = (index + 1) % SCAN_SEQUENCE.length;
      setEyeOffset(SCAN_SEQUENCE[index]);
    }, 650);

    return () => window.clearInterval(intervalId);
  }, [mode]);

  // Blinking runs in both modes.
  useEffect(() => {
    let timeoutId: number;
    function scheduleBlink() {
      const delay = 2600 + Math.random() * 3400;
      timeoutId = window.setTimeout(() => {
        setBlinking(true);
        window.setTimeout(() => {
          setBlinking(false);
          scheduleBlink();
        }, 130);
      }, delay);
    }
    scheduleBlink();
    return () => window.clearTimeout(timeoutId);
  }, []);

  return (
    <div
      ref={orbRef}
      className={`flex h-36 w-36 items-center justify-center rounded-full bg-ink shadow-[0_25px_60px_-15px_rgba(0,0,0,0.45)] sm:h-44 sm:w-44 ${
        mode === "searching" ? "animate-atlas-search-bounce" : "animate-atlas-breathe"
      }`}
    >
      <div className="flex gap-5 sm:gap-6">
        <Eye offset={eyeOffset} blinking={blinking} />
        <Eye offset={eyeOffset} blinking={blinking} />
      </div>
    </div>
  );
}

function Eye({
  offset,
  blinking,
}: {
  offset: { x: number; y: number };
  blinking: boolean;
}) {
  return (
    <span
      className="block h-4 w-4 rounded-full bg-white transition-transform duration-500 ease-[cubic-bezier(0.45,0,0.55,1)] sm:h-5 sm:w-5"
      style={{
        transform: `translate(${offset.x}px, ${offset.y}px) scaleY(${
          blinking ? 0.12 : 1
        })`,
      }}
    />
  );
}