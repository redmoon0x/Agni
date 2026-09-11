import { invoke } from "@tauri-apps/api/core";
import { loadPreferences } from "@/modules/settings/store";

let cached: string | undefined;

function normalize(dir: string): string {
  return dir.replace(/\\/g, "/");
}

/**
 * When launch fell back to the home directory (no CLI-specified dir), resume
 * the last project the user had open instead -- otherwise every launch from
 * the Start Menu / Dock lands back at home. Re-authorizes the remembered path
 * so a deleted/moved folder falls back to `fallback` instead of erroring the
 * first terminal spawn.
 */
async function preferLastProject(fallback: string): Promise<string> {
  const { lastProjectRoot } = await loadPreferences();
  if (!lastProjectRoot || normalize(lastProjectRoot) === fallback) {
    return fallback;
  }
  try {
    const canonical = await invoke<string>("workspace_authorize", {
      path: lastProjectRoot,
    });
    return normalize(canonical);
  } catch {
    return fallback;
  }
}

export async function initLaunchDir(): Promise<void> {
  const cliDir = await invoke<string | null>("get_launch_dir").catch(
    () => null,
  );
  if (cliDir) {
    cached = normalize(cliDir);
    return;
  }
  const fallback = await invoke<string>("workspace_current_dir").catch(
    () => null,
  );
  cached = fallback ? await preferLastProject(normalize(fallback)) : undefined;
}

export function getLaunchDir(): string | undefined {
  return cached;
}
