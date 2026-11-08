import { describe, expect, it } from "vitest";
import { externalEditorUrl } from "@/modules/agent-ui/lib/openInEditor";

describe("externalEditorUrl", () => {
  it("normalizes windows paths into file URLs", () => {
    expect(externalEditorUrl("vscode", "D:\\repo\\src\\main.ts", 12)).toBe(
      "vscode://file/D:/repo/src/main.ts:12",
    );
  });

  it("keeps unix paths", () => {
    expect(externalEditorUrl("cursor", "/repo/src/main.ts")).toBe(
      "cursor://file/repo/src/main.ts",
    );
  });

  it("omits the line for zed", () => {
    expect(externalEditorUrl("zed", "/repo/a.ts", 4)).toBe(
      "zed://file/repo/a.ts",
    );
  });
});
