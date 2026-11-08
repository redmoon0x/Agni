import { describe, expect, it } from "vitest";
import {
  acquireProfile,
  isProfileBusy,
  profileSessionCount,
  releaseProfile,
} from "@/modules/agent-panel/lib/profileLock";

describe("profile lock", () => {
  it("tracks concurrent sessions per profile", () => {
    expect(isProfileBusy("p1")).toBe(false);
    acquireProfile("p1");
    acquireProfile("p1");
    expect(profileSessionCount("p1")).toBe(2);
    releaseProfile("p1");
    expect(isProfileBusy("p1")).toBe(true);
    releaseProfile("p1");
    expect(isProfileBusy("p1")).toBe(false);
  });

  it("never goes negative", () => {
    releaseProfile("missing");
    expect(profileSessionCount("missing")).toBe(0);
  });
});
