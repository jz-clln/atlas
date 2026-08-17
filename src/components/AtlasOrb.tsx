import { useEffect, useRef, useState } from "react";

export function AtlasOrb() {
  const orbRef = useRef<HTMLDivElement>(null);
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
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
  }, []);

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
      className="flex h-36 w-36 items-center justify-center rounded-full bg-ink shadow-[0_25px_60px_-15px_rgba(0,0,0,0.45)] animate-atlas-breathe sm:h-44 sm:w-44"
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
      className="block h-4 w-4 rounded-full bg-white transition-transform duration-100 ease-out sm:h-5 sm:w-5"
      style={{
        transform: `translate(${offset.x}px, ${offset.y}px) scaleY(${
          blinking ? 0.12 : 1
        })`,
      }}
    />
  );
}