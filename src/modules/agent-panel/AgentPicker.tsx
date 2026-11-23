import {
  ArrowRight01Icon,
  ChevronDown,
  Loading03Icon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { probeAcpAgent } from "@/modules/acp-agent/session/probe";
import { AgentIcon } from "@/modules/agent-panel/AgentIcon";
import {
  type AddableRow,
  buildAddableRows,
} from "@/modules/agent-panel/lib/addable";
import {
  agentLabel,
  useAvailableAgents,
} from "@/modules/agent-panel/lib/installedAgents";
import { agentSessionConfig } from "@/modules/agent-panel/lib/launch";
import {
  type CatalogModel,
  isModelCatalogFresh,
  modelCatalogKey,
} from "@/modules/agent-panel/lib/modelCatalog";
import {
  filterAgentRows,
  filterCatalogModels,
  groupCatalogModels,
  type ModelCostFilter,
  modelIsFree,
  pickerJumpIndex,
  pickerJumpLabel,
} from "@/modules/agent-panel/lib/picker";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { type AgentId, setAgentModelCatalog } from "@/modules/settings/store";
import type { AgentTab } from "@/modules/tabs/lib/useTabs";
import type { WorkspaceEnv } from "@/modules/workspace";

export type AgentPickerProps = {
  workspace: WorkspaceEnv;
  cwd: string | null;
  /** Open sessions, so a row can focus instead of starting a duplicate. */
  tabs: readonly AgentTab[];
  /** Session identity when the trigger belongs to a live panel. */
  agent?: AgentId;
  profileId?: string | null;
  /** The live session's models, when it has reported them. */
  models?: readonly CatalogModel[];
  modelId?: string | null;
  onSelectModel?: (modelId: string) => void;
  /** Replace this session's harness account (same agent, other account). */
  onSwitchProfile?: (profileId: string) => void;
  onOpenAgent: (
    agent: AgentId,
    profileId: string | null,
    modelId?: string | null,
  ) => void;
  onActivateTab?: (id: number) => void;
  /**
   * Start a new thread on another harness with a handoff prompt, instead of
   * focusing this session. Used by the composer's "spin up" action.
   */
  onSpawnAgent?: (
    agent: AgentId,
    profileId: string | null,
    modelId: string | null,
    prompt: string,
  ) => void;
  /** The prompt to hand off when `onSpawnAgent` is set. */
  spawnPrompt?: string;
  /** Overrides the trigger text (e.g. "Spin up"). */
  triggerLabel?: string;
  /** Composer triggers lead with the model; header triggers lead with the harness. */
  emphasis?: "agent" | "model";
  side?: "top" | "bottom";
  align?: "start" | "end";
  className?: string;
  /** Bumped by "New session" to open this picker. */
  openRequest?: number;
};

/** Probes launch a harness: one per account in flight, failures back off. */
const probeInFlight = new Set<string>();
const probeRetriedAt = new Map<string, number>();
const PROBE_RETRY_MS = 60_000;

export function AgentPicker(props: AgentPickerProps) {
  const [open, setOpen] = useState(false);
  const { openRequest } = props;

  useEffect(() => {
    if (openRequest === undefined || openRequest === 0) return;
    setOpen(true);
  }, [openRequest]);

  const close = useCallback(() => setOpen(false), []);
  const activeModelName = props.models?.find(
    (model) => model.id === props.modelId,
  )?.name;
  const triggerLabel =
    props.triggerLabel ??
    (props.emphasis === "agent"
      ? props.agent
        ? agentLabel(props.agent)
        : "Agents"
      : (activeModelName ?? props.modelId ?? "Choose model"));
  const triggerTitle =
    props.emphasis === "agent"
      ? props.modelId
        ? `${props.agent ? agentLabel(props.agent) : "Agent"} · ${props.modelId}`
        : props.agent
          ? agentLabel(props.agent)
          : "Agents"
      : props.agent
        ? agentLabel(props.agent)
        : "Agent";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-agent-picker={props.emphasis ?? "agent"}
          title={triggerTitle}
          className={cn(
            "flex min-w-0 max-w-48 items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground",
            props.className,
          )}
        >
          {props.agent ? (
            <AgentIcon
              agent={props.agent}
              size={12}
              className="shrink-0 opacity-80"
            />
          ) : null}
          <span className="min-w-0 truncate">{triggerLabel}</span>
          <HugeiconsIcon
            icon={ChevronDown}
            size={11}
            strokeWidth={1.8}
            className="shrink-0 opacity-60"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={props.side ?? "top"}
        align={props.align ?? "end"}
        sideOffset={6}
        collisionPadding={8}
        className="w-[34rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl p-0"
      >
        <AgentPickerPanel {...props} onClose={close} />
      </PopoverContent>
    </Popover>
  );
}

