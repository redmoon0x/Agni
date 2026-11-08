import { describe, expect, it } from "vitest";
import {
  AGNI_RUNTIME_MODES,
  resolveCompatibleRuntimeMode,
  runtimeModeForCurrent,
} from "@/modules/acp-agent/lib/runtimeModes";
import type { AcpModeState } from "@/modules/acp-agent/types";

function modes(...ids: string[]): AcpModeState {
  return {
    currentModeId: ids[0],
    availableModes: ids.map((id) => ({ id, name: id })),
  };
}

describe("resolveCompatibleRuntimeMode", () => {
  it("returns null when the agent advertises no modes", () => {
    expect(resolveCompatibleRuntimeMode("supervised", null)).toEqual({
      mode: null,
      changed: true,
    });
    expect(resolveCompatibleRuntimeMode("auto", modes())).toEqual({
      mode: null,
      changed: true,
    });
  });

  it("prefers the agent's declared mapping", () => {
    expect(
      resolveCompatibleRuntimeMode("supervised", modes("plan"), {
        sessionModeForPolicy: { supervised: "plan" },
      }),
    ).toEqual({ mode: "plan", changed: false });
  });

  it("matches aliases without changing the policy", () => {
    expect(resolveCompatibleRuntimeMode("accept-edits", modes("edits"))).toEqual({
      mode: "edits",
      changed: false,
    });
  });

  it("falls back and reports that it changed", () => {
    expect(resolveCompatibleRuntimeMode("supervised", modes("auto"))).toEqual({
      mode: "auto",
      changed: true,
    });
  });

  it("returns null when nothing is compatible", () => {
    expect(
      resolveCompatibleRuntimeMode("full-access", modes("unrelated")),
    ).toEqual({ mode: null, changed: true });
  });
});

describe("runtimeModeForCurrent", () => {
  it("normalizes a current mode id to a policy", () => {
    expect(runtimeModeForCurrent("plan", modes("plan"))).toBe("supervised");
    expect(runtimeModeForCurrent("yolo", modes("yolo"))).toBe("auto");
    expect(runtimeModeForCurrent(null, modes("auto"))).toBeNull();
    expect(runtimeModeForCurrent("other", modes("auto"))).toBeNull();
  });

  it("has four distinct policies", () => {
    expect(AGNI_RUNTIME_MODES.map((mode) => mode.id)).toEqual([
      "supervised",
      "accept-edits",
      "auto",
      "full-access",
    ]);
  });
});
