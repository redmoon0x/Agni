import { invoke } from "@tauri-apps/api/core";

/** A profile's environment value: literal text or an OS-keychain reference. */
export type ProfileEnvValue =
  | { kind: "text"; value: string }
  | { kind: "secret"; account: string };

export type ProfileEnv = {
  name: string;
  value: ProfileEnvValue;
  /** Masks the editor and forces keychain storage. */
  sensitive?: boolean;
};

/**
 * One harness instance, modeled on T3's `ProviderInstanceConfig`: display
 * identity, environment, and the per-harness isolation directory.
 */
export type AgentProfile = {
  id: string;
  agent: string;
  label: string;
  enabled: boolean;
  environment: ProfileEnv[];
  /** CLAUDE_CONFIG_DIR / OPENCODE_CONFIG_DIR / PI_CODING_AGENT_DIR. */
  configDir: string | null;
  /** XDG_DATA_HOME base (OpenCode auth) or HERMES_HOME. */
  dataDir: string | null;
  /** Hermes's native profile name, passed as `-p <name>`. */
  hermesProfile: string | null;
  /** Custom ACP executable (agent === "custom"). */
  customProgram: string | null;
  /** Custom ACP literal arguments, one per row. */
  customArgs: string[];
  /** Last successful ACP verification, ISO timestamp. */
  lastVerifiedAt: string | null;
  /** Signed-in account/provider summary from the harness status command. */
  accountLabel: string | null;
  accountCheckedAt: string | null;
  /** Paths live under `~/.agni/profiles/<id>` and are created by Agni. */
  managedPaths: boolean;
};

export const CUSTOM_AGENT_ID = "custom";
export const CUSTOM_AGENT_LABEL = "Custom ACP";

export type ProfileEnvWire = {
  name: string;
  value?: string;
  secret?: string;
};

