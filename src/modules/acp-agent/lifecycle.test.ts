import { describe, expect, it, vi } from "vitest";
import {
  createSerialQueue,
  isPathWithinRoots,
  parseDirectoryList,
  sameSessionConfig,
  settleWithin,
  withTimeout,
} from "@/modules/acp-agent/lifecycle";
import type { AcpSessionConfig } from "@/modules/acp-agent/types";

const local: AcpSessionConfig["workspace"] = { kind: "local" };

function config(overrides: Partial<AcpSessionConfig> = {}): AcpSessionConfig {
  return {
    agent: "opencode",
    cwd: "D:\\Work\\App",
    workspace: local,
    ...overrides,
  };
}

describe("createSerialQueue", () => {
  it("runs tasks one at a time in order", async () => {
    const queue = createSerialQueue();
    const events: string[] = [];
    const gate: { release: () => void } = { release: () => {} };
    const first = queue.enqueue(async () => {
      events.push("first:start");
      await new Promise<void>((resolve) => {
        gate.release = resolve;
      });
      events.push("first:end");
    });
    const second = queue.enqueue(async () => {
      events.push("second");
    });
    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    gate.release();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });

  it("keeps running after a task rejects", async () => {
    const queue = createSerialQueue();
    const failing = queue.enqueue(async () => {
      throw new Error("boom");
    });
    const next = queue.enqueue(async () => 7);
    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe(7);
  });
});

describe("sameSessionConfig", () => {
  it("matches equivalent paths across separators, case and trailing slashes", () => {
    expect(sameSessionConfig(config(), config({ cwd: "d:/work/app/" }))).toBe(
      true,
    );
  });

  it("rejects different agents, folders or workspaces", () => {
    expect(sameSessionConfig(config(), config({ agent: "kilo" }))).toBe(false);
    expect(sameSessionConfig(config(), config({ cwd: "D:/Other" }))).toBe(
      false,
    );
    expect(
      sameSessionConfig(
        config(),
        config({ workspace: { kind: "wsl", distro: "Ubuntu" } }),
      ),
    ).toBe(false);
  });

  it("treats two nulls as equal and null against a config as different", () => {
    expect(sameSessionConfig(null, null)).toBe(true);
    expect(sameSessionConfig(null, config())).toBe(false);
    expect(sameSessionConfig(config(), null)).toBe(false);
  });
});

describe("isPathWithinRoots", () => {
  it("accepts paths inside any root across separators and case", () => {
    expect(
      isPathWithinRoots("D:\\Work\\App\\src\\main.ts", ["d:/work/app/"]),
    ).toBe(true);
    expect(
      isPathWithinRoots("/home/user/shared/lib.ts", [
        "/home/user/project",
        "/home/user/shared",
      ]),
    ).toBe(true);
  });

  it("rejects paths outside every root and relative paths", () => {
    expect(isPathWithinRoots("D:/Other/file.ts", ["D:/Work/App"])).toBe(false);
    expect(isPathWithinRoots("/home/user/project-x/file.ts", ["/home/user/project"])).toBe(
      false,
    );
    expect(isPathWithinRoots("relative/file.ts", ["/home/user/project"])).toBe(
      false,
    );
  });
});

describe("parseDirectoryList", () => {
  it("keeps unique absolute directories and drops everything else", () => {
    expect(
      parseDirectoryList([
        " /home/user/shared ",
        "/home/user/shared",
        "relative/path",
        "",
        42,
        "C:\\Work\\Shared",
      ]),
    ).toEqual(["/home/user/shared", "C:\\Work\\Shared"]);
    expect(parseDirectoryList(null)).toEqual([]);
  });
});

describe("withTimeout", () => {
  it("resolves with the value when the promise settles first", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1_000, "late")).resolves.toBe(
      "ok",
    );
  });

  it("propagates a rejection", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("nope")), 1_000, "late"),
    ).rejects.toThrow("nope");
  });

  it("rejects once the budget expires", async () => {
    vi.useFakeTimers();
    const guarded = withTimeout(
      new Promise<string>(() => {}),
      50,
      "timed out",
    );
    const expectation = expect(guarded).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(50);
    await expectation;
    vi.useRealTimers();
  });
});

describe("settleWithin", () => {
  it("resolves as soon as the promise settles", async () => {
    await expect(settleWithin(Promise.resolve(), 1_000)).resolves.toBeUndefined();
  });

  it("resolves on the deadline for a promise that never settles", async () => {
    vi.useFakeTimers();
    let done = false;
    const waiting = settleWithin(new Promise<void>(() => {}), 25).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(25);
    await waiting;
    expect(done).toBe(true);
    vi.useRealTimers();
  });

  it("never rejects", async () => {
    await expect(
      settleWithin(Promise.reject(new Error("x")), 1_000),
    ).resolves.toBeUndefined();
  });
});
