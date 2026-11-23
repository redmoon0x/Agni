export type AcpMcpServer =
  | { name: string; command: string; args: string[]; env: { name: string; value: string }[] }
  | { name: string; type: "http" | "sse"; url: string; headers: { name: string; value: string }[] };

export type OmpMcpConfig = { user: unknown; project: unknown };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function entries(value: unknown, name: string): { name: string; value: string }[] {
  if (value === undefined) return [];
  const map = object(value);
  if (!map || Object.values(map).some((item) => typeof item !== "string")) {
    throw new Error(`OMP MCP server ${name} has invalid environment or headers`);
  }
  return Object.entries(map).map(([key, item]) => ({ name: key, value: item as string }));
}

function names(value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
}

export function ompMcpServers(config: OmpMcpConfig): AcpMcpServer[] {
  const user = object(config.user) ?? {};
  const project = object(config.project) ?? {};
  const disabled = names(user.disabledServers);
  const forced = names(user.enabledServers);
  const merged = new Map<string, unknown>();
  for (const scope of [user, project]) {
    for (const [name, server] of Object.entries(object(scope.mcpServers) ?? {})) {
      merged.set(name, server);
    }
  }
  if (merged.size > 128) throw new Error("Too many OMP MCP servers (128 maximum)");
  const result: AcpMcpServer[] = [];
  for (const [name, raw] of merged) {
    if (disabled.has(name)) continue;
    const server = object(raw);
    if (!server) throw new Error(`Invalid OMP MCP server: ${name}`);
    if (server.enabled === false && !forced.has(name)) continue;
    const type = server.type ?? (server.command ? "stdio" : "http");
    if (type === "stdio" && typeof server.command === "string" && server.command) {
      if (server.args !== undefined && (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== "string"))) {
        throw new Error(`OMP MCP server ${name} has invalid arguments`);
      }
      result.push({ name, command: server.command, args: (server.args as string[] | undefined) ?? [], env: entries(server.env, name) });
    } else if ((type === "http" || type === "sse") && typeof server.url === "string" && server.url) {
      result.push({ name, type, url: server.url, headers: entries(server.headers, name) });
    } else {
      throw new Error(`Unsupported OMP MCP server: ${name}`);
    }
  }
  return result;
}