const PROFILE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function newProfileId(): string {
  return `profile-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export function secretAccount(profileId: string, envName: string): string {
  return `${profileId}:${envName}`;
}

export function parseAgentProfiles(value: unknown): AgentProfile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): AgentProfile[] => {
    if (!isRecord(entry)) return [];
    if (
      typeof entry.id !== "string" ||
      !PROFILE_ID.test(entry.id) ||
      typeof entry.agent !== "string" ||
      !entry.agent
    ) {
      return [];
    }
    const environment = Array.isArray(entry.environment)
      ? entry.environment.flatMap((variable): ProfileEnv[] => {
          if (!isRecord(variable)) return [];
          if (
            typeof variable.name !== "string" ||
            !ENV_NAME.test(variable.name)
          ) {
            return [];
          }
          const raw = variable.value;
          if (
            isRecord(raw) &&
            raw.kind === "secret" &&
            typeof raw.account === "string"
          ) {
            return [
              {
                name: variable.name,
                value: { kind: "secret", account: raw.account },
                sensitive: true,
              },
            ];
          }
          if (
            isRecord(raw) &&
            raw.kind === "text" &&
            typeof raw.value === "string"
          ) {
            return [
              {
                name: variable.name,
                value: { kind: "text", value: raw.value },
              },
            ];
          }
          return [];
        })
      : [];
    return [
      {
        id: entry.id,
        agent: entry.agent,
        label:
          typeof entry.label === "string" && entry.label.trim()
            ? entry.label.trim()
            : entry.agent,
        enabled: entry.enabled !== false,
        environment,
        configDir: typeof entry.configDir === "string" ? entry.configDir : null,
        dataDir: typeof entry.dataDir === "string" ? entry.dataDir : null,
        hermesProfile:
          typeof entry.hermesProfile === "string" ? entry.hermesProfile : null,
        customProgram:
          typeof entry.customProgram === "string" && entry.customProgram.trim()
            ? entry.customProgram.trim()
            : null,
        customArgs: Array.isArray(entry.customArgs)
          ? entry.customArgs
              .filter(
                (arg): arg is string =>
                  typeof arg === "string" &&
                  arg.length <= 512 &&
                  !arg.includes("\n") &&
                  !arg.includes("\r") &&
                  !arg.includes("\0"),
              )
              .slice(0, 32)
          : [],
        lastVerifiedAt:
          typeof entry.lastVerifiedAt === "string" &&
          Number.isFinite(Date.parse(entry.lastVerifiedAt))
            ? entry.lastVerifiedAt
            : null,
        accountLabel:
          typeof entry.accountLabel === "string" && entry.accountLabel.trim()
            ? entry.accountLabel.trim().slice(0, 160)
            : null,
        accountCheckedAt:
          typeof entry.accountCheckedAt === "string" &&
          Number.isFinite(Date.parse(entry.accountCheckedAt))
            ? entry.accountCheckedAt
            : null,
        managedPaths: entry.managedPaths === true,
      },
    ];
  });
}

/**
 * Build the environment a spawn needs. Known isolation directories are mapped
 * to each harness's documented variable; explicit environment entries win.
 */
export function profileEnvWire(profile: AgentProfile): ProfileEnvWire[] {
  const out: ProfileEnvWire[] = [];
  const pushText = (name: string, value: string | null | undefined) => {
    if (!value || !value.trim()) return;
    out.push({ name, value: value.trim() });
  };

  switch (profile.agent) {
    case "claude":
      pushText("CLAUDE_CONFIG_DIR", profile.configDir);
      break;
    case "opencode":
    case "kilo":
      pushText("XDG_DATA_HOME", profile.dataDir);
      pushText("OPENCODE_CONFIG_DIR", profile.configDir);
      break;
    case "hermes":
      pushText("HERMES_HOME", profile.dataDir);
      break;
    case "pi":
      pushText("PI_CODING_AGENT_DIR", profile.configDir);
      break;
    case CUSTOM_AGENT_ID:
      break;
    default:
      break;
  }

  for (const variable of profile.environment) {
    out.push(
      variable.value.kind === "secret"
        ? { name: variable.name, secret: variable.value.account }
        : { name: variable.name, value: variable.value.value },
    );
  }
  return out;
}

/** The env var each harness needs to point at its own account folder. */
const ISOLATION_ENV: Record<string, string> = {
  claude: "CLAUDE_CONFIG_DIR",
  opencode: "XDG_DATA_HOME",
  kilo: "XDG_DATA_HOME",
  hermes: "HERMES_HOME",
  pi: "PI_CODING_AGENT_DIR",
};

/**
 * A managed profile must carry the environment that points its harness at the
 * profile's own folder. Without it the harness starts against the host's
 * default account, so work traffic silently uses the personal login. Return the
 * reason instead of letting that happen.
 */
export function managedProfileEnvError(
  profile: AgentProfile | null | undefined,
): string | null {
  if (!profile?.managedPaths) return null;
  const variable = ISOLATION_ENV[profile.agent];
  if (!variable) return null;
  if (profileEnvWire(profile).some((entry) => entry.name === variable)) {
    return null;
  }
  return `"${profileLabel(profile)}" uses Agni-managed folders but none are resolved, so ${profile.agent} would start as the default account. Open Settings → Providers, edit and save this profile, then reopen the agent tab.`;
}

/** Extra launch args a profile needs (Hermes native profiles). */
export function profileExtraArgs(profile: AgentProfile): string[] {
  if (profile.agent === "hermes" && profile.hermesProfile?.trim()) {
    return ["-p", profile.hermesProfile.trim()];
  }
  return [];
}

/** The executable a custom ACP profile launches, if configured. */
export function profileCustomLaunch(
  profile: AgentProfile,
): { program: string; args: string[] } | null {
  if (profile.agent !== CUSTOM_AGENT_ID) return null;
  const program = profile.customProgram?.trim();
  if (!program) return null;
  return { program, args: profile.customArgs };
}

/** "Verified 2m ago" / "Not verified" for the profile card. */
export function profileVerifiedLabel(lastVerifiedAt: string | null): string {
  if (!lastVerifiedAt) return "Not verified";
  const elapsed = Date.now() - Date.parse(lastVerifiedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) return "Not verified";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Verified just now";
  if (minutes < 60) return `Verified ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Verified ${hours}h ago`;
  return `Verified ${Math.floor(hours / 24)}d ago`;
}

/** What the profile editor should show for each harness. */
export function profileIsolationHint(agent: string): {
  configLabel: string | null;
  dataLabel: string | null;
  note: string;
} {
  switch (agent) {
    case "claude":
      return {
        configLabel: "CLAUDE_CONFIG_DIR",
        dataLabel: null,
        note: "One config directory per account. Run `CLAUDE_CONFIG_DIR=… claude auth login` first.",
      };
    case "opencode":
      return {
        configLabel: "OPENCODE_CONFIG_DIR",
        dataLabel: "XDG data directory",
        note: "Auth lives in <data>/opencode. Sign in with the same XDG_DATA_HOME to keep accounts separate.",
      };
    case "kilo":
      return {
        configLabel: "OPENCODE_CONFIG_DIR",
        dataLabel: "XDG data directory",
        note: "Kilo is an OpenCode fork; these may not be honored. Experimental.",
      };
    case "hermes":
      return {
        configLabel: null,
        dataLabel: "HERMES_HOME",
        note: "Or use a native profile name below; Agni launches `hermes -p <name> acp`.",
      };
    case "pi":
      return {
        configLabel: "PI_CODING_AGENT_DIR",
        dataLabel: null,
        note: "The agent directory holds Pi auth and model settings.",
      };
    case "commandcode":
      return {
        configLabel: null,
        dataLabel: null,
        note: "Only API-key env (COMMAND_CODE_API_KEY) is isolated. OAuth needs a HOME override, which also moves tool config.",
      };
    case CUSTOM_AGENT_ID:
      return {
        configLabel: null,
        dataLabel: null,
        note: "Runs any ACP-compatible executable over stdio. Agni launches it directly, without a shell — only add commands you trust.",
      };
    default:
      return {
        configLabel: null,
        dataLabel: null,
        note: "Registry agents isolate through environment variables only.",
      };
  }
}

export function profileLabel(profile: AgentProfile): string {
  return profile.label.trim() || profile.agent;
}

export function defaultProfileFor(
  profiles: readonly AgentProfile[],
  agent: string,
  defaults: Record<string, string>,
): AgentProfile | null {
  const enabled = profiles.filter(
    (profile) => profile.enabled && profile.agent === agent,
  );
  const preferred = defaults[agent];
  return (
    enabled.find((profile) => profile.id === preferred) ?? enabled[0] ?? null
  );
}

const homeCache = new Map<string, Promise<string | null>>();

/** Cached home directory, for expanding `~` in terminal sign-in commands. */
export function homeDirectory(): Promise<string | null> {
  const cached = homeCache.get("home");
  if (cached) return cached;
  const request = invoke<string | null>("home_dir").catch(() => null);
  homeCache.set("home", request);
  return request;
}

export async function expandHome(path: string | null): Promise<string | null> {
  if (!path) return path;
  if (path === "~") return homeDirectory();
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    const home = await homeDirectory();
    return home ? `${home}${path.slice(1)}` : path;
  }
  return path;
}

/** Resolve literal + secret env values for terminal sign-in. */
export async function resolveProfileEnvWire(
  wire: readonly ProfileEnvWire[],
): Promise<{ name: string; value: string }[]> {
  const resolved: { name: string; value: string }[] = [];
  for (const variable of wire) {
    if (variable.value !== undefined) {
      const expanded = await expandHome(variable.value);
      resolved.push({ name: variable.name, value: expanded ?? variable.value });
      continue;
    }
    if (variable.secret) {
      try {
        const value = await invoke<string>("secret_get", {
          account: variable.secret,
        });
        resolved.push({ name: variable.name, value });
      } catch {
        // A missing secret is reported by the spawn path; sign-in can skip it.
      }
    }
  }
  return resolved;
}

export async function resolveProfileEnv(
  profile: AgentProfile,
): Promise<{ name: string; value: string }[]> {
  return resolveProfileEnvWire(profileEnvWire(profile));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
