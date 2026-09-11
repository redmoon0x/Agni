import { create } from "zustand";

type DraftStore = {
  pending: { text: string } | null;
  /** Stage a prompt snippet; App reacts by opening the Pi panel. */
  setDraft: (text: string) => void;
  /** Read and clear the pending draft (consume-once). */
  consume: () => string | null;
};

export const usePreviewAnnotateDraftStore = create<DraftStore>((set, get) => ({
  pending: null,
  setDraft: (text) => set({ pending: { text } }),
  consume: () => {
    const draft = get().pending;
    set({ pending: null });
    return draft?.text ?? null;
  },
}));
