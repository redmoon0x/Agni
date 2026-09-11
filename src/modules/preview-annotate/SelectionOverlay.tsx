import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { RectPx } from "./resolve";

type Props = {
  enabled: boolean;
  onSelect: (rect: RectPx) => void;
  onCancel?: () => void;
};

/**
 * Transparent marquee-selection layer over an iframe. When disabled it is
 * fully inert (pointer-events-none) so the preview underneath stays
 * interactive. When enabled, a pointer drag draws a rectangle and calls
 * onSelect with the px rect relative to the overlay.
 */
export function SelectionOverlay({ enabled, onSelect, onCancel }: Props) {
  const [drag, setDrag] = useState<RectPx | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const sizeRef = useRef<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    if (!enabled) setDrag(null);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrag(null);
        onCancel?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, onCancel]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled || event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    sizeRef.current = { width: rect.width, height: rect.height };
    startRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    setDrag({
      x: startRef.current.x,
      y: startRef.current.y,
      width: 0,
      height: 0,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const start = startRef.current;
    setDrag({
      x: Math.min(start.x, x),
      y: Math.min(start.y, y),
      width: Math.abs(x - start.x),
      height: Math.abs(y - start.y),
    });
  };

  const onPointerUp = () => {
    if (!startRef.current) return;
    const finalDrag = drag;
    startRef.current = null;
    setDrag(null);
    if (finalDrag && finalDrag.width > 4 && finalDrag.height > 4) {
      onSelect(finalDrag);
    }
  };

  return (
    <div
      className={cn(
        "absolute inset-0 z-10",
        enabled ? "cursor-crosshair touch-none" : "pointer-events-none",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        startRef.current = null;
        setDrag(null);
      }}
      role="presentation"
      aria-hidden={!enabled}
    >
      {drag ? (
        <div
          className="pointer-events-none absolute rounded-sm border border-primary bg-primary/10"
          style={{
            left: drag.x,
            top: drag.y,
            width: drag.width,
            height: drag.height,
          }}
        />
      ) : null}
    </div>
  );
}
