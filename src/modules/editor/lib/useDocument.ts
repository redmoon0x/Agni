import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { reportError } from "@/lib/errors";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  removeAcpEditorBuffer,
  setAcpEditorBuffer,
} from "@/modules/acp-agent/bufferRegistry";

type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

type FormatResult = { content: string; formatted: boolean };

export type DocumentState =
  | { status: "loading" }
  | { status: "ready"; content: string; size: number }
  | { status: "binary"; size: number }
  | { status: "toolarge"; size: number; limit: number }
  | { status: "error"; message: string };

type Options = {
  path: string;
  onDirtyChange?: (dirty: boolean) => void;
};

export function useDocument({ path, onDirtyChange }: Options) {
  const [doc, setDoc] = useState<DocumentState>({ status: "loading" });
  const [dirty, setDirty] = useState(false);

  const autoSave = usePreferencesStore((s) => s.editorAutoSave);
  const autoSaveDelay = usePreferencesStore((s) => s.editorAutoSaveDelay);
  const formatOnSave = usePreferencesStore((s) => s.editorFormatOnSave);

  // Track the saved buffer so we can detect changes cheaply.
  const savedRef = useRef<string>("");
  const bufferRef = useRef<string>("");
  const bufferOwner = useRef(Symbol("editor-buffer"));
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const autoSaveRef = useRef({ autoSave, autoSaveDelay });
  autoSaveRef.current = { autoSave, autoSaveDelay };

  const formatOnSaveRef = useRef(formatOnSave);
  formatOnSaveRef.current = formatOnSave;

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoSaveTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const saveNow = useCallback(async () => {
    let content = bufferRef.current;

    if (formatOnSaveRef.current) {
      try {
        const res = await invoke<FormatResult>("format_text", {
          path,
          content,
          workspace: currentWorkspaceEnv(),
        });
        if (res.formatted && res.content !== content) {
          content = res.content;
          bufferRef.current = content;
          setDoc((d) => (d.status === "ready" ? { ...d, content } : d));
        }
      } catch (e) {
        // Best effort: a formatter failure must never block the save.
        reportError("Format failed", e, { silent: true });
      }
    }

    await invoke("fs_write_file", {
      path,
      content,
      workspace: currentWorkspaceEnv(),
      source: "editor",
    });
    savedRef.current = content;
    setAcpEditorBuffer(bufferOwner.current, currentWorkspaceEnv(), path, content, false);
    setDirty(false);
  }, [path]);

  // Notify parent of dirty transitions.
  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);

  // Load on path change or explicit reload.
  useEffect(() => {
    let cancelled = false;
    // Captured once so the cleanup below releases the exact key this effect wrote.
    const workspace = currentWorkspaceEnv();
    setDoc({ status: "loading" });
    setDirty(false);

    invoke<ReadResult>("fs_read_file", {
      path,
      workspace,
    })
      .then((res) => {
        if (cancelled) return;
        if (res.kind === "text") {
          savedRef.current = res.content;
          bufferRef.current = res.content;
          setAcpEditorBuffer(
            bufferOwner.current,
            workspace,
            path,
            res.content,
            false,
          );
          setDoc({
            status: "ready",
            content: res.content,
            size: res.size,
          });
        } else if (res.kind === "binary") {
          setDoc({ status: "binary", size: res.size });
        } else if (res.kind === "toolarge") {
          setDoc({
            status: "toolarge",
            size: res.size,
            limit: res.limit,
          });
        }
      })
      .catch((e) => {
        if (!cancelled) setDoc({ status: "error", message: String(e) });
      });

    return () => {
      cancelled = true;
      removeAcpEditorBuffer(bufferOwner.current, workspace, path);
    };
  }, [path]);

  // Skipped while dirty (never clobber unsaved edits) and when disk already
  // matches the buffer (self-save / duplicate watcher event → no re-render).
  const reload = useCallback((): boolean => {
    if (dirtyRef.current) return false;
    void invoke<ReadResult>("fs_read_file", {
      path,
      workspace: currentWorkspaceEnv(),
    })
      .then((res) => {
        if (res.kind === "text") {
          if (res.content === savedRef.current) return;
          savedRef.current = res.content;
          bufferRef.current = res.content;
          setAcpEditorBuffer(
            bufferOwner.current,
            currentWorkspaceEnv(),
            path,
            res.content,
            false,
          );
          setDirty(false);
          setDoc({ status: "ready", content: res.content, size: res.size });
        } else if (res.kind === "binary") {
          setDoc({ status: "binary", size: res.size });
        } else if (res.kind === "toolarge") {
          setDoc({ status: "toolarge", size: res.size, limit: res.limit });
        }
      })
      .catch((e) => setDoc({ status: "error", message: String(e) }));
    return true;
  }, [path]);

  const save = useCallback(async () => {
    clearAutoSaveTimer();
    if (!dirty) return;
    await saveNow();
  }, [dirty, clearAutoSaveTimer, saveNow]);

  const onChange = useCallback(
    (next: string) => {
      bufferRef.current = next;
      const isDirty = next !== savedRef.current;
      setAcpEditorBuffer(
        bufferOwner.current,
        currentWorkspaceEnv(),
        path,
        next,
        isDirty,
      );
      setDirty(isDirty);

      clearAutoSaveTimer();

      const { autoSave: active, autoSaveDelay: delay } = autoSaveRef.current;
      if (active && isDirty) {
        timeoutRef.current = setTimeout(() => {
          saveNow().catch((e) => reportError("Autosave failed", e));
        }, delay);
      }
    },
    [clearAutoSaveTimer, saveNow, path],
  );

  useEffect(() => clearAutoSaveTimer, [clearAutoSaveTimer]);

  return { doc, dirty, onChange, save, reload };
}
