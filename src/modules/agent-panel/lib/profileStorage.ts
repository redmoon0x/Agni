import { invoke } from "@tauri-apps/api/core";
import type { AgentProfile } from "./profile";

export type ProfileStorage = {
  root: string;
  configDir: string;
  dataDir: string;
};

/** Create (if needed) and return `~/.agni/profiles/<id>/{config,data}`. */
export async function ensureProfileStorage(
  profileId: string,
): Promise<ProfileStorage> {
  return invoke<ProfileStorage>("ensure_profile_storage", { profileId });
}

/** An Agni-managed profile whose folders were never resolved into settings. */
export function needsManagedStorage(profile: AgentProfile): boolean {
  return profile.managedPaths && (!profile.configDir || !profile.dataDir);
}

/**
 * Managed profiles saved before `ensure_profile_storage` returned camelCase
 * keys carry no directories, so no isolation env is emitted and every harness
 * silently falls back to the default account. Resolve them once at startup.
 * The old verification stamp is cleared because it was recorded against that
 * shared default account.
 */
export async function resolveManagedProfilePaths(
  profiles: readonly AgentProfile[],
): Promise<AgentProfile[]> {
  if (!profiles.some(needsManagedStorage)) return [...profiles];
  return Promise.all(
    profiles.map(async (profile) => {
      if (!needsManagedStorage(profile)) return profile;
      try {
        const storage = await ensureProfileStorage(profile.id);
        return {
          ...profile,
          configDir: storage.configDir,
          dataDir: storage.dataDir,
          lastVerifiedAt: null,
          accountLabel: null,
          accountCheckedAt: null,
        };
      } catch {
        return profile;
      }
    }),
  );
}
