import { create } from "zustand";

/**
 * "Open the agent picker" intent. The dock owns the trigger (header +,
 * sidebar new-session, empty state) and the mounted panel owns the picker,
 * so the request travels as state instead of a prop chain.
 */
type State = {
  request: number;
  open: () => void;
};

export const useAgentPickerIntent = create<State>((set) => ({
  request: 0,
  open: () => set((state) => ({ request: state.request + 1 })),
}));

export function requestAgentPicker(): void {
  useAgentPickerIntent.getState().open();
}