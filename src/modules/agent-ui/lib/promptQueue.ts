export type QueuedMode = "queue" | "steer";

export type QueuedPrompt = {
  id: string;
  text: string;
  mode: QueuedMode;
  createdAt: number;
  /** Attachments live in memory (base64 is too large for localStorage). */
  attachmentCount: number;
};

const PREFIX = "agni.promptQueue.";
const MAX_ITEMS = 20;

type Attachment = { type: "image" | "audio"; name: string; data: string; mimeType: string };

const attachments = new Map<string, Attachment[]>();

function storageKey(sessionKey: string): string {
  return `${PREFIX}${sessionKey}`;
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readQueue(sessionKey: string): QueuedPrompt[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(storageKey(sessionKey));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): QueuedPrompt[] => {
      if (typeof entry !== "object" || entry === null) return [];
      const record = entry as Record<string, unknown>;
      if (
        typeof record.id !== "string" ||
        typeof record.text !== "string" ||
        (record.mode !== "queue" && record.mode !== "steer")
      ) {
        return [];
      }
      return [
        {
          id: record.id,
          text: record.text,
          mode: record.mode,
          createdAt:
            typeof record.createdAt === "number" ? record.createdAt : Date.now(),
          attachmentCount:
            typeof record.attachmentCount === "number"
              ? record.attachmentCount
              : 0,
        },
      ];
    });
  } catch {
    return [];
  }
}

export function writeQueue(sessionKey: string, items: QueuedPrompt[]): void {
  const store = storage();
  if (!store) return;
  try {
    if (items.length === 0) store.removeItem(storageKey(sessionKey));
    else
      store.setItem(
        storageKey(sessionKey),
        JSON.stringify(items.slice(-MAX_ITEMS)),
      );
  } catch {
    /* quota or disabled storage: the in-memory queue still works this session */
  }
}

export function newQueuedPrompt(
  text: string,
  mode: QueuedMode,
  attachmentCount: number,
): QueuedPrompt {
  return {
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    mode,
    createdAt: Date.now(),
    attachmentCount,
  };
}

export function setQueuedAttachments(
  id: string,
  list: Attachment[],
): void {
  if (list.length === 0) attachments.delete(id);
  else attachments.set(id, list);
}

export function getQueuedAttachments(id: string): Attachment[] {
  return attachments.get(id) ?? [];
}

export function clearQueuedAttachments(id: string): void {
  attachments.delete(id);
}

/** Keep only the first `MAX_ITEMS`, oldest first. */
export function capQueue(items: QueuedPrompt[]): QueuedPrompt[] {
  return items.length > MAX_ITEMS ? items.slice(items.length - MAX_ITEMS) : items;
}
