import { create } from "zustand";
import type { AgentId } from "@/modules/settings/store";

type DraftStore = {
  pending: { text: string; agent: AgentId } | null;
  /** Stage a prompt snippet; App reacts by opening the agent panel. */
  setDraft: (text: string, agent?: AgentId) => void;
  /** Read and clear the pending draft (consume-once). */
  consume: () => string | null;
  /** Consume only if the draft was staged for this agent, leaving it otherwise. */
  consumeFor: (agent: AgentId) => string | null;
};

export const usePreviewAnnotateDraftStore = create<DraftStore>((set, get) => ({
  pending: null,
  setDraft: (text, agent = "pi") => set({ pending: { text, agent } }),
  consume: () => {
    const draft = get().pending;
    set({ pending: null });
    return draft?.text ?? null;
  },
  consumeFor: (agent) => {
    const draft = get().pending;
    if (!draft || draft.agent !== agent) return null;
    set({ pending: null });
    return draft.text;
  },
}));
