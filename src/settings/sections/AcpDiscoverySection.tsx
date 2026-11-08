import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CheckmarkCircle01Icon,
  LinkSquare02Icon,
  Loading03Icon,
  Refresh01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useState } from "react";
import { IS_WINDOWS } from "@/lib/platform";
import { workspaceCurrentDir } from "@/lib/native";
import {
  type AcpProbe,
  probeAcpAgent,
} from "@/modules/acp-agent/session/probe";
import {
  type AcpRegistryAgent,
  type InstalledAcpAgent,
  installAcpRegistryAgent,
  listAcpRegistry,
  listInstalledAcpAgents,
  uninstallAcpRegistryAgent,
} from "@/modules/acp-agent/registry";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setInstalledAcpAgents } from "@/modules/settings/store";
import { SectionHeader } from "../components/SectionHeader";

const REGISTRY_PAGE_URL =
  "https://agentclientprotocol.com/get-started/registry";

type ProbeState = AcpProbe | { error: string };

function probeCwd(): Promise<string> {
  return workspaceCurrentDir().catch(() => (IS_WINDOWS ? "C:\\" : "/"));
}

export function AcpDiscoverySection() {
  const [agents, setAgents] = useState<AcpRegistryAgent[]>([]);
  const [installed, setInstalled] = useState<InstalledAcpAgent[]>([]);
  const [registryVersion, setRegistryVersion] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, ProbeState>>({});

  const installedIds = useMemo(
    () => new Set(installed.map((agent) => agent.id)),
    [installed],
  );

  const loadRegistry = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [registry, listed] = await Promise.all([
        listAcpRegistry(),
        listInstalledAcpAgents().catch(() => []),
      ]);
      setAgents(registry.agents);
      setRegistryVersion(registry.version);
      setInstalled(listed);
      if (listed.length > 0) await setInstalledAcpAgents(listed);
      else if (usePreferencesStore.getState().installedAcpAgents.length === 0) {
        await setInstalledAcpAgents([]);
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load the ACP Registry.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRegistry();
  }, [loadRegistry]);

  const filteredAgents = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return agents;
    return agents.filter((agent) =>
      [agent.name, agent.id, agent.description, ...agent.authors]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [agents, query]);

  const probe = async (agent: InstalledAcpAgent) => {
    setProbes((current) => {
      const next = { ...current };
      delete next[agent.id];
      return next;
    });
    try {
      const cwd = await probeCwd();
      const result = await probeAcpAgent({
        agent: agent.id,
        cwd,
        workspace: { kind: "local" },
        launch: {
          program: agent.program,
          args: agent.args,
          env: agent.env,
          managed: agent.managed,
        },
      });
      setProbes((current) => ({ ...current, [agent.id]: result }));
    } catch (cause) {
      setProbes((current) => ({
        ...current,
        [agent.id]: {
          error: cause instanceof Error ? cause.message : String(cause),
        },
      }));
    }
  };

  const install = async (agent: AcpRegistryAgent) => {
    setBusyId(agent.id);
    setError(null);
    try {
      const result = await installAcpRegistryAgent(agent);
      const next = [
        ...installed.filter((entry) => entry.id !== result.id),
        result,
      ];
      setInstalled(next);
      await setInstalledAcpAgents(next);
      await probe(result);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not install the agent.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const uninstall = async (agent: InstalledAcpAgent) => {
    setBusyId(agent.id);
    setError(null);
    try {
      await uninstallAcpRegistryAgent(agent.id);
      const next = installed.filter((entry) => entry.id !== agent.id);
      setInstalled(next);
      await setInstalledAcpAgents(next);
      setProbes((current) => {
        const copy = { ...current };
        delete copy[agent.id];
        return copy;
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not remove the agent.",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          title="ACP Discovery"
          description="Install ACP-compatible agents from the official registry."
        />
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1.5 px-2.5 text-[11px]"
          onClick={() => void loadRegistry()}
          disabled={loading}
        >
          <HugeiconsIcon icon={Refresh01Icon} size={12} strokeWidth={2} />
          Refresh
        </Button>
      </div>

      <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-[11.5px] text-muted-foreground">
        Installs are user-initiated. Binary downloads must match a published
        SHA-256 and are extracted only inside Agni's app-data directory. npx and
        uvx agents run through their package runner.
      </div>

      <div className="flex items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <HugeiconsIcon
            icon={Search01Icon}
            size={14}
            strokeWidth={2}
            className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search ACP agents..."
            className="h-9 pl-9 text-[12.5px]"
            disabled={loading}
          />
        </div>
        {registryVersion ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            Registry {registryVersion}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11.5px] text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              // Skeleton tiles are positional and never reorder.
              key={`skeleton-${index}`}
              className="h-43 animate-pulse rounded-lg border border-border/50 bg-muted/30"
            />
          ))}
        </div>
      ) : filteredAgents.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filteredAgents.map((agent) => {
            const entry = installed.find((item) => item.id === agent.id) ?? null;
            return (
              <AgentCard
                key={agent.id}
                agent={agent}
                installed={entry}
                installedIds={installedIds}
                busy={busyId === agent.id}
                probeState={entry ? probes[entry.id] : undefined}
                onInstall={() => void install(agent)}
                onUninstall={() => entry && void uninstall(entry)}
                onProbe={() => entry && void probe(entry)}
              />
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border/70 px-4 py-10 text-center text-[12px] text-muted-foreground">
          No ACP agents match this search.
        </div>
      )}

      <button
        type="button"
        className="self-start text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        onClick={() => void openUrl(REGISTRY_PAGE_URL)}
      >
        Learn about the ACP Registry
      </button>
    </div>
  );
}

function AgentCard({
  agent,
  installed,
  installedIds,
  busy,
  probeState,
  onInstall,
  onUninstall,
  onProbe,
}: {
  agent: AcpRegistryAgent;
  installed: InstalledAcpAgent | null;
  installedIds: Set<string>;
  busy: boolean;
  probeState: ProbeState | undefined;
  onInstall: () => void;
  onUninstall: () => void;
  onProbe: () => void;
}) {
  const detailUrl = agent.website ?? agent.repository;
  const installable =
    agent.distribution.install !== null ||
    agent.distribution.download !== null;
  const kindLabel =
    agent.distribution.kind === "npx"
      ? "npx"
      : agent.distribution.kind === "binary"
        ? "binary"
        : agent.distribution.kind === "uvx"
          ? "uvx"
          : "manual";

  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-lg border border-border/60 bg-card/40 p-3.5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 truncate text-[13px] font-medium">
            {agent.name}
            {installedIds.has(agent.id) ? (
              <HugeiconsIcon
                icon={CheckmarkCircle01Icon}
                size={12}
                strokeWidth={1.9}
                className="shrink-0 text-primary"
              />
            ) : null}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {agent.id} · {agent.version}
          </p>
        </div>
        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
          {kindLabel}
        </Badge>
      </div>

      <p className="line-clamp-3 min-h-11 text-[11.5px] leading-4 text-muted-foreground">
        {agent.description || "No description provided."}
      </p>

      {probeState ? <ProbeSummary state={probeState} /> : null}

      <div className="flex items-center justify-between gap-3 pt-0.5">
        <span className="truncate text-[10.5px] text-muted-foreground">
          {agent.authors[0] ?? agent.license ?? "ACP Registry"}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {installed ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[10.5px] text-muted-foreground hover:text-foreground"
                onClick={onProbe}
                disabled={busy}
              >
                Probe
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[10.5px]"
                onClick={onUninstall}
                disabled={busy}
              >
                Remove
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              className="h-6 gap-1 px-2 text-[10.5px]"
              onClick={onInstall}
              disabled={busy || !installable}
              title={installable ? undefined : "No installable distribution"}
            >
              {busy ? (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={11}
                  strokeWidth={2}
                  className="animate-spin"
                />
              ) : null}
              Install
            </Button>
          )}
          {detailUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[10.5px] text-muted-foreground hover:text-foreground"
              onClick={() => void openUrl(detailUrl)}
            >
              Details
              <HugeiconsIcon
                icon={LinkSquare02Icon}
                size={11}
                strokeWidth={1.8}
              />
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ProbeSummary({ state }: { state: ProbeState }) {
  if ("error" in state) {
    return (
      <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-[10.5px] text-destructive">
        Probe failed: {state.error}
      </p>
    );
  }
  const auth = state.authMethods.map((method) => method.name).join(", ");
  const models = state.models.length;
  const modes = state.modes?.availableModes.length ?? 0;
  return (
    <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
      <span className="rounded-sm bg-foreground/[0.06] px-1.5 py-0.5">
        {modes} modes
      </span>
      <span className="rounded-sm bg-foreground/[0.06] px-1.5 py-0.5">
        {models} models
      </span>
      <span className="rounded-sm bg-foreground/[0.06] px-1.5 py-0.5">
        {state.commands.length} commands
      </span>
      {auth ? (
        <span className="rounded-sm bg-foreground/[0.06] px-1.5 py-0.5">
          auth: {auth}
        </span>
      ) : null}
    </div>
  );
}
