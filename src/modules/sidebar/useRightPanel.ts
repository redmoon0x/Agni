import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

export const RIGHT_PANEL_DEFAULT_WIDTH = 360;
export const RIGHT_PANEL_MIN_WIDTH = 280;
export const RIGHT_PANEL_MAX_WIDTH = 640;
const RIGHT_PANEL_WIDTH_STORAGE_KEY = "agni.right-panel.width";

function clampRightPanelWidth(width: number): number {
  return Math.min(
    RIGHT_PANEL_MAX_WIDTH,
    Math.max(RIGHT_PANEL_MIN_WIDTH, Math.round(width)),
  );
}

function readRightPanelWidth(): number {
  try {
    const stored = window.localStorage.getItem(RIGHT_PANEL_WIDTH_STORAGE_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : Number.NaN;
    return Number.isFinite(parsed)
      ? clampRightPanelWidth(parsed)
      : RIGHT_PANEL_DEFAULT_WIDTH;
  } catch {
    return RIGHT_PANEL_DEFAULT_WIDTH;
  }
}

export function useRightPanel() {
  const rightPanelRef = useRef<PanelImperativeHandle | null>(null);
  const rightPanelWidthRef = useRef(readRightPanelWidth());
  const widthWriteTimerRef = useRef(0);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);

  const toggleRightPanel = useCallback(() => {
    const panel = rightPanelRef.current;
    if (!panel) return;
    if (panel.getSize().asPercentage <= 0) {
      panel.resize(`${rightPanelWidthRef.current}px`);
      setRightPanelOpen(true);
    } else {
      panel.collapse();
      setRightPanelOpen(false);
    }
  }, []);

  const openRightPanel = useCallback(() => {
    const panel = rightPanelRef.current;
    if (!panel || panel.getSize().asPercentage > 0) return;
    panel.resize(`${rightPanelWidthRef.current}px`);
    setRightPanelOpen(true);
  }, []);

  const closeRightPanel = useCallback(() => {
    const panel = rightPanelRef.current;
    if (!panel || panel.getSize().asPercentage <= 0) return;
    panel.collapse();
    setRightPanelOpen(false);
  }, []);

  const handleRightPanelResize = useCallback((width: number) => {
    const open = width > 0;
    setRightPanelOpen((current) => (current === open ? current : open));
    if (!open) return;
    const next = clampRightPanelWidth(width);
    rightPanelWidthRef.current = next;
    if (widthWriteTimerRef.current) {
      window.clearTimeout(widthWriteTimerRef.current);
    }
    widthWriteTimerRef.current = window.setTimeout(() => {
      widthWriteTimerRef.current = 0;
      try {
        window.localStorage.setItem(
          RIGHT_PANEL_WIDTH_STORAGE_KEY,
          String(next),
        );
      } catch {
        // ignore
      }
    }, 200);
  }, []);

  useEffect(() => {
    return () => {
      if (widthWriteTimerRef.current) {
        window.clearTimeout(widthWriteTimerRef.current);
      }
    };
  }, []);

  return {
    rightPanelRef,
    rightPanelOpen,
    toggleRightPanel,
    openRightPanel,
    closeRightPanel,
    handleRightPanelResize,
  };
}
