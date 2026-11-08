import type { AcpMode, AcpModeState } from "@/modules/acp-agent/types";

/**
 * Agni's four provider-agnostic permission modes. ACP harnesses name their
 * modes differently (or omit some), so we resolve a desired policy onto the
 * closest mode the agent actually advertises instead of showing a dead option.
 */
export type AgniRuntimeMode =
  | "supervised"
  | "accept-edits"
  | "auto"
  | "full-access";

export type RuntimeModeDescriptor = {
  id: AgniRuntimeMode;
  label: string;
  description: string;
};

export const AGNI_RUNTIME_MODES: readonly RuntimeModeDescriptor[] = [
  {
    id: "supervised",
    label: "Supervised",
    description: "Ask before every edit or command.",
  },
  {
    id: "accept-edits",
    label: "Accept edits",
    description: "Apply file edits automatically; ask before commands.",
  },
  {
    id: "auto",
    label: "Auto",
    description: "Run edits and commands; ask only for risky actions.",
  },
  {
    id: "full-access",
    label: "Full access",
    description: "Never ask. Use only in sandboxes you trust.",
  },
];

const RUNTIME_MODE_IDS = new Set<string>(
  AGNI_RUNTIME_MODES.map((mode) => mode.id),
);

export const DEFAULT_RUNTIME_MODE: AgniRuntimeMode = "supervised";

export function parseAgniRuntimeMode(value: unknown): AgniRuntimeMode | null {
  return typeof value === "string" && RUNTIME_MODE_IDS.has(value)
    ? (value as AgniRuntimeMode)
    : null;
}

/** Aliases agents use for each policy, most-specific first. */
const MODE_ALIASES: Record<AgniRuntimeMode, readonly string[]> = {
  supervised: ["supervised", "default", "manual", "ask", "plan", "read-only"],
  "accept-edits": [
    "accept-edits",
    "accept_edits",
    "edit",
    "edits",
    "approve-edits",
    "auto-edit",
  ],
  auto: ["auto", "automatic", "auto-accept", "yolo", "agent"],
  "full-access": [
    "full-access",
    "full_access",
    "full",
    "unrestricted",
    "danger",
    "bypass",
    "bypass-permissions",
  ],
};

const FALLBACK_ORDER: Record<AgniRuntimeMode, readonly AgniRuntimeMode[]> = {
  supervised: ["accept-edits", "auto", "full-access"],
  "accept-edits": ["supervised", "auto", "full-access"],
  auto: ["accept-edits", "full-access", "supervised"],
  "full-access": ["auto", "accept-edits", "supervised"],
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function matches(mode: AcpMode, alias: string): boolean {
  const normalizedAlias = normalize(alias);
  return (
    normalize(mode.id) === normalizedAlias || normalize(mode.name) === normalizedAlias
  );
}

export type ResolvedRuntimeMode = {
  /** The agent's mode id, or null when nothing compatible exists. */
  mode: string | null;
  /** True when the agent cannot express the requested policy exactly. */
  changed: boolean;
};

export type RuntimeModeFlavor = {
  sessionModeForPolicy?: Partial<Record<AgniRuntimeMode, string | null>>;
};

/**
 * Resolve a desired policy onto an agent's advertised modes.
 *
 * Order: the agent's declared mapping, then the desired policy's aliases, then
 * Agni's fallback ladder. `changed` is true whenever the match came from a
 * fallback, so the UI can say "adjusted for this agent" instead of lying.
 */
export function resolveCompatibleRuntimeMode(
  desired: AgniRuntimeMode,
  available: AcpModeState | null,
  flavor?: RuntimeModeFlavor,
): ResolvedRuntimeMode {
  if (!available || available.availableModes.length === 0) {
    return { mode: null, changed: true };
  }

  const declared = flavor?.sessionModeForPolicy?.[desired] ?? null;
  if (declared) {
    const exact = available.availableModes.find((mode) => mode.id === declared);
    if (exact) return { mode: exact.id, changed: false };
  }

  for (const [index, policy] of [desired, ...FALLBACK_ORDER[desired]].entries()) {
    for (const alias of MODE_ALIASES[policy]) {
      const match = available.availableModes.find((mode) => matches(mode, alias));
      if (match) return { mode: match.id, changed: index > 0 || policy !== desired };
    }
  }

  return { mode: null, changed: true };
}

/** Runtime mode id the agent is currently in, normalized to an Agni policy. */
export function runtimeModeForCurrent(
  current: string | null,
  available: AcpModeState | null,
): AgniRuntimeMode | null {
  if (!current || !available) return null;
  const mode = available.availableModes.find((entry) => entry.id === current);
  if (!mode) return null;
  for (const policy of AGNI_RUNTIME_MODES) {
    if (MODE_ALIASES[policy.id].some((alias) => matches(mode, alias))) {
      return policy.id;
    }
  }
  return null;
}
