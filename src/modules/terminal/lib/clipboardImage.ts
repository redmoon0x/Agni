import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { formatDroppedPaths } from "./quoteShellPath";

const IMAGE_MIME_PREFIX = "image/";

function imageFileFromDataTransfer(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file" || !item.type.startsWith(IMAGE_MIME_PREFIX)) {
      continue;
    }
    const file = item.getAsFile();
    if (file) return file;
  }
  for (const file of Array.from(data.files)) {
    if (file.type.startsWith(IMAGE_MIME_PREFIX)) return file;
  }
  return null;
}

export function hasClipboardImage(data: DataTransfer | null): boolean {
  return imageFileFromDataTransfer(data) !== null;
}

async function saveClipboardImage(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  return invoke<string>("fs_save_clipboard_image", {
    mime: blob.type,
    bytes: Array.from(new Uint8Array(buffer)),
    workspace: currentWorkspaceEnv(),
  });
}

export async function pasteClipboardImageFromEvent(
  data: DataTransfer | null,
  paste: (text: string) => void,
): Promise<boolean> {
  const file = imageFileFromDataTransfer(data);
  if (!file) return false;
  const path = await saveClipboardImage(file);
  paste(formatDroppedPaths([path]));
  return true;
}

async function imagePathFromNavigatorClipboard(): Promise<string | null> {
  const read = navigator.clipboard?.read;
  if (!read) return null;
  const items = await read.call(navigator.clipboard);
  for (const item of items) {
    const type = item.types.find((candidate) =>
      candidate.startsWith(IMAGE_MIME_PREFIX),
    );
    if (!type) continue;
    return saveClipboardImage(await item.getType(type));
  }
  return null;
}

export async function pasteClipboardIntoTerminal(
  paste: (text: string) => void,
): Promise<void> {
  try {
    const imagePath = await imagePathFromNavigatorClipboard();
    if (imagePath) {
      paste(formatDroppedPaths([imagePath]));
      return;
    }
  } catch {
    // Some webviews expose text clipboard access but reject rich clipboard reads.
  }

  const text = await navigator.clipboard?.readText();
  if (text) paste(text);
}
