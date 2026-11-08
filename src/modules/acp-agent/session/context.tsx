import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from "react";
import { useStore } from "zustand";
import type { AcpStore } from "@/modules/acp-agent/projector";
import type { AcpClient } from "@/modules/acp-agent/session/client";
import {
  acpSessionKey,
  getOrCreateAcpSession,
  releaseAcpSession,
} from "@/modules/acp-agent/session/registry";
import {
  acquireProfile,
  releaseProfile,
} from "@/modules/agent-panel/lib/profileLock";
import type { AcpSessionConfig } from "@/modules/acp-agent/types";

const AcpSessionContext = createContext<AcpClient | null>(null);

export function AcpSessionProvider({
  config,
  children,
}: {
  config: AcpSessionConfig;
  children: ReactNode;
}) {
  const key = acpSessionKey(config);
  // Reuse the registry entry keyed by config identity rather than object identity.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by session key
  const client = useMemo(() => getOrCreateAcpSession(config), [key]);

  useEffect(() => {
    client.acquire();
    const profileId = config.profileId;
    if (profileId) acquireProfile(profileId);
    return () => {
      releaseAcpSession(key);
      if (profileId) releaseProfile(profileId);
    };
  }, [client, config.profileId, key]);

  return (
    <AcpSessionContext.Provider value={client}>
      {children}
    </AcpSessionContext.Provider>
  );
}

export function useAcpClient(): AcpClient {
  const client = useContext(AcpSessionContext);
  if (!client) {
    throw new Error("useAcpClient must be used within AcpSessionProvider");
  }
  return client;
}

/** Same call shape as the old global hook, scoped to this panel's session. */
export function useAcpStore<T>(selector: (state: AcpStore) => T): T {
  const client = useAcpClient();
  return useStore(client.store, selector);
}

/** The whole projection for this session (used when a component needs most of it). */
export function useAcpState(): AcpStore {
  const client = useAcpClient();
  return useStore(client.store, (state) => state);
}
