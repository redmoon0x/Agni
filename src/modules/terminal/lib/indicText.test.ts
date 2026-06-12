import { describe, expect, it } from "vitest";
import { kannadaJoinRanges, terminalWcwidth } from "./indicText";

function codepoint(char: string): number {
  return char.codePointAt(0) ?? 0;
}

describe("Indic terminal text support", () => {
  it("treats Kannada vowel signs and virama as zero-width cells", () => {
    expect(terminalWcwidth(codepoint("\u0cbe"))).toBe(0);
    expect(terminalWcwidth(codepoint("\u0cbf"))).toBe(0);
    expect(terminalWcwidth(codepoint("\u0ccd"))).toBe(0);
  });

  it("keeps Kannada base consonants as single-width cells", () => {
    expect(terminalWcwidth(codepoint("\u0c95"))).toBe(1);
    expect(terminalWcwidth(codepoint("\u0ca8"))).toBe(1);
  });

  it("joins Kannada grapheme clusters for the WebGL renderer", () => {
    expect(kannadaJoinRanges("\u0c95\u0ca8\u0ccd\u0ca8\u0ca1")).toEqual([
      [1, 4],
    ]);
  });

  it("does not join plain ascii text", () => {
    expect(kannadaJoinRanges("hello")).toEqual([]);
  });
});
