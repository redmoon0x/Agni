import { create } from "zustand";

export type PiPanelMode = "chat" | "terminal";

type PiPanelModeStore = {
  mode: PiPanelMode;
  setMode: (mode: PiPanelMode) => void;
};

/** Chat vs. plain-terminal mode for the Pi panel -- separate from usePiStore
 * (Pi's own RPC/chat state) since the terminal mode runs an unrelated CLI
 * agent, not Pi itself. */
export const usePiPanelModeStore = create<PiPanelModeStore>((set) => ({
  mode: "chat",
  setMode: (mode) => set({ mode }),
}));
