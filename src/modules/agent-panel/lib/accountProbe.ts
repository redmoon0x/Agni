import { invoke } from "@tauri-apps/api/core";
import {
  type AgentProfile,
  profileEnvWire,
  profileExtraArgs,
} from "./profile";

const ANSI = /\u001b\[[0-9;]*m/g;

export type AccountProbe = {
  label: string;
  raw: string;
};

/**
 * Ask the harness's own status command who is signed in. Rust owns the fixed
 * command allowlist; the frontend only supplies the profile env and cwd.
 */
export async function probeProfileAccount(
  profile: AgentProfile,
  cwd: string,
): Promise<AccountProbe | null> {
  const raw = await invoke<string | null>("profile_account_probe", {
    agent: profile.agent,
    env: profileEnvWire(profile),
    cwd,
    // Hermes needs `-p <profile>`; other harnesses add nothing here.
    args: profileExtraArgs(profile),
  });
  if (!raw) return null;
  return { label: summarizeAccount(profile.agent, raw), raw };
}

/** Turn each harness's status output into a short account/provider label. */
export function summarizeAccount(agent: string, raw: string): string {
  const text = raw.replace(ANSI, "").trim();
  if (!text) return "Signed in";

  if (agent === "claude") {
    const json = extractJson(text);
    if (json) {
      if (typeof json.email === "string" && json.email.trim()) {
        return json.email.trim();
      }
      if (json.loggedIn === true) return "Signed in";
    }
  }

  if (agent === "commandcode") {
    const email = text.match(/Email:\s*([^\s]+@[^\s]+)/i)?.[1];
    if (email) return email;
    const user =
      text.match(/Authenticated as\s+([^\s]+)/i)?.[1] ??
      text.match(/Name:\s*([^\s]+)/i)?.[1];
    if (user) return user;
  }

  if (agent === "opencode" || agent === "kilo") {
    const providers = [
      ...text.matchAll(/^\s*[•-]\s+(.+?)\s+(?:api|oauth)\b/gim),
    ].map((match) => match[1].trim());
    if (providers.length > 0) {
      const shown = providers.slice(0, 3).join(", ");
      return providers.length > 3 ? `${shown} +${providers.length - 3}` : shown;
    }
    const count = text.match(/(\d+)\s+credentials?/i)?.[1];
    if (count) return `${count} credential${count === "1" ? "" : "s"}`;
  }

  if (agent === "hermes") {
    const providers = [
      ...text.matchAll(/^([a-z0-9-]+)\s+\(\d+\s+credentials?\)/gim),
    ].map((match) => match[1]);
    if (providers.length > 0) {
      const shown = providers.slice(0, 4).join(", ");
      return providers.length > 4 ? `${shown} +${providers.length - 4}` : shown;
    }
  }

  const line = text
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);
  return line ? line.slice(0, 80) : "Signed in";
}

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
