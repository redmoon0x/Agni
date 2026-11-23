import type {
  AcpLaunchSpec,
  AcpSessionConfig,
} from "@/modules/acp-agent/types";
import type { InstalledAcpAgent } from "@/modules/acp-agent/registry";
import {
  defaultProfileFor,
  profileCustomLaunch,
  profileEnvWire,
  profileExtraArgs,
  managedProfileEnvError,
  type AgentProfile,
} from "@/modules/agent-panel/lib/profile";
import type { AgentId } from "@/modules/settings/store";
import type { WorkspaceEnv } from "@/modules/workspace";

export type AgentLaunchInput = {
  agent: AgentId;
  profileId: string | null;
  installed: readonly InstalledAcpAgent[];
  profiles: readonly AgentProfile[];
  defaults: Record<string, string>;
};

export type ResolvedAgentLaunch = {
  profile: AgentProfile | null;
  /** Built-ins resolve their program in Rust, so `null` is a valid launch. */
  launch: AcpLaunchSpec | null;
};

/**
 * One resolution for every entry point that starts a harness: the session
 * panel, the picker's model probe, and profile verification.
 */
export function resolveAgentLaunch(input: AgentLaunchInput): ResolvedAgentLaunch {
  const profile = input.profileId
    ? (input.profiles.find((entry) => entry.id === input.profileId) ?? null)
    : defaultProfileFor(input.profiles, input.agent, input.defaults);

  const custom = profile ? profileCustomLaunch(profile) : null;
  if (custom) {
    return {
      profile,
      launch: {
        program: custom.program,
        args: custom.args,
        env: [],
        managed: false,
        custom: true,
      },
    };
  }

  const devLaunch: AcpLaunchSpec | null =
    import.meta.env.DEV && input.agent === "dev-replay"
      ? {
          program: "node",
          args: ["scripts/dev-replay-agent.mjs"],
          env: [],
          managed: false,
        }
      : null;
  const stored = input.installed.find((agent) => agent.id === input.agent) ?? null;

  return {
    profile,
    launch:
      devLaunch ??
      (stored
        ? {
            program: stored.program,
            args: stored.args,
            env: stored.env,
            managed: stored.managed,
          }
        : null),
  };
}

/** The exact config a tab and its probe share for one harness account. */
export function agentSessionConfig(input: {
  agent: AgentId;
  cwd: string | null;
  workspace: WorkspaceEnv;
  initialModel?: string | null;
  installed: readonly InstalledAcpAgent[];
  profiles: readonly AgentProfile[];
  defaults: Record<string, string>;
  profileId: string | null;
}): AcpSessionConfig {
  const { profile, launch } = resolveAgentLaunch({
    agent: input.agent,
    profileId: input.profileId,
    installed: input.installed,
    profiles: input.profiles,
    defaults: input.defaults,
  });
  return {
    agent: input.agent,
    cwd: input.cwd ?? "",
    workspace: input.workspace,
    launch: launch ?? undefined,
    initialModel: input.initialModel ?? null,
    profileId: profile?.id ?? null,
    profileEnv: profile ? profileEnvWire(profile) : undefined,
    profileArgs: profile ? profileExtraArgs(profile) : undefined,
    profileEnvError: managedProfileEnvError(profile),
  };
}