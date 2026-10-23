import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { mimeForPath } from "./mime";

type Base64ReadResult = { base64: string; size: number };

type Status =
  | { kind: "loading" }
  | { kind: "ready"; dataUrl: string }
  | { kind: "suspended" }
  | { kind: "error"; message: string };

const SUSPEND_AFTER_MS = 30_000;

/** Reads a visible file as a `data:` URL for rendering binary content. */
export function useBase64File(path: string, visible: boolean): Status {
  const [status, setStatus] = useState<Status>({ kind: "suspended" });

  useEffect(() => {
    if (!visible) {
      const timer = window.setTimeout(
        () => setStatus({ kind: "suspended" }),
        SUSPEND_AFTER_MS,
      );
      return () => window.clearTimeout(timer);
    }

    let cancelled = false;
    setStatus({ kind: "loading" });
    invoke<Base64ReadResult>("fs_read_file_base64", {
      path,
      workspace: currentWorkspaceEnv(),
    })
      .then((res) => {
        if (cancelled) return;
        setStatus({
          kind: "ready",
          dataUrl: `data:${mimeForPath(path)};base64,${res.base64}`,
        });
      })
      .catch((e) => {
        if (!cancelled) setStatus({ kind: "error", message: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [path, visible]);

  return status;
}
