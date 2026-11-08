import { workspaceScopeKey } from "@/modules/workspace";
import type { AcpSessionConfig } from "@/modules/acp-agent/types";
import { type AcpClient, createAcpClient } from "@/modules/acp-agent/session/client";

/** How long a session with no mounted panel stays warm before it is stopped. */
export const ACP_IDLE_TTL_MS = 10 * 60_000;

const clients = new Map<string, AcpClient>();
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function acpSessionKey(config: AcpSessionConfig): string {
  return [
    config.agent,
    config.profileId ?? "",
    normalizePath(config.cwd),
    workspaceScopeKey(config.workspace),
  ].join(":");
}

function cancelIdle(key: string): void {
  const timer = idleTimers.get(key);
  if (timer !== undefined) {
    clearTimeout(timer);
    idleTimers.delete(key);
  }
}

export function getOrCreateAcpSession(config: AcpSessionConfig): AcpClient {
  const key = acpSessionKey(config);
  const existing = clients.get(key);
  if (existing) {
    cancelIdle(key);
    return existing;
  }
  const client = createAcpClient(config);
  clients.set(key, client);
  return client;
}

export function peekAcpSession(key: string): AcpClient | undefined {
  return clients.get(key);
}

export function listAcpSessions(): { key: string; client: AcpClient }[] {
  return [...clients.entries()].map(([key, client]) => ({ key, client }));
}

export async function disposeAcpSession(key: string): Promise<void> {
  cancelIdle(key);
  const client = clients.get(key);
  if (!client) return;
  clients.delete(key);
  await client.dispose().catch(() => {});
}

/** Release one panel reference; stop the process after the idle grace period. */
export function releaseAcpSession(key: string): void {
  const client = clients.get(key);
  if (!client) return;
  client.release();
  if (client.refCount() > 0) return;
  cancelIdle(key);
  const timer = setTimeout(() => {
    idleTimers.delete(key);
    const current = clients.get(key);
    if (current && current.refCount() === 0) {
      void disposeAcpSession(key);
    }
  }, ACP_IDLE_TTL_MS);
  idleTimers.set(key, timer);
}

/** Stop every session and clear the registry (app shutdown / test reset). */
export async function disposeAllAcpSessions(): Promise<void> {
  for (const key of [...clients.keys()]) {
    await disposeAcpSession(key);
  }
}

export function resetAcpSessionRegistryForTests(): void {
  for (const timer of idleTimers.values()) clearTimeout(timer);
  idleTimers.clear();
  clients.clear();
}
