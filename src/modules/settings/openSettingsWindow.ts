import { invoke } from "@tauri-apps/api/core";

export type SettingsTab =
  | "general"
  | "themes"
  | "pets"
  | "providers"
  | "acp"
  | "usage"
  | "shortcuts"
  | "about";

export async function openSettingsWindow(tab?: SettingsTab): Promise<void> {
  await invoke("open_settings_window", { tab: tab ?? null });
}
