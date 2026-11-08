import type { AcpMessage, AcpToolCall } from "@/modules/acp-agent/types";

export type TurnFile = {
  path: string;
  operation: string;
  insertions: number;
  deletions: number;
};

export type AcpTurnFiles = {
  id: string;
  startSequence: number;
  /** Sequence of the last item in the turn, used to place the card. */
  endSequence: number;
  files: TurnFile[];
};

/** Count +/- lines in a unified diff, ignoring file headers. */
export function countPatchLines(patch: string | null): {
  insertions: number;
  deletions: number;
} {
  if (!patch) return { insertions: 0, deletions: 0 };
  let insertions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) insertions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { insertions, deletions };
}

type Event =
  | { sequence: number; kind: "message"; message: AcpMessage }
  | { sequence: number; kind: "tool"; tool: AcpToolCall };

function addFiles(target: Map<string, TurnFile>, tool: AcpToolCall): void {
  for (const content of tool.content) {
    if (content.type !== "diff") continue;
    const operation = content.changes[0]?.operation ?? "update";
    const path =
      content.path ||
      content.changes.find((change) => change.path)?.path ||
      "";
    if (!path) continue;
    const counts = countPatchLines(content.patch);
    const existing = target.get(path);
    if (existing) {
      existing.insertions += counts.insertions;
      existing.deletions += counts.deletions;
      existing.operation = operation;
    } else {
      target.set(path, {
        path,
        operation,
        insertions: counts.insertions,
        deletions: counts.deletions,
      });
    }
  }
}

/**
 * Group changed files by conversational turn. A turn starts at a user message;
 * tools before the first user message share an implicit opening turn.
 */
export function acpTurnFiles(
  messages: readonly AcpMessage[],
  tools: readonly AcpToolCall[],
): AcpTurnFiles[] {
  const events: Event[] = [
    ...messages.map(
      (message): Event => ({
        sequence: message.sequence,
        kind: "message",
        message,
      }),
    ),
    ...tools.map(
      (tool): Event => ({ sequence: tool.sequence, kind: "tool", tool }),
    ),
  ].sort((a, b) => a.sequence - b.sequence);

  const turns: AcpTurnFiles[] = [];
  let current: {
    id: string;
    startSequence: number;
    endSequence: number;
    files: Map<string, TurnFile>;
  } | null = null;

  const finalize = () => {
    if (!current) return;
    if (current.files.size > 0) {
      turns.push({
        id: current.id,
        startSequence: current.startSequence,
        endSequence: current.endSequence,
        files: [...current.files.values()],
      });
    }
    current = null;
  };

  for (const event of events) {
    if (event.kind === "message" && event.message.role === "user") {
      finalize();
      current = {
        id: event.message.id,
        startSequence: event.sequence,
        endSequence: event.sequence,
        files: new Map(),
      };
      continue;
    }
    if (!current) {
      current = {
        id: `turn:${event.sequence}`,
        startSequence: event.sequence,
        endSequence: event.sequence,
        files: new Map(),
      };
    }
    current.endSequence = event.sequence;
    if (event.kind === "tool") addFiles(current.files, event.tool);
  }
  finalize();
  return turns;
}
