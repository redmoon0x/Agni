import type { TerminalTab } from "./useTabs";

type TerminalTabInput = {
  tabId: number;
  leafId: number;
  title: string;
  cwd?: string;
  private?: boolean;
};

export function createTerminalTab(input: TerminalTabInput): TerminalTab {
  return {
    id: input.tabId,
    kind: "terminal",
    title: input.title,
    cwd: input.cwd,
    paneTree: { kind: "leaf", id: input.leafId, cwd: input.cwd },
    activeLeafId: input.leafId,
    ...(input.private && { private: true }),
  };
}
