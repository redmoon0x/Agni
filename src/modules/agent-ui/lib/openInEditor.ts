import { openUrl } from "@tauri-apps/plugin-opener";

export type ExternalEditor = "vscode" | "cursor" | "zed";

export const EXTERNAL_EDITORS: { id: ExternalEditor; label: string }[] = [
  { id: "vscode", label: "VS Code" },
  { id: "cursor", label: "Cursor" },
  { id: "zed", label: "Zed" },
];

function urlPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(normalized)) return `/${normalized}`;
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

/**
 * Build an editor URL for a file. Uses URL schemes so no new Tauri
 * capability is needed. `line` is 1-based and appended for vscode-family
 * editors; Zed opens the file and positions by its own protocol.
 */
export function externalEditorUrl(
  editor: ExternalEditor,
  path: string,
  line?: number,
): string {
  const base = `${editor}://file${urlPath(path)}`;
  if (editor === "zed") return base;
  return line && line > 0 ? `${base}:${line}` : base;
}

export async function openInExternalEditor(
  editor: ExternalEditor,
  path: string,
  line?: number,
): Promise<void> {
  await openUrl(externalEditorUrl(editor, path, line));
}
