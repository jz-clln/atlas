import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

type Position = { x: number; y: number };
type Size = { width: number; height: number };
type Corner = "nw" | "ne" | "sw" | "se";

type Props = {
  children: ReactNode;
  /** Rendered in the drag handle bar. Omit for an unlabeled grip. */
  title?: ReactNode;
  initialPosition?: Position;
  initialSize?: Size;
  minWidth?: number;
  minHeight?: number;
  className?: string;
  onPositionChange?: (position: Position) => void;
  onSizeChange?: (size: Size) => void;
};

const DEFAULT_MIN_WIDTH = 220;
const DEFAULT_MIN_HEIGHT = 140;
const HANDLE_BAR_HEIGHT = 32; // px

// Hand-rolled drag + resize on the native Pointer Events API — no new
// dependency, matching how the rest of this project avoids reaching for a
// library for things the browser already does. Wrap any widget in this and
// it becomes freely positionable and resizable from any corner, clamped so
// it can never end up dragged off-screen and unreachable.
//
// Only the header bar and the four corner handles start a drag/resize —
// the content area itself is left alone, so buttons/inputs/textareas
// inside a wrapped widget (e.g. AtlasWidget's chat input) keep working
// normally instead of every click on them starting a drag.
//
// Usage:
//   <DraggableResizable title="Atlas" initialPosition={{ x: 24, y: 24 }} initialSize={{ width: 380, height: 420 }}>
//     <AtlasWidget greeting={greeting} />
//   </DraggableResizable>
export function DraggableResizable({
  children,
  title,
  initialPosition = { x: 24, y: 24 },
  initialSize = { width: 360, height: 240 },
  minWidth = DEFAULT_MIN_WIDTH,
  minHeight = DEFAULT_MIN_HEIGHT,
  className = "",
  onPositionChange,
  onSizeChange,
}: Props) {
  const [position, setPosition] = useState<Position>(initialPosition);
  const [size, setSize] = useState<Size>(initialSize);

  // Mirrors of the latest state for the window-resize handler below, so
  // that listener doesn't need to be torn down and re-added on every drag.
  const positionRef = useRef(position);
  const sizeRef = useRef(size);
  positionRef.current = position;
  sizeRef.current = size;

  const dragOrigin = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeOrigin = useRef<{
    corner: Corner;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originWidth: number;
    originHeight: number;
  } | null>(null);

  function clampPosition(pos: Position, sz: Size): Position {
    const maxX = Math.max(0, window.innerWidth - sz.width);
    const maxY = Math.max(0, window.innerHeight - sz.height);
    return { x: Math.min(Math.max(0, pos.x), maxX), y: Math.min(Math.max(0, pos.y), maxY) };
  }

  function clampSize(sz: Size, pos: Position): Size {
    const maxWidth = window.innerWidth - pos.x;
    const maxHeight = window.innerHeight - pos.y;
    return {
      width: Math.min(Math.max(minWidth, sz.width), Math.max(minWidth, maxWidth)),
      height: Math.min(Math.max(minHeight, sz.height), Math.max(minHeight, maxHeight)),
    };
  }

  // Re-clamp if the browser window itself shrinks — otherwise a widget
  // positioned near the edge could end up stranded off-screen after a
  // resize/orientation change rather than only after a drag.
  useEffect(() => {
    function handleWindowResize() {
      const clampedPos = clampPosition(positionRef.current, sizeRef.current);
      const clampedSize = clampSize(sizeRef.current, clampedPos);
      setPosition(clampedPos);
      setSize(clampedSize);
    }
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDragPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragOrigin.current = { startX: e.clientX, startY: e.clientY, originX: position.x, originY: position.y };
  }

  function handleDragPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const origin = dragOrigin.current;
    if (!origin) return;
    const dx = e.clientX - origin.startX;
    const dy = e.clientY - origin.startY;
    const next = clampPosition({ x: origin.originX + dx, y: origin.originY + dy }, size);
    setPosition(next);
    onPositionChange?.(next);
  }

  function handleDragPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    dragOrigin.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function startResize(corner: Corner) {
    return (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      resizeOrigin.current = {
        corner,
        startX: e.clientX,
        startY: e.clientY,
        originX: position.x,
        originY: position.y,
        originWidth: size.width,
        originHeight: size.height,
      };
    };
  }

  function handleResizePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const origin = resizeOrigin.current;
    if (!origin) return;

    const dx = e.clientX - origin.startX;
    const dy = e.clientY - origin.startY;

    let nextWidth = origin.originWidth;
    let nextHeight = origin.originHeight;
    let nextX = origin.originX;
    let nextY = origin.originY;

    if (origin.corner === "se") {
      nextWidth = origin.originWidth + dx;
      nextHeight = origin.originHeight + dy;
    } else if (origin.corner === "sw") {
      nextWidth = origin.originWidth - dx;
      nextHeight = origin.originHeight + dy;
      nextX = origin.originX + dx;
    } else if (origin.corner === "ne") {
      nextWidth = origin.originWidth + dx;
      nextHeight = origin.originHeight - dy;
      nextY = origin.originY + dy;
    } else {
      nextWidth = origin.originWidth - dx;
      nextHeight = origin.originHeight - dy;
      nextX = origin.originX + dx;
      nextY = origin.originY + dy;
    }

    nextWidth = Math.max(minWidth, nextWidth);
    nextHeight = Math.max(minHeight, nextHeight);

    // If a left/top edge is being dragged, the opposite edge must stay
    // pinned — clamp the moving edge's position so width/height can't
    // shrink past the minimum by way of the position moving too far.
    if (origin.corner === "sw" || origin.corner === "nw") {
      nextX = Math.min(nextX, origin.originX + origin.originWidth - minWidth);
    }
    if (origin.corner === "ne" || origin.corner === "nw") {
      nextY = Math.min(nextY, origin.originY + origin.originHeight - minHeight);
    }

    const clampedPos = clampPosition({ x: nextX, y: nextY }, { width: nextWidth, height: nextHeight });
    const clampedSize = clampSize({ width: nextWidth, height: nextHeight }, clampedPos);

    setPosition(clampedPos);
    setSize(clampedSize);
    onPositionChange?.(clampedPos);
    onSizeChange?.(clampedSize);
  }

  function handleResizePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    resizeOrigin.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  const corners: { corner: Corner; position: string; cursor: string }[] = [
    { corner: "nw", position: "left-0 top-0", cursor: "cursor-nwse-resize" },
    { corner: "ne", position: "right-0 top-0", cursor: "cursor-nesw-resize" },
    { corner: "sw", position: "left-0 bottom-0", cursor: "cursor-nesw-resize" },
    { corner: "se", position: "right-0 bottom-0", cursor: "cursor-nwse-resize" },
  ];

  return (
    <div
      className={`absolute flex select-none flex-col overflow-hidden rounded-xl ${className}`}
      style={{ left: position.x, top: position.y, width: size.width, height: size.height }}
    >
      <div
        className="flex shrink-0 cursor-grab items-center gap-1.5 rounded-t-xl bg-black/[0.03] px-3 text-xs font-medium text-charcoal active:cursor-grabbing"
        style={{ height: HANDLE_BAR_HEIGHT, touchAction: "none" }}
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={handleDragPointerUp}
      >
        <span aria-hidden className="text-slate">⠿</span>
        {title}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">{children}</div>

      {corners.map(({ corner, position: posClass, cursor }) => (
        <div
          key={corner}
          role="presentation"
          aria-label={`Resize from ${corner} corner`}
          className={`absolute z-10 h-3.5 w-3.5 rounded-full border border-mist bg-white ${posClass} ${cursor}`}
          style={{ touchAction: "none", margin: -3 }}
          onPointerDown={startResize(corner)}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
        />
      ))}
    </div>
  );
}