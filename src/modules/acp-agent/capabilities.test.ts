import { describe, expect, it } from "vitest";
import { parseAgentCapabilities } from "@/modules/acp-agent/acpState";
import { EMPTY_ACP_CAPABILITIES } from "@/modules/acp-agent/types";

describe("parseAgentCapabilities checkpoint flags", () => {
  it("detects advertised checkpoint and rollback support", () => {
    const capabilities = parseAgentCapabilities({
      session: { checkpoint: {}, rollback: {} },
    });
    expect(capabilities.checkpoint).toBe(true);
    expect(capabilities.rollback).toBe(true);
  });

  it("accepts the legacy sessionCapabilities envelope", () => {
    const capabilities = parseAgentCapabilities({
      sessionCapabilities: { checkpoint: true, rollback: true },
    });
    expect(capabilities.checkpoint).toBe(true);
    expect(capabilities.rollback).toBe(true);
  });

  it("defaults to false so unsupported agents never show rewind", () => {
    const capabilities = parseAgentCapabilities({ session: {} });
    expect(capabilities.checkpoint).toBe(false);
    expect(capabilities.rollback).toBe(false);
    expect(EMPTY_ACP_CAPABILITIES.checkpoint).toBe(false);
  });
});
