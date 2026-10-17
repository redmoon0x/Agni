import { workspaceScopeKey, type WorkspaceEnv } from "@/modules/workspace";

type BufferEntry = {
  content: string;
  dirty: boolean;
  order: number;
};

const buffers = new Map<string, Map<symbol, BufferEntry>>();
let sequence = 0;

function normalize(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

function key(workspace: WorkspaceEnv, path: string): string {
  return `${workspaceScopeKey(workspace)}:${normalize(path)}`;
}

export function setAcpEditorBuffer(
  owner: symbol,
  workspace: WorkspaceEnv,
  path: string,
  content: string,
  dirty = false,
): void {
  const mapKey = key(workspace, path);
  const entries = buffers.get(mapKey) ?? new Map<symbol, BufferEntry>();
  sequence += 1;
  entries.set(owner, { content, dirty, order: sequence });
  buffers.set(mapKey, entries);
}

export function removeAcpEditorBuffer(
  owner: symbol,
  workspace: WorkspaceEnv,
  path: string,
): void {
  const mapKey = key(workspace, path);
  const entries = buffers.get(mapKey);
  if (!entries) return;
  entries.delete(owner);
  if (entries.size === 0) buffers.delete(mapKey);
}

export function getAcpEditorBuffer(
  path: string,
  workspace: WorkspaceEnv,
): string | null {
  return getAcpEditorBufferSnapshot(path, workspace)?.content ?? null;
}

export function getAcpEditorBufferSnapshot(
  path: string,
  workspace: WorkspaceEnv,
): { content: string; dirty: boolean } | null {
  const entries = buffers.get(key(workspace, path));
  if (!entries?.size) return null;
  let latest: BufferEntry | null = null;
  for (const entry of entries.values()) {
    if (!latest || entry.order > latest.order) latest = entry;
  }
  return latest ? { content: latest.content, dirty: latest.dirty } : null;
}
