import { invoke } from "@tauri-apps/api/core";

/**
 * Admission control for harness instances, mirroring T3's
 * `ProviderAuthController.withAccess`: while any live session uses a profile,
 * its credentials must not be edited or removed.
 *
 * Counts are mirrored in Rust so the Settings window (a separate webview)
 * sees sessions started by the main window.
 */
const counts = new Map<string, number>();

function notify(command: "profile_acquire" | "profile_release", profileId: string) {
  try {
    void Promise.resolve(invoke(command, { profileId })).catch(() => {});
  } catch {
    // Non-Tauri test environments have no IPC bridge.
  }
}

export function acquireProfile(profileId: string): void {
  counts.set(profileId, (counts.get(profileId) ?? 0) + 1);
  notify("profile_acquire", profileId);
}

export function releaseProfile(profileId: string): void {
  const next = (counts.get(profileId) ?? 0) - 1;
  if (next <= 0) counts.delete(profileId);
  else counts.set(profileId, next);
  notify("profile_release", profileId);
}

export function isProfileBusy(profileId: string): boolean {
  return (counts.get(profileId) ?? 0) > 0;
}

export function profileSessionCount(profileId: string): number {
  return counts.get(profileId) ?? 0;
}

/** Cross-window refcounts from the Rust process. */
export async function remoteProfileLocks(): Promise<Record<string, number>> {
  try {
    return await invoke<Record<string, number>>("profile_locks");
  } catch {
    return {};
  }
}
