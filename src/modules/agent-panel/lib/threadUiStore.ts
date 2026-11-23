import { create } from "zustand";
import {
  EMPTY_THREAD_UI_STATE,
  markVisited,
  parseThreadUiState,
  pruneToKeys,
  setPinned,
  setTitle,
  THREAD_UI_STORAGE_KEY,
  type ThreadUiState,
  toggleFolder,
} from "@/modules/agent-panel/lib/threadUiState";

type State = ThreadUiState & {
  setPinned: (key: string, pinned: boolean) => void;
  setTitle: (key: string, title: string | null) => void;
  markVisited: (key: string, at?: number) => void;
  toggleFolder: (folderKey: string, collapsed?: boolean) => void;
  /** Forget every entry whose thread key is no longer open. */
  prune: (keys: readonly string[]) => void;
};

function readPersisted(): ThreadUiState {
  if (typeof window === "undefined") return EMPTY_THREAD_UI_STATE;
  try {
    const raw = window.localStorage.getItem(THREAD_UI_STORAGE_KEY);
    if (!raw) return EMPTY_THREAD_UI_STATE;
    return parseThreadUiState(JSON.parse(raw));
  } catch {
    return EMPTY_THREAD_UI_STATE;
  }
}

let writeTimer = 0;

function schedulePersist(state: ThreadUiState): void {
  if (typeof window === "undefined") return;
  if (writeTimer) window.clearTimeout(writeTimer);
  writeTimer = window.setTimeout(() => {
    writeTimer = 0;
    try {
      window.localStorage.setItem(
        THREAD_UI_STORAGE_KEY,
        JSON.stringify({
          pinned: state.pinned,
          titles: state.titles,
          lastVisitedAt: state.lastVisitedAt,
          order: state.order,
          collapsedFolders: state.collapsedFolders,
        } satisfies ThreadUiState),
      );
    } catch {
      // Storage can fail (quota, private mode); losing UI state is not fatal.
    }
  }, 250);
}

/** Thread UI state (pin, rename, MRU, folders) with a debounced localStorage mirror. */
export const useThreadUiStore = create<State>((set, get) => {
  const persist = () => schedulePersist(get());
  return {
    ...readPersisted(),
    setPinned: (key, pinned) => {
      set((state) => setPinned(state, key, pinned));
      persist();
    },
    setTitle: (key, title) => {
      set((state) => setTitle(state, key, title));
      persist();
    },
    markVisited: (key, at) => {
      set((state) => markVisited(state, key, at));
      persist();
    },
    toggleFolder: (folderKey, collapsed) => {
      set((state) => toggleFolder(state, folderKey, collapsed));
      persist();
    },
    prune: (keys) => {
      const before = get();
      const after = pruneToKeys(before, keys);
      if (
        after.pinned === before.pinned &&
        after.titles === before.titles &&
        after.lastVisitedAt === before.lastVisitedAt &&
        after.order === before.order
      ) {
        return;
      }
      set(after);
      persist();
    },
  };
});

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    if (writeTimer) {
      window.clearTimeout(writeTimer);
      writeTimer = 0;
    }
    const state = useThreadUiStore.getState();
    try {
      window.localStorage.setItem(
        THREAD_UI_STORAGE_KEY,
        JSON.stringify({
          pinned: state.pinned,
          titles: state.titles,
          lastVisitedAt: state.lastVisitedAt,
          order: state.order,
          collapsedFolders: state.collapsedFolders,
        } satisfies ThreadUiState),
      );
    } catch {
      // ignore
    }
  });
}

/** MRU-first ordering for open threads; unvisited threads keep their input order after touched ones. */
export function orderThreadKeys(
  keys: readonly string[],
  order: readonly string[],
  pinned: Readonly<Record<string, boolean>>,
): string[] {
  const rank = new Map(order.map((key, index) => [key, index]));
  const isPinned = (key: string) => pinned[key] === true;
  return [...keys].sort((left, right) => {
    const leftPinned = isPinned(left);
    const rightPinned = isPinned(right);
    if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
    const leftRank = rank.get(left);
    const rightRank = rank.get(right);
    if (leftRank === undefined && rightRank === undefined) return 0;
    if (leftRank === undefined) return 1;
    if (rightRank === undefined) return -1;
    return leftRank - rightRank;
  });
}
