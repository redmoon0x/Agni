import { toast } from "sonner";

/**
 * Throttle window for identical (context, message) pairs. Without this a
 * render loop or a repeating invoke failure would spam the toast stack.
 */
const THROTTLE_MS = 4000;
const lastShown = new Map<string, number>();

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function stackOf(err: unknown): string {
  return err instanceof Error && err.stack ? err.stack : "";
}

/**
 * Central error reporter: keeps a console trail, forwards to the native log
 * file so failures survive into `tauri-plugin-log`, and surfaces a throttled
 * toast. Pass `silent` for low-signal backstops (global async handlers) that
 * should be recorded but not interrupt the user.
 */
export function reportError(
  context: string,
  err: unknown,
  opts?: { silent?: boolean },
): void {
  const message = messageOf(err);
  console.error(`[agni] ${context}:`, err);

  // Fire-and-forget. Dynamic so the plugin never lands in the eager startup
  // graph, and it resolves to nothing outside a Tauri webview (tests).
  void import("@tauri-apps/plugin-log")
    .then((log) => log.error(`${context}: ${message}`))
    .catch(() => {});

  if (opts?.silent) return;

  const key = `${context}:${message}`;
  const now = Date.now();
  const seen = lastShown.get(key);
  if (seen !== undefined && now - seen < THROTTLE_MS) return;
  lastShown.set(key, now);

  const stack = stackOf(err);
  toast.error(context, {
    description: message,
    duration: 5000,
    action: stack
      ? {
          label: "Copy details",
          onClick: () => {
            void navigator.clipboard?.writeText(`${message}\n\n${stack}`);
          },
        }
      : undefined,
  });
}
