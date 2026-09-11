import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

export const DOCK_DEFAULT_HEIGHT = 260;
export const DOCK_MIN_HEIGHT = 120;
export const DOCK_MAX_HEIGHT = 720;
const DOCK_HEIGHT_STORAGE_KEY = "agni.terminal-dock.height";

function clampDockHeight(height: number): number {
  return Math.min(DOCK_MAX_HEIGHT, Math.max(DOCK_MIN_HEIGHT, Math.round(height)));
}

function readDockHeight(): number {
  try {
    const stored = window.localStorage.getItem(DOCK_HEIGHT_STORAGE_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : Number.NaN;
    return Number.isFinite(parsed) ? clampDockHeight(parsed) : DOCK_DEFAULT_HEIGHT;
  } catch {
    return DOCK_DEFAULT_HEIGHT;
  }
}

/** Sizing/collapse state for the bottom terminal dock -- same shape as useRightPanel. */
export function useTerminalDockPanel(defaultOpen: boolean) {
  const dockRef = useRef<PanelImperativeHandle | null>(null);
  const dockHeightRef = useRef(readDockHeight());
  const heightWriteTimerRef = useRef(0);
  const [dockOpen, setDockOpen] = useState(defaultOpen);

  const toggleDock = useCallback(() => {
    const panel = dockRef.current;
    if (!panel) return;
    if (panel.getSize().asPercentage <= 0) {
      panel.resize(`${dockHeightRef.current}px`);
      setDockOpen(true);
    } else {
      panel.collapse();
      setDockOpen(false);
    }
  }, []);

  const openDock = useCallback(() => {
    const panel = dockRef.current;
    if (!panel || panel.getSize().asPercentage > 0) return;
    panel.resize(`${dockHeightRef.current}px`);
    setDockOpen(true);
  }, []);

  const handleDockResize = useCallback((height: number) => {
    const open = height > 0;
    setDockOpen((current) => (current === open ? current : open));
    if (!open) return;
    const next = clampDockHeight(height);
    dockHeightRef.current = next;
    if (heightWriteTimerRef.current) {
      window.clearTimeout(heightWriteTimerRef.current);
    }
    heightWriteTimerRef.current = window.setTimeout(() => {
      heightWriteTimerRef.current = 0;
      try {
        window.localStorage.setItem(DOCK_HEIGHT_STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
    }, 200);
  }, []);

  useEffect(() => {
    return () => {
      if (heightWriteTimerRef.current) {
        window.clearTimeout(heightWriteTimerRef.current);
      }
    };
  }, []);

  return { dockRef, dockOpen, toggleDock, openDock, handleDockResize };
}
