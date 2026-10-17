import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type AcpRegistryAgent,
  listAcpRegistry,
} from "@/modules/acp-agent/registry";
import {
  CheckmarkCircle01Icon,
  Copy01Icon,
  LinkSquare02Icon,
  Refresh01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

const REGISTRY_PAGE_URL =
  "https://agentclientprotocol.com/get-started/registry";

export function AcpDiscoverySection() {
  const [agents, setAgents] = useState<AcpRegistryAgent[]>([]);
  const [registryVersion, setRegistryVersion] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadRegistry = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const registry = await listAcpRegistry();
      setAgents(registry.agents);
      setRegistryVersion(registry.version);
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

  const copyCommand = async (agent: AcpRegistryAgent) => {
    if (!agent.distribution.installCommand || !navigator.clipboard?.writeText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(agent.distribution.installCommand);
      setCopiedId(agent.id);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      setError("Could not copy the setup command.");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          title="ACP Discovery"
          description="Browse ACP-compatible agents from the official registry."
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
        Setup commands are shown for review and copied only when you choose
        them. Agni does not download, install, or run registry agents from this
        panel.
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
              key={index}
              className="h-43 animate-pulse rounded-lg border border-border/50 bg-muted/30"
            />
          ))}
        </div>
      ) : filteredAgents.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filteredAgents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              copied={copiedId === agent.id}
              onCopy={() => void copyCommand(agent)}
            />
          ))}
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
  copied,
  onCopy,
}: {
  agent: AcpRegistryAgent;
  copied: boolean;
  onCopy: () => void;
}) {
  const detailUrl = agent.website ?? agent.repository;
  const installCommand = agent.distribution.installCommand;
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-lg border border-border/60 bg-card/40 p-3.5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-medium">{agent.name}</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {agent.id} · {agent.version}
          </p>
        </div>
        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
          {agent.distribution.kind === "npx"
            ? "npx"
            : agent.distribution.kind === "binary"
              ? "binary"
              : "manual"}
        </Badge>
      </div>

      <p className="line-clamp-3 min-h-11 text-[11.5px] leading-4 text-muted-foreground">
        {agent.description || "No description provided."}
      </p>

      {installCommand ? (
        <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border/50 bg-muted/35 px-2 py-1.5">
          <code className="min-w-0 flex-1 truncate text-[10.5px]">
            {installCommand}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
            title="Copy setup command"
            onClick={onCopy}
          >
            <HugeiconsIcon
              icon={copied ? CheckmarkCircle01Icon : Copy01Icon}
              size={12}
              strokeWidth={1.9}
            />
          </Button>
        </div>
      ) : (
        <p className="text-[10.5px] text-muted-foreground">
          Review this agent's distribution and setup instructions before use.
        </p>
      )}

      <div className="flex items-center justify-between gap-3 pt-0.5">
        <span className="truncate text-[10.5px] text-muted-foreground">
          {agent.authors[0] ?? agent.license ?? "ACP Registry"}
        </span>
        {detailUrl ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 gap-1 px-1.5 text-[10.5px] text-muted-foreground hover:text-foreground"
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
    </article>
  );
}
