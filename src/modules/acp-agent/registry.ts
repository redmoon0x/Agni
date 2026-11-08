import { invoke } from "@tauri-apps/api/core";

export type AcpInstallSpec = {
  program: string;
  args: string[];
};

export type AcpDownloadSpec = {
  url: string;
  sha256: string;
  archive: "zip" | "tar.gz" | "tar.xz" | "raw";
  binaryTarget: string | null;
};

export type AcpRegistryDistribution = {
  kind: "npx" | "binary" | "uvx" | "other";
  /** Resolved launch spec, e.g. `npx --yes <pkg>`. */
  install: AcpInstallSpec | null;
  /** Present only for `binary` distributions. */
  download: AcpDownloadSpec | null;
  /** Legacy copy-only command; removed once M4 lands. */
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

/** An agent Agni installed into its managed app-data directory. */
export type InstalledAcpAgent = {
  id: string;
  label: string;
  version: string;
  program: string;
  args: string[];
  env: { name: string; value: string }[];
  managed: boolean;
};

export async function listAcpRegistry(): Promise<AcpRegistry> {
  return parseAcpRegistry(await invoke<unknown>("acp_registry_list"));
}

export async function listInstalledAcpAgents(): Promise<InstalledAcpAgent[]> {
  return parseInstalledAcpAgents(await invoke<unknown>("acp_registry_installed"));
}

export async function installAcpRegistryAgent(
  agent: AcpRegistryAgent,
): Promise<InstalledAcpAgent> {
  const installed = await invoke<unknown>("acp_registry_install", { agent });
  const parsed = parseInstalledAcpAgent(installed);
  if (!parsed) throw new Error("The installed agent response is invalid.");
  return parsed;
}

export async function uninstallAcpRegistryAgent(id: string): Promise<void> {
  await invoke("acp_registry_uninstall", { agentId: id });
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

export function parseInstalledAcpAgents(value: unknown): InstalledAcpAgent[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(parseInstalledAcpAgent)
    .filter((agent): agent is InstalledAcpAgent => agent !== null);
}

function parseInstalledAcpAgent(value: unknown): InstalledAcpAgent | null {
  if (!isRecord(value) || !isText(value.id) || !isText(value.program)) {
    return null;
  }
  return {
    id: value.id,
    label: isText(value.label) ? value.label : value.id,
    version: isText(value.version) ? value.version : "",
    program: value.program,
    args: Array.isArray(value.args) ? value.args.filter(isText) : [],
    env: parseEnv(value.env),
    managed: value.managed === true,
  };
}

function parseEnv(value: unknown): { name: string; value: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || !isText(entry.name) || typeof entry.value !== "string") {
      return [];
    }
    return [{ name: entry.name, value: entry.value }];
  });
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
    distribution: parseDistribution(distribution),
  };
}

function parseDistribution(
  value: Record<string, unknown>,
): AcpRegistryDistribution {
  return {
    kind: value.kind as AcpRegistryDistribution["kind"],
    install: parseInstallSpec(value.install),
    download: parseDownloadSpec(value.download),
    installCommand: isText(value.installCommand) ? value.installCommand : null,
  };
}

function parseInstallSpec(value: unknown): AcpInstallSpec | null {
  if (!isRecord(value) || !isText(value.program)) return null;
  return {
    program: value.program,
    args: Array.isArray(value.args) ? value.args.filter(isText) : [],
  };
}

function parseDownloadSpec(value: unknown): AcpDownloadSpec | null {
  if (!isRecord(value) || !isHttpsUrl(value.url)) return null;
  const archive = value.archive;
  if (
    archive !== "zip" &&
    archive !== "tar.gz" &&
    archive !== "tar.xz" &&
    archive !== "raw"
  ) {
    return null;
  }
  if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(value.sha256)) {
    return null;
  }
  return {
    url: value.url,
    sha256: value.sha256.toLowerCase(),
    archive,
    binaryTarget: isText(value.binaryTarget) ? value.binaryTarget : null,
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
  return (
    value === "npx" || value === "binary" || value === "uvx" || value === "other"
  );
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
