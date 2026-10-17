import { invoke } from "@tauri-apps/api/core";

export type AcpRegistryDistribution = {
  kind: "npx" | "binary" | "other";
  installCommand: string | null;
};

export type AcpRegistryAgent = {
  id: string;
  name: string;
  version: string;
  description: string;
  repository: string | null;
  website: string | null;
  authors: string[];
  license: string | null;
  distribution: AcpRegistryDistribution;
};

export type AcpRegistry = {
  version: string;
  agents: AcpRegistryAgent[];
};

export async function listAcpRegistry(): Promise<AcpRegistry> {
  return parseAcpRegistry(await invoke<unknown>("acp_registry_list"));
}

export function parseAcpRegistry(value: unknown): AcpRegistry {
  if (!isRecord(value) || typeof value.version !== "string") {
    throw new Error("The ACP Registry response is invalid.");
  }
  if (!Array.isArray(value.agents)) {
    throw new Error("The ACP Registry agents are invalid.");
  }
  return {
    version: value.version,
    agents: value.agents
      .map(parseAgent)
      .filter((agent): agent is AcpRegistryAgent => agent !== null),
  };
}

function parseAgent(value: unknown): AcpRegistryAgent | null {
  if (!isRecord(value) || !isRecord(value.distribution)) return null;
  const { distribution } = value;
  if (
    !isText(value.id) ||
    !isText(value.name) ||
    !isText(value.version) ||
    typeof value.description !== "string" ||
    !isDistributionKind(distribution.kind)
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    version: value.version,
    description: value.description,
    repository: isHttpsUrl(value.repository) ? value.repository : null,
    website: isHttpsUrl(value.website) ? value.website : null,
    authors: Array.isArray(value.authors) ? value.authors.filter(isText) : [],
    license: isText(value.license) ? value.license : null,
    distribution: {
      kind: distribution.kind,
      installCommand: isText(distribution.installCommand)
        ? distribution.installCommand
        : null,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isDistributionKind(
  value: unknown,
): value is AcpRegistryDistribution["kind"] {
  return value === "npx" || value === "binary" || value === "other";
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
