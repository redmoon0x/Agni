import { describe, expect, it } from "vitest";
import {
  ACP_AGENTS,
  ACP_AGENT_LIST,
  acpAgent,
  isAcpAgentId,
  type AcpAgentFlavor,
} from "@/modules/acp-agent/lib/agent";
import { agentCatalogDrift } from "@/modules/acp-agent/lib/agentCatalog";
import { AGNI_RUNTIME_MODES } from "@/modules/acp-agent/lib/runtimeModes";

describe("ACP agent descriptors", () => {
  it("has unique ids and labels in record order", () => {
    const ids = ACP_AGENT_LIST.map((agent) => agent.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(Object.keys(ACP_AGENTS));
    const labels = ACP_AGENT_LIST.map((agent) => agent.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("exposes launch and probe programs", () => {
    for (const agent of ACP_AGENT_LIST) {
      expect(agent.program.length).toBeGreaterThan(0);
      expect(agent.probeProgram.length).toBeGreaterThan(0);
      expect(agent.args.every((arg) => arg.length > 0)).toBe(true);
    }
    expect(acpAgent("claude").program).toBe("npx");
    expect(acpAgent("claude").probeProgram).toBe("claude");
    expect(acpAgent("omp")).toMatchObject({
      program: "omp",
      args: ["acp"],
      probeProgram: "omp",
    });
  });

  it("only maps known runtime policies in flavors", () => {
    const policies = new Set(AGNI_RUNTIME_MODES.map((mode) => mode.id));
    for (const agent of ACP_AGENT_LIST) {
      const flavor: AcpAgentFlavor = agent.flavor;
      for (const policy of Object.keys(flavor.sessionModeForPolicy ?? {})) {
        expect(policies.has(policy as never)).toBe(true);
      }
    }
  });

  it("recognizes only known ids", () => {
    expect(isAcpAgentId("opencode")).toBe(true);
    expect(isAcpAgentId("omp")).toBe(true);
    expect(isAcpAgentId("pi")).toBe(false);
    expect(isAcpAgentId("nope")).toBe(false);
  });
});

describe("catalog drift", () => {
  it("is empty when the Rust catalog matches the mirror", () => {
    const entries = ACP_AGENT_LIST.map((agent) => ({
      id: agent.id,
      label: agent.label,
      program: agent.program,
      args: [...agent.args],
      probeProgram: agent.probeProgram,
    }));
    expect(agentCatalogDrift(entries)).toEqual([]);
  });

  it("reports label, program and missing entries", () => {
    const entries = ACP_AGENT_LIST.slice(1).map((agent) => ({
      id: agent.id,
      label: agent === ACP_AGENT_LIST[1] ? "Renamed" : agent.label,
      program: agent.program,
      args: [...agent.args],
      probeProgram: agent.probeProgram,
    }));
    const drift = agentCatalogDrift(entries);
    expect(drift).toContain(`ts-only agent: ${ACP_AGENT_LIST[0].id}`);
    expect(drift.some((line) => line.includes("Renamed"))).toBe(true);
  });
});
