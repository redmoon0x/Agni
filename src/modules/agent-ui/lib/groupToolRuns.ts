export type ToolLike = { id: string; status: string };

export type ToolRunStatus =
  | "pending"
  | "running"
  | "success"
  | "error"
  | "cancelled";

export type TimelineItem<T extends ToolLike, M> =
  | { kind: "message"; message: M; sequence: number }
  | { kind: "tool"; tool: T; sequence: number };

export type GroupedItem<T extends ToolLike, M> =
  | TimelineItem<T, M>
  | {
      kind: "tool-run";
      id: string;
      sequence: number;
      tools: T[];
      status: ToolRunStatus;
      label: string;
    };

const STATUS_ORDER: readonly ToolRunStatus[] = [
  "error",
  "running",
  "pending",
  "cancelled",
  "success",
];

function aggregateStatus(tools: ToolLike[]): ToolRunStatus {
  for (const status of STATUS_ORDER) {
    if (tools.some((tool) => tool.status === status)) return status;
  }
  return "success";
}

/** Narrate a run of tools from their kinds, favoring the most specific verb. */
export function toolRunLabel(kinds: readonly string[]): string {
  const count = (kind: string) => kinds.filter((value) => value === kind).length;
  const commands = count("execute");
  const edits = count("edit") + count("delete") + count("move");
  const reads = count("read") + count("search");
  if (commands > 0) {
    return `Ran ${commands} command${commands === 1 ? "" : "s"}`;
  }
  if (edits > 0) {
    return `Edited ${edits} file${edits === 1 ? "" : "s"}`;
  }
  if (reads > 0) {
    return `Read ${reads} file${reads === 1 ? "" : "s"}`;
  }
  return `Ran ${kinds.length} tool${kinds.length === 1 ? "" : "s"}`;
}

/**
 * Collapse runs of 2+ consecutive tool calls into one narrated group. A single
 * tool stays a plain row so a lone action is never hidden behind a disclosure.
 */
export function groupToolRuns<T extends ToolLike, M>(
  items: readonly TimelineItem<T, M>[],
  kindOf: (tool: T) => string,
): GroupedItem<T, M>[] {
  const output: GroupedItem<T, M>[] = [];
  let run: T[] = [];
  let runSequence = 0;

  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      const only = run[0];
      output.push({ kind: "tool", tool: only, sequence: runSequence });
    } else {
      output.push({
        kind: "tool-run",
        id: `run:${run[0].id}`,
        sequence: runSequence,
        tools: run,
        status: aggregateStatus(run),
        label: toolRunLabel(run.map(kindOf)),
      });
    }
    run = [];
  };

  for (const item of items) {
    if (item.kind === "tool") {
      if (run.length === 0) runSequence = item.sequence;
      run.push(item.tool);
      continue;
    }
    flush();
    output.push(item);
  }
  flush();
  return output;
}
