import { createAcpClient } from "@/modules/acp-agent/session/client";
import {
  type AcpProbe,
  probeAcpAgent,
} from "@/modules/acp-agent/session/probe";
import type {
  AcpLaunchSpec,
  AcpSessionConfig,
} from "@/modules/acp-agent/types";
import { LOCAL_WORKSPACE } from "@/modules/workspace";
import {
  type AgentProfile,
  managedProfileEnvError,
  profileCustomLaunch,
  profileEnvWire,
  profileExtraArgs,
} from "./profile";

export type ProfileVerification = { ok: true } | { ok: false; error: string };

const VERIFY_TIMEOUT_MS = 20_000;

function withTimeout<T>(
  task: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([task, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** One config for probe, login, logout and verification. */
export function profileAcpConfig(
  profile: AgentProfile,
  cwd: string,
  launch?: AcpLaunchSpec | null,
): AcpSessionConfig {
  const custom = profileCustomLaunch(profile);
  const resolvedLaunch =
    launch ??
    (custom
      ? {
          program: custom.program,
          args: custom.args,
          env: [],
          managed: false,
          custom: true,
        }
      : undefined);
  return {
    agent: profile.agent,
    cwd,
    workspace: LOCAL_WORKSPACE,
    launch: resolvedLaunch ?? undefined,
    profileId: profile.id,
    profileEnv: profileEnvWire(profile),
    profileArgs: profileExtraArgs(profile),
    profileEnvError: managedProfileEnvError(profile),
  };
}

/** Auth methods and logout support advertised by the agent (T3's auth probe). */
export async function probeProfileAuth(
  profile: AgentProfile,
  cwd: string,
  launch?: AcpLaunchSpec | null,
): Promise<AcpProbe | null> {
  if (profile.agent === "pi") return null;
  return withTimeout(
    probeAcpAgent(profileAcpConfig(profile, cwd, launch)),
    20_000,
    "The harness did not report its sign-in methods in time.",
  );
}

/** Run one of the agent's advertised sign-in methods. */
export async function loginAgentProfile(
  profile: AgentProfile,
  methodId: string,
  cwd: string,
  launch?: AcpLaunchSpec | null,
): Promise<ProfileVerification> {
  const client = createAcpClient(profileAcpConfig(profile, cwd, launch));
  try {
    await withTimeout(
      client.ensureStarted(),
      20_000,
      "The harness did not start in time.",
    );
    await withTimeout(
      client.login(methodId),
      30_000,
      "Sign-in did not finish in time.",
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.dispose().catch(() => {});
  }
}

/** Sign out through the agent's ACP logout, when it advertises it. */
export async function logoutAgentProfile(
  profile: AgentProfile,
  cwd: string,
  launch?: AcpLaunchSpec | null,
): Promise<ProfileVerification> {
  const client = createAcpClient(profileAcpConfig(profile, cwd, launch));
  try {
    await withTimeout(
      client.ensureStarted(),
      20_000,
      "The harness did not start in time.",
    );
    await withTimeout(
      client.logout(),
      20_000,
      "Sign-out did not finish in time.",
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.dispose().catch(() => {});
  }
}

/**
 * T3-style sign-in verification: start the harness with the profile's
 * environment and create a real session. That proves the credentials the
 * login wrote are actually usable, instead of assuming the terminal command
 * succeeded.
 */
export async function verifyAgentProfile(
  profile: AgentProfile,
  cwd: string,
  launch?: AcpLaunchSpec | null,
): Promise<ProfileVerification> {
  if (profile.agent === "pi") {
    return {
      ok: false,
      error: "Pi manages its own auth; open a Pi session to check it.",
    };
  }
  const client = createAcpClient(profileAcpConfig(profile, cwd, launch));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Verification timed out after 20s")),
      VERIFY_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([client.ensureStarted(), timeout]);
    await Promise.race([client.newSession(), timeout]);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await client.dispose().catch(() => {});
  }
}
