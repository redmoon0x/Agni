import { describe, expect, it } from "vitest";
import { isAbsolutePath, resolveToolPath } from "@/modules/agent-ui/lib/path";

describe("isAbsolutePath", () => {
  it("accepts windows drive, posix and UNC paths", () => {
    expect(isAbsolutePath("C:\\work\\a.ts")).toBe(true);
    expect(isAbsolutePath("C:/work/a.ts")).toBe(true);
    expect(isAbsolutePath("/home/me/a.ts")).toBe(true);
    expect(isAbsolutePath("\\\\server\\share")).toBe(true);
  });

  it("rejects relative paths", () => {
    expect(isAbsolutePath("src/app/App.tsx")).toBe(false);
    expect(isAbsolutePath("./a.ts")).toBe(false);
  });
});

describe("resolveToolPath", () => {
  it("joins a relative path onto the workspaces root", () => {
    expect(resolveToolPath("src/app/App.tsx", "D:\\Agni")).toBe(
      "D:/Agni/src/app/App.tsx",
    );
    expect(resolveToolPath("./src/a.ts", "D:/Agni/")).toBe("D:/Agni/src/a.ts");
    expect(resolveToolPath("src/a.ts", "/home/me/project")).toBe(
      "/home/me/project/src/a.ts",
    );
  });

  it("leaves absolute paths untouched and normalizes slashes", () => {
    expect(resolveToolPath("D:\\Agni\\src\\a.ts", "D:/Agni")).toBe(
      "D:/Agni/src/a.ts",
    );
    expect(resolveToolPath("/etc/hosts", "/home/me")).toBe("/etc/hosts");
  });

  it("returns the normalized path when there is no cwd", () => {
    expect(resolveToolPath("src\\a.ts", null)).toBe("src/a.ts");
  });
});
