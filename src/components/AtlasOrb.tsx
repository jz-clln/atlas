import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

type AtlasMode = "idle" | "searching" | "listening" | "thinking";

type Props = {
  mode?: AtlasMode;
  size?: number;
};

// Atlas's face. A black circle with two white eyes that drift and blink on
// their own. The eyes themselves are static <ellipse>s at a fixed cx/cy —
// movement and blinking are done entirely via CSS transform (translate +
// scaleY), never by animating cx/cy/ry directly. Animating raw SVG geometry
// attributes through Framer Motion is fragile (undefined-during-transition
// errors); transforms are the reliable path for any element type.
export function AtlasOrb({ mode = "idle", size = 72 }: Props) {
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [blinking, setBlinking] = useState(false);
  const wanderRef = useRef<ReturnType<typeof setTimeout>>();
  const blinkRef = useRef<ReturnType<typeof setInterval>>();

  const range = mode === "searching" ? 5 : mode === "thinking" ? 3 : 2.5;
  const baseDelay = mode === "searching" ? 450 : mode === "listening" ? 1600 : 1100;

  useEffect(() => {
    function scheduleNext() {
      const delay = baseDelay + Math.random() * baseDelay;
      wanderRef.current = setTimeout(() => {
        if (mode === "listening") {
          setLook({ x: 0, y: 0.5 });
        } else if (mode === "thinking") {
          setLook({ x: (Math.random() - 0.5) * range, y: -1 - Math.random() * 1.5 });
        } else {
          setLook({
            x: (Math.random() - 0.5) * 2 * range,
            y: (Math.random() - 0.5) * range,
          });
        }
        scheduleNext();
      }, delay);
    }
    scheduleNext();
    return () => clearTimeout(wanderRef.current);
  }, [mode, range, baseDelay]);

  useEffect(() => {
    function scheduleBlink() {
      blinkRef.current = setTimeout(() => {
        setBlinking(true);
        setTimeout(() => setBlinking(false), 130);
        scheduleBlink();
      }, 2800 + Math.random() * 2400);
    }
    scheduleBlink();
    return () => clearTimeout(blinkRef.current);
  }, []);

  const eyeOffsetX = 13;
  const eyeCy = 36;
  const spring = { type: "spring" as const, stiffness: 220, damping: 20 };

  return (
    <svg width={size} height={size} viewBox="0 0 72 72" role="img" aria-label="Atlas">
      <circle cx="36" cy="36" r="34" fill="#0B0B0C" />
      {[-1, 1].map((side) => (
        <motion.ellipse
          key={side}
          cx={36 + side * eyeOffsetX}
          cy={eyeCy}
          rx={6}
          ry={7}
          fill="#FFFFFF"
          style={{ transformOrigin: `${36 + side * eyeOffsetX}px ${eyeCy}px` }}
          animate={{
            x: look.x,
            y: look.y,
            scaleY: blinking ? 0.08 : 1,
          }}
          transition={spring}
        />
      ))}
    </svg>
  );
}