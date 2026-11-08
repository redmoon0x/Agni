import { createAcpClient } from "@/modules/acp-agent/session/client";
import type {
  AcpAgentInfo,
  AcpAuthMethod,
  AcpCapabilities,
  AcpCommand,
  AcpConfigOption,
  AcpModeState,
  AcpModel,
  AcpSessionConfig,
} from "@/modules/acp-agent/types";

export type AcpProbe = {
  agentInfo: AcpAgentInfo;
  capabilities: AcpCapabilities;
  authMethods: AcpAuthMethod[];
  models: AcpModel[];
  modes: AcpModeState | null;
  configOptions: AcpConfigOption[];
  commands: AcpCommand[];
};

/**
 * Launch a disposable session to learn what an agent actually supports:
 * auth methods, models, modes and commands. This is what lets Settings show
 * real options after an install instead of guessing from the registry entry.
 */
export async function probeAcpAgent(
  config: AcpSessionConfig,
): Promise<AcpProbe> {
  const client = createAcpClient(config);
  try {
    await client.ensureStarted();
    const state = client.store.getState();
    if (state.connection !== "ready") {
      throw new Error(state.processError ?? "The agent did not become ready");
    }
    return {
      agentInfo: state.agentInfo,
      capabilities: state.capabilities,
      authMethods: state.authMethods,
      models: state.modelState?.availableModels ?? [],
      modes: state.modeState,
      configOptions: state.configOptions,
      commands: state.commands,
    };
  } finally {
    await client.dispose().catch(() => {});
  }
}
