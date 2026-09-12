import { describe, expect, it } from "vitest";
import { parseEslint, parseRuff } from "./externalDiagnostics";

describe("parseEslint", () => {
  it("maps messages with severity 2 to errors and 1 to warnings", () => {
    const stdout = JSON.stringify([
      {
        filePath: "/a.ts",
        messages: [
          { line: 2, column: 3, severity: 2, message: "Unexpected var" },
          {
            line: 4,
            column: 1,
            endLine: 4,
            endColumn: 9,
            severity: 1,
            message: "Unused import",
          },
        ],
      },
    ]);
    const issues = parseEslint(stdout);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({
      line: 2,
      column: 3,
      severity: "error",
      message: "Unexpected var",
    });
    expect(issues[1]).toMatchObject({
      line: 4,
      endLine: 4,
      endColumn: 9,
      severity: "warning",
    });
  });

  it("skips messages without a line or message", () => {
    const stdout = JSON.stringify([
      { messages: [{ severity: 2 }, { line: 1, message: "ok" }] },
    ]);
    expect(parseEslint(stdout)).toHaveLength(1);
  });
});

describe("parseRuff", () => {
  it("maps ruff locations to warnings", () => {
    const stdout = JSON.stringify([
      {
        code: "F401",
        message: "`os` imported but unused",
        location: { row: 1, column: 8 },
        end_location: { row: 1, column: 10 },
      },
    ]);
    const issues = parseRuff(stdout);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      line: 1,
      column: 8,
      endLine: 1,
      endColumn: 10,
      severity: "warning",
      message: "`os` imported but unused",
    });
  });

  it("ignores entries missing a location", () => {
    expect(parseRuff(JSON.stringify([{ message: "x" }]))).toEqual([]);
  });
});