type PanelProps = AgentPickerProps & { onClose?: () => void };

/** The picker body: harnesses on the left, the highlighted harness's models right. */
export function AgentPickerPanel({
  workspace,
  cwd,
  tabs,
  agent,
  profileId,
  models: liveModels,
  modelId,
  onSelectModel,
  onSwitchProfile,
  onOpenAgent,
  onActivateTab,
  onSpawnAgent,
  spawnPrompt,
  emphasis,
  onClose,
  className,
}: PanelProps) {
  const available = useAvailableAgents(workspace);
  const profiles = usePreferencesStore((state) => state.agentProfiles);
  const profileDefaults = usePreferencesStore(
    (state) => state.agentDefaultProfile,
  );
  const installed = usePreferencesStore((state) => state.installedAcpAgents);
  const catalog = usePreferencesStore((state) => state.agentModelCatalog);
  const preferred = usePreferencesStore((state) => state.agentModel);

  const [agentQuery, setAgentQuery] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [costFilter, setCostFilter] = useState<ModelCostFilter>("all");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState(0);
  const [probing, setProbing] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(
    () => buildAddableRows(available, profiles, tabs),
    [available, profiles, tabs],
  );
  const currentRowKey =
    rows.find(
      (row) =>
        row.agent === agent &&
        (row.profileId ?? null) === (profileId ?? null) &&
        row.open,
    )?.key ?? null;
  const filteredRows = useMemo(
    () => filterAgentRows(rows, agentQuery),
    [rows, agentQuery],
  );
  const row =
    filteredRows.find((entry) => entry.key === activeKey) ??
    filteredRows.find((entry) => entry.key === currentRowKey) ??
    filteredRows[0] ??
    null;

  const liveRow =
    row !== null &&
    row.agent === agent &&
    (row.profileId ?? null) === (profileId ?? null);
  const catalogKey = row ? modelCatalogKey(row.agent, row.profileId) : null;
  const rowModels =
    liveRow && liveModels
      ? [...liveModels]
      : catalogKey !== null
        ? (catalog[catalogKey]?.models ?? [])
        : [];
  const models = useMemo(
    () => filterCatalogModels(rowModels, modelQuery, costFilter),
    [rowModels, modelQuery, costFilter],
  );
  const groups = useMemo(() => groupCatalogModels(models), [models]);

  useEffect(() => {
    (emphasis === "model" ? modelSearchRef : searchRef).current?.focus();
  }, [emphasis]);

  // Fill the models column for a harness the user has not opened yet.
  useEffect(() => {
    if (!row || liveRow || !catalogKey) return;
    if (row.agent === "pi") return;
    if (isModelCatalogFresh(catalog[catalogKey])) return;
    if (probeInFlight.has(catalogKey)) return;
    const retriedAt = probeRetriedAt.get(catalogKey);
    if (retriedAt !== undefined && Date.now() - retriedAt < PROBE_RETRY_MS)
      return;
    const profile =
      profiles.find((entry) => entry.id === row.profileId) ?? null;
    if (profile?.managedPaths && !profile.configDir) return;

    probeInFlight.add(catalogKey);
    setProbing(catalogKey);
    const config = agentSessionConfig({
      agent: row.agent,
      cwd,
      workspace,
      profileId: row.profileId,
      installed,
      profiles,
      defaults: profileDefaults,
    });
    void probeAcpAgent(config)
      .then((result) => {
        if (result.models.length === 0) return;
        void setAgentModelCatalog(
          catalogKey,
          result.models.map((model) => ({
            id: model.modelId,
            name: model.name,
            ...(model.description ? { description: model.description } : {}),
            ...(model.groupId ? { groupId: model.groupId } : {}),
            ...(model.groupName ? { groupName: model.groupName } : {}),
          })),
        );
      })
      .catch(() => {
        probeRetriedAt.set(catalogKey, Date.now());
      })
      .finally(() => {
        probeInFlight.delete(catalogKey);
        setProbing((current) => (current === catalogKey ? null : current));
      });
  }, [
    catalog,
    catalogKey,
    cwd,
    installed,
    liveRow,
    profileDefaults,
    profiles,
    row,
    workspace,
  ]);

  const close = useCallback(() => onClose?.(), [onClose]);

  const openRow = useCallback(
    (target: AddableRow) => {
      // Spawn mode always starts a fresh thread on the chosen harness.
      if (onSpawnAgent) {
        const remembered =
          preferred[modelCatalogKey(target.agent, target.profileId)];
        onSpawnAgent(
          target.agent,
          target.profileId,
          remembered ?? null,
          spawnPrompt ?? "",
        );
        close();
        return;
      }
      const openTab = tabs.find(
        (tab) =>
          tab.agent === target.agent &&
          (tab.profileId ?? null) === (target.profileId ?? null),
      );
      if (openTab) {
        onActivateTab?.(openTab.id);
        close();
        return;
      }
      if (
        onSwitchProfile &&
        target.agent === agent &&
        target.profileId &&
        target.profileId !== (profileId ?? null)
      ) {
        onSwitchProfile(target.profileId);
        close();
        return;
      }
      const remembered =
        preferred[modelCatalogKey(target.agent, target.profileId)];
      onOpenAgent(target.agent, target.profileId, remembered ?? null);
      close();
    },
    [
      agent,
      close,
      onActivateTab,
      onOpenAgent,
      onSpawnAgent,
      onSwitchProfile,
      preferred,
      profileId,
      spawnPrompt,
      tabs,
    ],
  );

  const pickModel = useCallback(
    (model: CatalogModel) => {
      if (!row) return;
      if (onSpawnAgent) {
        onSpawnAgent(row.agent, row.profileId, model.id, spawnPrompt ?? "");
        close();
        return;
      }
      if (liveRow && onSelectModel) {
        onSelectModel(model.id);
        close();
        return;
      }
      onOpenAgent(row.agent, row.profileId, model.id);
      close();
    },
    [
      close,
      liveRow,
      onOpenAgent,
      onSelectModel,
      onSpawnAgent,
      row,
      spawnPrompt,
    ],
  );

  const moveRow = (delta: number) => {
    if (filteredRows.length === 0) return;
    const current = Math.max(
      0,
      filteredRows.findIndex((entry) => entry.key === row?.key),
    );
    const next =
      filteredRows[
        (current + delta + filteredRows.length) % filteredRows.length
      ];
    if (!next) return;
    if (next.key !== activeKey) {
      setModelQuery("");
      setActiveModel(0);
    }
    setActiveKey(next.key);
  };

  const handleAgentKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveRow(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (row) openRow(row);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  const moveModel = (delta: number) => {
    if (models.length === 0) return;
    setActiveModel(
      (current) => (current + delta + models.length) % models.length,
    );
  };

  const handleModelKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (models.length > 0) moveModel(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (models.length > 0) moveModel(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const model = models[activeModel];
      if (model) pickModel(model);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (modelQuery === "") {
      const index = pickerJumpIndex(event.key);
      if (index === null) return;
      const model = models[index];
      if (!model) return;
      event.preventDefault();
      pickModel(model);
    }
  };

  const emptyHint = (() => {
    if (!row) return "No harness is available in this workspace.";
    if (models.length > 0) return null;
    if (rowModels.length > 0) {
      if (costFilter === "free") return "No free models match.";
      if (costFilter === "paid") return "No paid models match.";
      return "No models match your search.";
    }
    if (probing === catalogKey) return `Loading ${row.label} models...`;
    if (row.agent === "pi") return "Pi keeps its own model list.";
    return `Open ${row.label} to load its models.`;
  })();

  let flatIndex = 0;

  return (
    <div
      className={cn("flex h-[21rem] min-h-0 flex-col text-[12px]", className)}
    >
      <div className="flex min-h-0 flex-1">
        <div className="flex w-48 shrink-0 flex-col border-r border-border/60">
          <div className="relative shrink-0 p-1.5">
            <HugeiconsIcon
              icon={Search01Icon}
              size={12}
              strokeWidth={1.8}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70"
            />
            <input
              ref={searchRef}
              value={agentQuery}
              onChange={(event) => {
                setAgentQuery(event.target.value);
                setModelQuery("");
                setActiveModel(0);
              }}
              onKeyDown={handleAgentKeyDown}
              placeholder="Search agents..."
              aria-label="Search agents"
              className="w-full rounded-md border border-border/60 bg-background/60 py-1 pl-6 pr-1.5 text-[11px] outline-none placeholder:text-muted-foreground/60 focus:border-ring/50"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-1">
            {filteredRows.length === 0 ? (
              <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                No agents found.
              </p>
            ) : (
              filteredRows.map((entry) => {
                const selected = row?.key === entry.key;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    data-agent-row
                    onFocus={() => {
                      if (entry.key !== activeKey) {
                        setModelQuery("");
                        setActiveModel(0);
                      }
                      setActiveKey(entry.key);
                    }}
                    onClick={() => openRow(entry)}
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors",
                      selected
                        ? "bg-foreground/[0.07] text-foreground"
                        : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
                    )}
                  >
                    <AgentIcon
                      agent={entry.agent}
                      size={12}
                      className="shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {entry.label}
                    </span>
                    {entry.profileLabel ? (
                      <span className="shrink-0 rounded border border-border/60 px-1 text-[9px] uppercase tracking-wide text-muted-foreground">
                        {entry.profileLabel}
                      </span>
                    ) : null}
                    {entry.open ? (
                      <span
                        title="Session open"
                        className="size-1.5 shrink-0 rounded-full bg-emerald-500"
                      />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="shrink-0 px-1.5 pb-1 pt-1.5">
            <div className="flex items-center gap-1.5 px-1 pb-1">
              <span className="min-w-0 flex-1 truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {row ? `${row.label} models` : "Models"}
              </span>
              {probing === catalogKey ? (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={11}
                  strokeWidth={2}
                  className="animate-spin text-muted-foreground"
                />
              ) : null}
              {liveRow && onSelectModel ? (
                <span className="shrink-0 text-[9.5px] text-muted-foreground/70">
                  this session
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              <div className="relative min-w-0 flex-1">
                <HugeiconsIcon
                  icon={Search01Icon}
                  size={12}
                  strokeWidth={1.8}
                  className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/70"
                />
                <input
                  ref={modelSearchRef}
                  value={modelQuery}
                  onChange={(event) => {
                    setModelQuery(event.target.value);
                    setActiveModel(0);
                  }}
                  onKeyDown={handleModelKeyDown}
                  placeholder="Search models..."
                  aria-label="Search models"
                  className="w-full rounded-md border border-border/60 bg-background/60 py-1 pl-6 pr-1.5 text-[11px] outline-none placeholder:text-muted-foreground/60 focus:border-ring/50"
                />
              </div>
              <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border/60 p-0.5">
                {(["all", "free", "paid"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={costFilter === option}
                    onClick={() => {
                      setCostFilter(option);
                      setActiveModel(0);
                    }}
                    className={cn(
                      "rounded px-1 py-0.5 text-[9.5px] capitalize leading-none transition-colors",
                      costFilter === option
                        ? "bg-foreground/[0.09] text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-1">
            {models.length === 0 ? (
              <p className="px-2.5 py-3 text-[11px] leading-relaxed text-muted-foreground">
                {emptyHint}
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.key || "ungrouped"}>
                  {group.label ? (
                    <div className="px-2 pb-0.5 pt-1 text-[9.5px] font-medium uppercase tracking-wide text-muted-foreground/70">
                      {group.label}
                    </div>
                  ) : null}
                  {group.models.map((model) => {
                    const index = flatIndex++;
                    const jump = pickerJumpLabel(index);
                    const selected =
                      model.id === (liveRow ? modelId : undefined);
                    const highlighted = index === activeModel;
                    return (
                      <button
                        key={`${model.id}:${index}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onMouseEnter={() => setActiveModel(index)}
                        onClick={() => pickModel(model)}
                        className={cn(
                          "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors",
                          highlighted
                            ? "bg-foreground/[0.07] text-foreground"
                            : "text-foreground/85 hover:bg-foreground/[0.04]",
                        )}
                      >
                        <span className="w-3 shrink-0 text-[9.5px] tabular-nums text-muted-foreground/60">
                          {jump ?? ""}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {model.name}
                        </span>
                        {modelIsFree(model) ? (
                          <span className="shrink-0 rounded bg-emerald-500/15 px-1 text-[9px] leading-4 text-emerald-600 dark:text-emerald-400">
                            Free
                          </span>
                        ) : null}
                        {model.description ? (
                          <span className="max-w-28 shrink-0 truncate text-[9.5px] text-muted-foreground">
                            {model.description}
                          </span>
                        ) : null}
                        {selected ? (
                          <HugeiconsIcon
                            icon={Tick02Icon}
                            size={11}
                            strokeWidth={2}
                            className="shrink-0 text-primary"
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-t border-border/60 px-2.5 py-1 text-[9.5px] text-muted-foreground">
        <HugeiconsIcon icon={ArrowRight01Icon} size={10} strokeWidth={1.8} />
        <span>
          {onSpawnAgent
            ? `Spin up ${row?.label ?? "a harness"} with this prompt`
            : row?.open
              ? "Focus the open session"
              : "Open a session with the highlighted agent"}
        </span>
        <span className="ml-auto shrink-0 text-muted-foreground/70">
          ↑↓ move · Enter select · Esc close
        </span>
      </div>
    </div>
  );
}
