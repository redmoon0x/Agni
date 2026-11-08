import { Add01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pickFile, pickFolder } from "@/lib/native";
import { acpAgent, isAcpAgentId } from "@/modules/acp-agent/lib/agent";
import { terminalAuthCommandForProgram } from "@/modules/acp-agent/terminalAuth";
import type { AcpAuthMethod, AcpLaunchSpec } from "@/modules/acp-agent/types";
import { AgentIcon } from "@/modules/agent-panel/AgentIcon";
import {
  type AccountProbe,
  probeProfileAccount,
} from "@/modules/agent-panel/lib/accountProbe";
import { PANEL_AGENTS } from "@/modules/agent-panel/lib/installedAgents";
import {
  type AgentProfile,
  CUSTOM_AGENT_ID,
  CUSTOM_AGENT_LABEL,
  defaultProfileFor,
  homeDirectory,
  managedProfileEnvError,
  newProfileId,
  type ProfileEnv,
  profileCustomLaunch,
  profileIsolationHint,
  profileVerifiedLabel,
  resolveProfileEnv,
  secretAccount,
} from "@/modules/agent-panel/lib/profile";
import {
  isProfileBusy,
  remoteProfileLocks,
} from "@/modules/agent-panel/lib/profileLock";
import { ensureProfileStorage } from "@/modules/agent-panel/lib/profileStorage";
import {
  loginAgentProfile,
  logoutAgentProfile,
  probeProfileAuth,
  verifyAgentProfile,
} from "@/modules/agent-panel/lib/verifyProfile";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setAgentDefaultProfile,
  setAgentProfiles,
} from "@/modules/settings/store";
import { runInDockTerminal } from "@/modules/terminal-dock/lib/dockBridge";
import { SectionHeader } from "../components/SectionHeader";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function blankProfile(agent: string): AgentProfile {
  return {
    id: newProfileId(),
    agent,
    label: "",
    enabled: true,
    environment: [],
    configDir: null,
    dataDir: null,
    hermesProfile: null,
    customProgram: null,
    customArgs: [],
    lastVerifiedAt: null,
    accountLabel: null,
    accountCheckedAt: null,
    managedPaths: true,
  };
}

