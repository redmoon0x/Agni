import { useCallback, useEffect, useState } from "react";
import type { AcpAttachment } from "@/modules/acp-agent/types";
import {
  capQueue,
  clearQueuedAttachments,
  getQueuedAttachments,
  newQueuedPrompt,
  readQueue,
  setQueuedAttachments,
  writeQueue,
  type QueuedMode,
  type QueuedPrompt,
} from "@/modules/agent-ui/lib/promptQueue";

export type PromptQueueApi = {
  items: QueuedPrompt[];
  add: (text: string, mode: QueuedMode, attachments: AcpAttachment[]) => void;
  remove: (id: string) => void;
  update: (id: string, text: string) => void;
  /** Move an item to the front (used by "Run now" / steer). */
  promote: (id: string) => void;
  peek: () => QueuedPrompt | null;
  take: (id: string) => QueuedPrompt | null;
  attachmentsFor: (id: string) => AcpAttachment[];
};

/** Queue state for one agent session, persisted across reloads (text only). */
export function usePromptQueue(sessionKey: string): PromptQueueApi {
  const [items, setItems] = useState<QueuedPrompt[]>(() =>
    readQueue(sessionKey),
  );

  useEffect(() => {
    setItems(readQueue(sessionKey));
  }, [sessionKey]);

  const commit = useCallback(
    (next: QueuedPrompt[]) => {
      const capped = capQueue(next);
      setItems(capped);
      writeQueue(sessionKey, capped);
    },
    [sessionKey],
  );

  const add = useCallback(
    (text: string, mode: QueuedMode, attachments: AcpAttachment[]) => {
      const item = newQueuedPrompt(text, mode, attachments.length);
      setQueuedAttachments(item.id, attachments);
      commit([...items, item]);
    },
    [commit, items],
  );

  const remove = useCallback(
    (id: string) => {
      clearQueuedAttachments(id);
      commit(items.filter((entry) => entry.id !== id));
    },
    [commit, items],
  );

  const update = useCallback(
    (id: string, text: string) => {
      commit(items.map((entry) => (entry.id === id ? { ...entry, text } : entry)));
    },
    [commit, items],
  );

  const promote = useCallback(
    (id: string) => {
      const target = items.find((entry) => entry.id === id);
      if (!target) return;
      commit([
        { ...target, mode: "steer" },
        ...items.filter((entry) => entry.id !== id),
      ]);
    },
    [commit, items],
  );

  const peek = useCallback(() => items[0] ?? null, [items]);

  const take = useCallback(
    (id: string) => {
      const item = items.find((entry) => entry.id === id) ?? null;
      if (item) remove(id);
      return item;
    },
    [items, remove],
  );

  const attachmentsFor = useCallback(
    (id: string) => getQueuedAttachments(id),
    [],
  );

  return { items, add, remove, update, promote, peek, take, attachmentsFor };
}
