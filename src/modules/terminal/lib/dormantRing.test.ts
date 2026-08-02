import { describe, expect, it } from "vitest";
import { DormantRing } from "./dormantRing";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function drainText(ring: DormantRing): string {
  const chunks: Uint8Array[] = [];
  ring.drain((bytes) => chunks.push(bytes));
  return chunks.map((bytes) => decoder.decode(bytes)).join("");
}

describe("DormantRing", () => {
  it("preserves frequent small writes while within the byte cap", () => {
    const ring = new DormantRing(4_096);
    for (let i = 0; i < 300; i++) ring.push(encoder.encode(`${i},`));

    expect(drainText(ring)).toBe(
      Array.from({ length: 300 }, (_, i) => `${i},`).join(""),
    );
  });

  it("reports overflow without resetting restored terminal content", () => {
    const ring = new DormantRing(8);
    ring.push(encoder.encode("old-"));
    ring.push(encoder.encode("new-data"));

    const restored = `snapshot${drainText(ring)}`;
    expect(restored).toContain("snapshot");
    expect(restored).toContain("new-data");
    expect(restored).toContain("older output dropped");
    expect(restored).not.toContain("\x1bc");
  });

  it("never retains more data bytes than its cap", () => {
    const ring = new DormantRing(16);
    ring.push(encoder.encode("0123456789"));
    ring.push(encoder.encode("abcdefghij"));

    expect(ring.byteLength()).toBe(16);
  });
});