export function ProfilesSection() {
  const profiles = usePreferencesStore((state) => state.agentProfiles);
  const defaults = usePreferencesStore((state) => state.agentDefaultProfile);
  const installed = usePreferencesStore((state) => state.installedAcpAgents);
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  const [draft, setDraft] = useState<AgentProfile | null>(null);
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [remoteLocks, setRemoteLocks] = useState<Record<string, number>>({});
  const [authChoice, setAuthChoice] = useState<{
    profile: AgentProfile;
    methods: AcpAuthMethod[];
    cwd: string;
    launch: AcpLaunchSpec | null;
  } | null>(null);

  // The lock is cross-window (Rust-owned) and not reactive; poll while open.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      refresh();
      void remoteProfileLocks().then((locks) => {
        if (!cancelled) setRemoteLocks(locks);
      });
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const busyFor = (profileId: string) =>
    (remoteLocks[profileId] ?? 0) > 0 || isProfileBusy(profileId);

  // New profiles default to Agni-owned folders; create them as soon as the
  // editor opens and show the real absolute paths.
  useEffect(() => {
    const current = draft;
    if (!current?.managedPaths) return;
    let cancelled = false;
    void ensureProfileStorage(current.id)
      .then((storage) => {
        if (cancelled) return;
        setDraft((prev) =>
          prev && prev.id === current.id
            ? {
                ...prev,
                configDir: storage.configDir,
                dataDir: storage.dataDir,
              }
            : prev,
        );
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            `Could not create the Agni profile folders: ${String(cause)}`,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [draft?.agent, draft?.id, draft?.managedPaths]);

  const agents = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of PANEL_AGENTS) map.set(agent.id, agent.label);
    map.set(CUSTOM_AGENT_ID, CUSTOM_AGENT_LABEL);
    for (const agent of installed) map.set(agent.id, agent.label);
    return [...map.entries()].map(([id, label]) => ({ id, label }));
  }, [installed]);

  const edit = (profile: AgentProfile) => {
    setDraft({
      ...profile,
      environment: profile.environment.map((entry) => ({ ...entry })),
    });
    setSecretDrafts({});
    setError(null);
  };

  const add = () => {
    const agent = agents[0]?.id ?? "opencode";
    setDraft(blankProfile(agent));
    setSecretDrafts({});
    setError(null);
  };

  const cwdForProfile = async () =>
    usePreferencesStore.getState().lastProjectRoot ??
    (await homeDirectory()) ??
    "";

  const launchForProfile = (profile: AgentProfile): AcpLaunchSpec | null => {
    const entry = installed.find((agent) => agent.id === profile.agent);
    return entry
      ? {
          program: entry.program,
          args: entry.args,
          env: entry.env,
          managed: entry.managed,
        }
      : null;
  };

  const markVerified = async (
    profileId: string,
    account?: AccountProbe | null,
  ) => {
    const latest = usePreferencesStore.getState().agentProfiles;
    const checkedAt = new Date().toISOString();
    await setAgentProfiles(
      latest.map((entry) =>
        entry.id === profileId
          ? {
              ...entry,
              lastVerifiedAt: checkedAt,
              accountLabel: account?.label ?? entry.accountLabel,
              accountCheckedAt: account ? checkedAt : entry.accountCheckedAt,
            }
          : entry,
      ),
    );
  };

  const clearVerified = async (profileId: string) => {
    const latest = usePreferencesStore.getState().agentProfiles;
    await setAgentProfiles(
      latest.map((entry) =>
        entry.id === profileId
          ? {
              ...entry,
              lastVerifiedAt: null,
              accountLabel: null,
              accountCheckedAt: null,
            }
          : entry,
      ),
    );
  };

  const checkAccount = async (profile: AgentProfile, cwd: string) =>
    probeProfileAccount(profile, cwd).catch(() => null);

  const startAcpLogin = async (
    profile: AgentProfile,
    method: AcpAuthMethod,
    cwd: string,
    launch: AcpLaunchSpec | null,
  ) => {
    setAuthChoice(null);
    setError(null);
    const result = await loginAgentProfile(
      profile,
      method.methodId,
      cwd,
      launch,
    );
    if (!result.ok) {
      setError(`${profile.label}: ${result.error}`);
      return;
    }
    if (method.type === "terminal") {
      toast.info(
        `${profile.label}: complete ${method.name} in the terminal, then press Verify.`,
      );
      return;
    }
    const verified = await verifyAgentProfile(profile, cwd, launch);
    if (verified.ok) {
      const account = await checkAccount(profile, cwd);
      await markVerified(profile.id, account);
      toast.success(
        `${profile.label} verified${account ? ` as ${account.label}` : ""} — sign-in works.`,
      );
    } else {
      setError(`${profile.label}: ${verified.error}`);
    }
  };

  const remove = async (profile: AgentProfile) => {
    if (busyFor(profile.id)) {
      setError("Stop this profile's sessions before removing it.");
      return;
    }
    for (const variable of profile.environment) {
      if (variable.value.kind === "secret") {
        await invoke("secret_delete", {
          account: variable.value.account,
        }).catch(() => {});
      }
    }
    const next = profiles.filter((entry) => entry.id !== profile.id);
    await setAgentProfiles(next);
    if (defaults[profile.agent] === profile.id) {
      const fallback = defaultProfileFor(next, profile.agent, {});
      await setAgentDefaultProfile(profile.agent, fallback?.id ?? null);
    }
    if (draft?.id === profile.id) setDraft(null);
  };

  const signIn = async (profile: AgentProfile) => {
    if (busyFor(profile.id)) {
      setError("Stop this profile's sessions before signing in again.");
      return;
    }
    setError(null);
    // Without the profile's env the login would write into the default
    // account, which is exactly the cross-account leak we must prevent.
    const isolation = managedProfileEnvError(profile);
    if (isolation) {
      setError(isolation);
      return;
    }
    const spec = signInSpec(profile);
    const cwd = await cwdForProfile();
    const launch = launchForProfile(profile);
    // Registry/custom agents (and built-ins without a known CLI) advertise
    // their own ACP sign-in methods; prefer those, like T3 does.
    const useAcp =
      profile.agent === CUSTOM_AGENT_ID ||
      installed.some((agent) => agent.id === profile.agent) ||
      !spec;
    if (profile.agent !== "pi" && useAcp) {
      try {
        const probe = await probeProfileAuth(profile, cwd, launch);
        // Credential/env methods are represented by the profile's environment
        // fields; only interactive ACP methods can be run from here.
        const methods = (probe?.authMethods ?? []).filter(
          (method) => method.type === "terminal" || method.type === "agent",
        );
        if (methods.length === 1) {
          await startAcpLogin(profile, methods[0], cwd, launch);
          return;
        }
        if (methods.length > 1) {
          setAuthChoice({ profile, methods, cwd, launch });
          return;
        }
      } catch {
        // Fall through to the known CLI command or the manual hint.
      }
    }
    if (!spec) {
      toast.info(
        "This harness has no known sign-in command. Run its login manually with the profile environment.",
      );
      return;
    }
    const env = await resolveProfileEnv(profile);
    const command = terminalAuthCommandForProgram(spec.program, spec.args, {
      methodId: "profile",
      type: "terminal",
      name: "Sign in",
      args: [],
      env,
    });
    const opened = await runInDockTerminal(command);
    if (!opened) {
      toast.error(
        "Could not open a terminal. Open a workspace, or close a dock pane and retry.",
      );
      return;
    }
    toast.info(
      "Sign-in opened in Agni's terminal. Complete it, then press Verify.",
    );
  };

  const verify = async (profile: AgentProfile) => {
    if (busyFor(profile.id)) {
      setError("Stop this profile's sessions before verifying it.");
      return;
    }
    setError(null);
    setVerifyingId(profile.id);
    const cwd = await cwdForProfile();
    const launch = launchForProfile(profile);
    const result = await verifyAgentProfile(profile, cwd, launch);
    setVerifyingId(null);
    if (result.ok) {
      const account = await checkAccount(profile, cwd);
      await markVerified(profile.id, account);
      toast.success(
        `${profile.label} verified${account ? ` as ${account.label}` : ""} — sign-in works.`,
      );
      return;
    }
    setError(`${profile.label}: ${result.error}`);
  };

  const signOut = async (profile: AgentProfile) => {
    if (busyFor(profile.id)) {
      setError("Stop this profile's sessions before signing out.");
      return;
    }
    const isolation = managedProfileEnvError(profile);
    if (isolation) {
      setError(isolation);
      return;
    }
    const cwd = await cwdForProfile();
    const launch = launchForProfile(profile);
    const spec = signOutSpec(profile);
    // Prefer the agent's ACP logout for registry/custom agents and for
    // built-ins that have no known CLI command.
    const useAcp =
      profile.agent === CUSTOM_AGENT_ID ||
      installed.some((agent) => agent.id === profile.agent) ||
      !spec;
    if (profile.agent !== "pi" && useAcp) {
      const probe = await probeProfileAuth(profile, cwd, launch).catch(
        () => null,
      );
      if (probe?.capabilities.authLogout) {
        const result = await logoutAgentProfile(profile, cwd, launch);
        if (result.ok) {
          await clearVerified(profile.id);
          toast.success(`${profile.label} signed out.`);
          return;
        }
      }
    }
    if (!spec) {
      toast.info(
        "This harness has no known sign-out command. Clear its login in its own CLI.",
      );
      return;
    }
    const env = await resolveProfileEnv(profile);
    const command = terminalAuthCommandForProgram(spec.program, spec.args, {
      methodId: "profile",
      type: "terminal",
      name: "Sign out",
      args: [],
      env,
    });
    const opened = await runInDockTerminal(command);
    if (!opened) {
      toast.error(
        "Could not open a terminal. Open a workspace, or close a dock pane and retry.",
      );
      return;
    }
    await clearVerified(profile.id);
    toast.info("Complete sign-out in the terminal.");
  };

  const save = async () => {
    if (!draft) return;
    setError(null);
    const label = draft.label.trim();
    if (!label) {
      setError("Give this profile a name.");
      return;
    }
    if (busyFor(draft.id)) {
      setError("Stop this profile's sessions before changing it.");
      return;
    }
    const isAbsoluteOrHome = (value: string) =>
      /^(?:[A-Za-z]:[\\/]|\/|\\\\|~[\\/]|~$)/.test(value);
    let configDir = draft.configDir?.trim() || null;
    let dataDir = draft.dataDir?.trim() || null;
    if (draft.managedPaths) {
      try {
        const storage = await ensureProfileStorage(draft.id);
        configDir = storage.configDir;
        dataDir = storage.dataDir;
      } catch (cause) {
        setError(`Could not create the Agni profile folders: ${String(cause)}`);
        return;
      }
    } else {
      for (const [name, value] of [
        ["Config directory", draft.configDir],
        ["Data directory", draft.dataDir],
      ] as const) {
        if (value?.trim() && !isAbsoluteOrHome(value.trim())) {
          setError(`${name} must be absolute or start with ~.`);
          return;
        }
      }
    }
    const names = new Set<string>();
    const environment: ProfileEnv[] = [];
    for (const variable of draft.environment) {
      const name = variable.name.trim();
      if (!ENV_NAME.test(name)) {
        setError(
          `"${variable.name}" is not a valid environment variable name.`,
        );
        return;
      }
      if (names.has(name)) {
        setError(`Environment variable ${name} is duplicated.`);
        return;
      }
      names.add(name);
      const sensitive = variable.sensitive === true;
      if (sensitive) {
        const typed = secretDrafts[name];
        const existing =
          variable.value.kind === "secret" ? variable.value.account : null;
        if (typed) {
          const account = secretAccount(draft.id, name);
          try {
            await invoke("secret_set", { account, value: typed });
          } catch (cause) {
            setError(`Could not save ${name}: ${String(cause)}`);
            return;
          }
          environment.push({
            name,
            value: { kind: "secret", account },
            sensitive: true,
          });
          continue;
        }
        if (!existing) {
          setError(`Enter a value for ${name} or mark it non-sensitive.`);
          return;
        }
        environment.push({
          name,
          value: { kind: "secret", account: existing },
          sensitive: true,
        });
      } else {
        // Unchecking Sensitive on a keychain value must not silently blank it:
        // read it once, store it as text, and drop the keychain entry.
        let textValue =
          variable.value.kind === "text" ? variable.value.value : "";
        if (variable.value.kind === "secret") {
          const typed = secretDrafts[name];
          if (typed !== undefined) {
            textValue = typed;
          } else {
            textValue = await invoke<string>("secret_get", {
              account: variable.value.account,
            }).catch(() => "");
          }
          await invoke("secret_delete", {
            account: variable.value.account,
          }).catch(() => {});
        }
        environment.push({
          name,
          value: { kind: "text", value: textValue },
        });
      }
    }
    for (const [name, value] of Object.entries(secretDrafts)) {
      if (value && !names.has(name)) {
        await invoke("secret_delete", {
          account: secretAccount(draft.id, name),
        }).catch(() => {});
      }
    }
    const customProgram =
      draft.agent === CUSTOM_AGENT_ID
        ? draft.customProgram?.trim() || null
        : null;
    if (draft.agent === CUSTOM_AGENT_ID && !customProgram) {
      setError("Choose the ACP executable for this custom harness.");
      return;
    }
    const customArgs =
      draft.agent === CUSTOM_AGENT_ID
        ? draft.customArgs
            .map((arg) => arg.trim())
            .filter(Boolean)
            .slice(0, 32)
        : [];
    if (
      customArgs.some(
        (arg) =>
          arg.length > 512 ||
          arg.includes("\0") ||
          arg.includes("\n") ||
          arg.includes("\r"),
      )
    ) {
      setError(
        "A custom ACP argument is too long or contains a control character.",
      );
      return;
    }
    const next: AgentProfile = {
      ...draft,
      label,
      environment,
      configDir,
      dataDir,
      hermesProfile: draft.hermesProfile?.trim() || null,
      customProgram,
      customArgs,
      managedPaths: draft.managedPaths,
      // Any configuration change invalidates the previous sign-in proof.
      lastVerifiedAt: null,
      accountLabel: null,
      accountCheckedAt: null,
    };
    const list = profiles.some((entry) => entry.id === next.id)
      ? profiles.map((entry) => (entry.id === next.id ? next : entry))
      : [...profiles, next];
    await setAgentProfiles(list);
    if (!defaults[next.agent]) {
      await setAgentDefaultProfile(next.agent, next.id);
    }
    setDraft(null);
    setSecretDrafts({});
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          title="Providers"
          description="One profile per account. Each profile isolates a harness with its own config directory and environment."
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1.5 px-2.5 text-[11px]"
          onClick={add}
        >
          <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={2} />
          Add profile
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11.5px] text-destructive">
          {error}
        </div>
      ) : null}

      {authChoice ? (
        <div className="rounded-lg border border-border/70 bg-card/50 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11.5px] font-medium">
                Sign in {authChoice.profile.label}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Choose a method advertised by the harness.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[10.5px]"
              onClick={() => setAuthChoice(null)}
            >
              Cancel
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {authChoice.methods.map((method) => (
              <Button
                key={method.methodId}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-[10.5px]"
                onClick={() =>
                  void startAcpLogin(
                    authChoice.profile,
                    method,
                    authChoice.cwd,
                    authChoice.launch,
                  )
                }
              >
                {method.name}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {profiles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center text-[12px] text-muted-foreground">
          No profiles yet. Add one to run two accounts of the same harness.
        </div>
      ) : (
        <div className="space-y-2">
          {[...profiles]
            .sort(
              (a, b) =>
                a.agent.localeCompare(b.agent) ||
                a.label.localeCompare(b.label),
            )
            .map((profile) => {
              const busy = busyFor(profile.id);
              const isDefault = defaults[profile.agent] === profile.id;
              const hint = profileIsolationHint(profile.agent);
              const custom = profileCustomLaunch(profile);
              const dirs = [
                profile.configDir &&
                  `${hint.configLabel ?? "config"} ${profile.configDir}`,
                profile.dataDir &&
                  `${hint.dataLabel ?? "data"} ${profile.dataDir}`,
                profile.hermesProfile && `profile ${profile.hermesProfile}`,
                custom &&
                  `${custom.program}${custom.args.length > 0 ? ` ${custom.args.join(" ")}` : ""}`,
              ].filter(Boolean);
              return (
                <div
                  key={profile.id}
                  className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/40 p-3"
                >
                  <AgentIcon agent={profile.agent} size={18} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[12.5px] font-medium">
                        {profile.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {agentLabel(profile.agent, installed)}
                      </span>
                      {isDefault ? <Badge>Default</Badge> : null}
                      {!profile.enabled ? <Badge>Disabled</Badge> : null}
                      {profile.managedPaths ? <Badge>Agni folder</Badge> : null}
                      {busy ? <Badge tone="primary">live</Badge> : null}
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {dirs.length > 0
                        ? dirs.join(" · ")
                        : "Uses the default harness configuration"}
                      {profile.environment.length > 0
                        ? ` · ${profile.environment.length} env`
                        : ""}
                    </p>
                    <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1 text-[9.5px]">
                      {profile.accountLabel ? (
                        <>
                          <span className="truncate font-medium text-foreground/80">
                            {profile.accountLabel}
                          </span>
                          <span className="text-muted-foreground/35">·</span>
                        </>
                      ) : null}
                      <span
                        className={
                          profile.lastVerifiedAt
                            ? "text-emerald-500"
                            : "text-muted-foreground/60"
                        }
                      >
                        {profileVerifiedLabel(profile.lastVerifiedAt)}
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    {!isDefault ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[10.5px]"
                        onClick={() =>
                          void setAgentDefaultProfile(profile.agent, profile.id)
                        }
                      >
                        Make default
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-[10.5px]"
                      onClick={() => void verify(profile)}
                      disabled={busy || verifyingId === profile.id}
                    >
                      {verifyingId === profile.id ? "Verifying…" : "Verify"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[10.5px]"
                      onClick={() => void signIn(profile)}
                    >
                      Sign in
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[10.5px]"
                      onClick={() => void signOut(profile)}
                    >
                      Sign out
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-[10.5px]"
                      onClick={() => edit(profile)}
                      disabled={busy}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[10.5px] text-destructive hover:text-destructive"
                      onClick={() => void remove(profile)}
                      disabled={busy}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {draft ? (
        <ProfileEditor
          draft={draft}
          agents={agents}
          secretDrafts={secretDrafts}
          setDraft={setDraft}
          setSecretDrafts={setSecretDrafts}
          onCancel={() => {
            setDraft(null);
            setSecretDrafts({});
          }}
          onSave={() => void save()}
        />
      ) : null}
    </div>
  );
}

function ProfileEditor({
  draft,
  agents,
  secretDrafts,
  setDraft,
  setSecretDrafts,
  onCancel,
  onSave,
}: {
  draft: AgentProfile;
  agents: { id: string; label: string }[];
  secretDrafts: Record<string, string>;
  setDraft: (profile: AgentProfile) => void;
  setSecretDrafts: (
    update: (current: Record<string, string>) => Record<string, string>,
  ) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const hint = profileIsolationHint(draft.agent);
  const update = (patch: Partial<AgentProfile>) =>
    setDraft({ ...draft, ...patch });
  const browse = async (field: "configDir" | "dataDir") => {
    const picked = await pickFolder(
      field === "configDir"
        ? "Choose config directory"
        : "Choose data directory",
      draft[field] ?? undefined,
    ).catch(() => null);
    if (picked) update({ [field]: picked });
  };
  const browseFile = async () => {
    const picked = await pickFile(
      "Choose ACP executable",
      draft.customProgram ?? undefined,
    ).catch(() => null);
    if (picked) update({ customProgram: picked });
  };
  const updateEnv = (index: number, patch: Partial<ProfileEnv>) => {
    const environment = draft.environment.map((entry, position) =>
      position === index ? { ...entry, ...patch } : entry,
    );
    update({ environment });
  };

  return (
    <div className="space-y-4 rounded-lg border border-border/70 bg-card/50 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[12px] font-medium">
          {draft.label ? "Edit profile" : "New profile"}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[10px]"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-[11px]">Harness</Label>
          <select
            value={draft.agent}
            onChange={(event) => update({ agent: event.target.value })}
            className="h-9 w-full rounded-md border border-border/70 bg-background px-2 text-[12px]"
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px]">Name</Label>
          <Input
            value={draft.label}
            onChange={(event) => update({ label: event.target.value })}
            placeholder="OpenCode — Work"
            className="h-9 text-[12px]"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) => update({ enabled: event.target.checked })}
        />
        Enabled — show this profile in the Agents list
      </label>

      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={draft.managedPaths}
          onChange={(event) => update({ managedPaths: event.target.checked })}
        />
        Use Agni-managed folders (recommended)
      </label>

      {draft.managedPaths ? (
        <div className="space-y-1.5">
          <div className="rounded-md border border-border/60 bg-background/60 px-2.5 py-2 font-mono text-[10px] text-muted-foreground">
            <p className="truncate">config: {draft.configDir ?? "creating…"}</p>
            <p className="truncate">data: {draft.dataDir ?? "creating…"}</p>
          </div>
          <p className="text-[10px] text-muted-foreground/70">
            Agni creates <code>~/.agni/profiles/{draft.id}/</code>{" "}
            automatically. Uncheck to use custom folders.
          </p>
        </div>
      ) : null}

      <p className="text-[10.5px] text-muted-foreground">{hint.note}</p>

      {!draft.managedPaths && hint.configLabel ? (
        <div className="space-y-1.5">
          <Label className="text-[11px]">{hint.configLabel}</Label>
          <div className="flex gap-1.5">
            <Input
              value={draft.configDir ?? ""}
              onChange={(event) => update({ configDir: event.target.value })}
              placeholder="C:\\Users\\you\\.config\\opencode-work"
              className="h-9 min-w-0 flex-1 font-mono text-[11px]"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0 px-2.5 text-[10.5px]"
              onClick={() => void browse("configDir")}
            >
              Browse
            </Button>
          </div>
        </div>
      ) : null}

      {!draft.managedPaths && hint.dataLabel ? (
        <div className="space-y-1.5">
          <Label className="text-[11px]">{hint.dataLabel}</Label>
          <div className="flex gap-1.5">
            <Input
              value={draft.dataDir ?? ""}
              onChange={(event) => update({ dataDir: event.target.value })}
              placeholder="C:\\Users\\you\\AppData\\Local\\opencode-work"
              className="h-9 min-w-0 flex-1 font-mono text-[11px]"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0 px-2.5 text-[10.5px]"
              onClick={() => void browse("dataDir")}
            >
              Browse
            </Button>
          </div>
        </div>
      ) : null}

      {!draft.managedPaths ? (
        <p className="text-[10px] text-muted-foreground/70">
          Paths may start with <code>~</code>; Agni expands them when launching.
        </p>
      ) : null}

      {draft.agent === "hermes" ? (
        <div className="space-y-1.5">
          <Label className="text-[11px]">Hermes profile name</Label>
          <Input
            value={draft.hermesProfile ?? ""}
            onChange={(event) => update({ hermesProfile: event.target.value })}
            placeholder="work"
            className="h-9 text-[11px]"
          />
          <p className="text-[10px] text-muted-foreground">
            Launches <code>hermes -p &lt;name&gt; acp</code>.
          </p>
        </div>
      ) : null}

      {draft.agent === CUSTOM_AGENT_ID ? (
        <>
          <div className="space-y-1.5">
            <Label className="text-[11px]">ACP executable</Label>
            <div className="flex gap-1.5">
              <Input
                value={draft.customProgram ?? ""}
                onChange={(event) =>
                  update({ customProgram: event.target.value })
                }
                placeholder="npx or C:\\tools\\my-agent.exe"
                className="h-9 min-w-0 flex-1 font-mono text-[11px]"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0 px-2.5 text-[10.5px]"
                onClick={() => void browseFile()}
              >
                Browse
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px]">Arguments (one per line)</Label>
            <textarea
              value={draft.customArgs.join("\n")}
              onChange={(event) =>
                update({ customArgs: event.target.value.split("\n") })
              }
              rows={3}
              placeholder={"@scope/agent\n--acp"}
              className="w-full resize-y rounded-md border border-border/70 bg-background px-2 py-1.5 font-mono text-[11px] outline-none"
            />
            <p className="text-[10px] text-muted-foreground">
              Launched directly, without a shell. Use environment variables
              below for credentials.
            </p>
          </div>
        </>
      ) : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[11px]">Environment</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[10px]"
            onClick={() =>
              update({
                environment: [
                  ...draft.environment,
                  { name: "", value: { kind: "text", value: "" } },
                ],
              })
            }
          >
            + Variable
          </Button>
        </div>
        {draft.environment.length === 0 ? (
          <p className="text-[10.5px] text-muted-foreground">
            No variables. Isolation directories above are applied automatically.
          </p>
        ) : (
          <div className="space-y-1.5">
            {draft.environment.map((variable, index) => {
              const stored =
                variable.value.kind === "secret" &&
                !secretDrafts[variable.name];
              return (
                <div key={index} className="flex items-center gap-1.5">
                  <Input
                    value={variable.name}
                    onChange={(event) =>
                      updateEnv(index, { name: event.target.value })
                    }
                    placeholder="ANTHROPIC_API_KEY"
                    className="h-8 w-52 font-mono text-[10.5px]"
                  />
                  <Input
                    value={
                      secretDrafts[variable.name] ??
                      (stored
                        ? ""
                        : variable.value.kind === "text"
                          ? variable.value.value
                          : "")
                    }
                    onChange={(event) =>
                      setSecretDrafts((current) => ({
                        ...current,
                        [variable.name]: event.target.value,
                      }))
                    }
                    placeholder={stored ? "Stored in keychain" : "Value"}
                    type={variable.sensitive ? "password" : "text"}
                    className="h-8 min-w-0 flex-1 font-mono text-[10.5px]"
                  />
                  <label className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={variable.sensitive === true}
                      onChange={(event) =>
                        updateEnv(index, { sensitive: event.target.checked })
                      }
                    />
                    Sensitive
                  </label>
                  <button
                    type="button"
                    aria-label="Remove variable"
                    onClick={() =>
                      update({
                        environment: draft.environment.filter(
                          (_, position) => position !== index,
                        ),
                      })
                    }
                    className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                  >
                    <HugeiconsIcon
                      icon={Cancel01Icon}
                      size={11}
                      strokeWidth={2}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-[11px]"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8 text-[11px]"
          onClick={onSave}
        >
          Save profile
        </Button>
      </div>
    </div>
  );
}

function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "primary";
}) {
  return (
    <span
      className={
        tone === "primary"
          ? "rounded-sm bg-primary/15 px-1 py-0.5 text-[9px] text-primary uppercase"
          : "rounded-sm bg-foreground/[0.07] px-1 py-0.5 text-[9px] text-muted-foreground uppercase"
      }
    >
      {children}
    </span>
  );
}

function agentLabel(
  agent: string,
  installed: { id: string; label: string }[],
): string {
  return (
    installed.find((entry) => entry.id === agent)?.label ??
    PANEL_AGENTS.find((entry) => entry.id === agent)?.label ??
    agent
  );
}

function signInSpec(
  profile: AgentProfile,
): { program: string; args: string[] } | null {
  if (isAcpAgentId(profile.agent)) {
    const descriptor = acpAgent(profile.agent);
    const args: Record<string, string[]> = {
      claude: ["auth", "login"],
      opencode: ["auth", "login"],
      kilo: ["auth", "login"],
      commandcode: ["login"],
    };
    const resolved = args[profile.agent];
    return resolved
      ? { program: descriptor.probeProgram, args: resolved }
      : null;
  }
  if (profile.agent === "pi") return { program: "pi", args: ["auth"] };
  return null;
}

function signOutSpec(
  profile: AgentProfile,
): { program: string; args: string[] } | null {
  if (!isAcpAgentId(profile.agent)) return null;
  const descriptor = acpAgent(profile.agent);
  const args: Record<string, string[]> = {
    claude: ["auth", "logout"],
    opencode: ["auth", "logout"],
    kilo: ["auth", "logout"],
    commandcode: ["logout"],
  };
  const resolved = args[profile.agent];
  return resolved ? { program: descriptor.probeProgram, args: resolved } : null;
}
