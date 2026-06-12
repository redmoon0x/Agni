import type { IUnicodeVersionProvider, Terminal } from "@xterm/xterm";

const VERSION = "agni-indic";
const KANNADA_START = 0x0c80;
const KANNADA_END = 0x0cff;
const KANNADA_VIRAMA = 0x0ccd;

const COMBINING_RANGES: [number, number][] = [
  [0x0300, 0x036f],
  [0x0483, 0x0489],
  [0x0591, 0x05bd],
  [0x05bf, 0x05bf],
  [0x05c1, 0x05c2],
  [0x05c4, 0x05c5],
  [0x05c7, 0x05c7],
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06dc],
  [0x06df, 0x06e4],
  [0x06e7, 0x06e8],
  [0x06ea, 0x06ed],
  [0x0711, 0x0711],
  [0x0730, 0x074a],
  [0x07a6, 0x07b0],
  [0x07eb, 0x07f3],
  [0x0816, 0x0819],
  [0x081b, 0x0823],
  [0x0825, 0x0827],
  [0x0829, 0x082d],
  [0x0859, 0x085b],
  [0x08d3, 0x08e1],
  [0x08e3, 0x0903],
  [0x093a, 0x093c],
  [0x093e, 0x094f],
  [0x0951, 0x0957],
  [0x0962, 0x0963],
  [0x0981, 0x0983],
  [0x09bc, 0x09bc],
  [0x09be, 0x09c4],
  [0x09c7, 0x09c8],
  [0x09cb, 0x09cd],
  [0x09d7, 0x09d7],
  [0x09e2, 0x09e3],
  [0x0a01, 0x0a03],
  [0x0a3c, 0x0a3c],
  [0x0a3e, 0x0a42],
  [0x0a47, 0x0a48],
  [0x0a4b, 0x0a4d],
  [0x0a51, 0x0a51],
  [0x0a70, 0x0a71],
  [0x0a75, 0x0a75],
  [0x0a81, 0x0a83],
  [0x0abc, 0x0abc],
  [0x0abe, 0x0ac5],
  [0x0ac7, 0x0ac9],
  [0x0acb, 0x0acd],
  [0x0ae2, 0x0ae3],
  [0x0afa, 0x0aff],
  [0x0b01, 0x0b03],
  [0x0b3c, 0x0b3c],
  [0x0b3e, 0x0b44],
  [0x0b47, 0x0b48],
  [0x0b4b, 0x0b4d],
  [0x0b56, 0x0b57],
  [0x0b62, 0x0b63],
  [0x0b82, 0x0b82],
  [0x0bbe, 0x0bc2],
  [0x0bc6, 0x0bc8],
  [0x0bca, 0x0bcd],
  [0x0bd7, 0x0bd7],
  [0x0c00, 0x0c04],
  [0x0c3c, 0x0c3c],
  [0x0c3e, 0x0c44],
  [0x0c46, 0x0c48],
  [0x0c4a, 0x0c4d],
  [0x0c55, 0x0c56],
  [0x0c62, 0x0c63],
  [0x0c81, 0x0c83],
  [0x0cbc, 0x0cbc],
  [0x0cbe, 0x0cc4],
  [0x0cc6, 0x0cc8],
  [0x0cca, 0x0ccd],
  [0x0cd5, 0x0cd6],
  [0x0ce2, 0x0ce3],
  [0x0d00, 0x0d03],
  [0x0d3b, 0x0d3c],
  [0x0d3e, 0x0d44],
  [0x0d46, 0x0d48],
  [0x0d4a, 0x0d4d],
  [0x0d57, 0x0d57],
  [0x0d62, 0x0d63],
  [0x0d81, 0x0d83],
  [0x0dca, 0x0dca],
  [0x0dcf, 0x0dd4],
  [0x0dd6, 0x0dd6],
  [0x0dd8, 0x0ddf],
  [0x0df2, 0x0df3],
  [0x200c, 0x200d],
  [0xfe00, 0xfe0f],
];

const WIDE_RANGES: [number, number][] = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
];

function inRanges(codepoint: number, ranges: [number, number][]): boolean {
  return ranges.some(([start, end]) => codepoint >= start && codepoint <= end);
}

function isKannadaCodepoint(codepoint: number): boolean {
  return codepoint >= KANNADA_START && codepoint <= KANNADA_END;
}

function isKannadaMark(codepoint: number): boolean {
  return isKannadaCodepoint(codepoint) && inRanges(codepoint, COMBINING_RANGES);
}

function isKannadaMarkAfterBase(codepoint: number): boolean {
  return isKannadaMark(codepoint) && codepoint !== KANNADA_VIRAMA;
}

function nextCodepoint(text: string, index: number): { codepoint: number; next: number } {
  const codepoint = text.codePointAt(index) ?? 0;
  return { codepoint, next: index + (codepoint > 0xffff ? 2 : 1) };
}

function consumeKannadaMarks(text: string, index: number): number {
  let next = index;
  while (next < text.length) {
    const current = nextCodepoint(text, next);
    if (!isKannadaMarkAfterBase(current.codepoint)) break;
    next = current.next;
  }
  return next;
}

function consumeKannadaCluster(text: string, index: number): number {
  const current = nextCodepoint(text, index);
  if (!isKannadaCodepoint(current.codepoint)) return current.next;
  let end = consumeKannadaMarks(text, current.next);

  while (end < text.length) {
    const virama = nextCodepoint(text, end);
    if (virama.codepoint !== KANNADA_VIRAMA) break;
    const base = nextCodepoint(text, virama.next);
    if (!isKannadaCodepoint(base.codepoint) || isKannadaMark(base.codepoint)) {
      break;
    }
    end = consumeKannadaMarks(text, base.next);
  }

  return end;
}

export function kannadaJoinRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (let i = 0; i < text.length; ) {
    const { codepoint, next } = nextCodepoint(text, i);
    if (isKannadaCodepoint(codepoint)) {
      const end = consumeKannadaCluster(text, i);
      if (end - i > 1) ranges.push([i, end]);
      i = end;
      continue;
    }
    i = next;
  }
  return ranges;
}

export function terminalWcwidth(codepoint: number): 0 | 1 | 2 {
  if (codepoint === 0) return 0;
  if (codepoint < 32 || (codepoint >= 0x7f && codepoint < 0xa0)) return 0;
  if (codepoint < 0x0300) return 1;
  if (inRanges(codepoint, COMBINING_RANGES)) return 0;
  if (inRanges(codepoint, WIDE_RANGES)) return 2;
  return 1;
}

export const indicUnicodeProvider: IUnicodeVersionProvider = {
  version: VERSION,
  wcwidth: terminalWcwidth,
  charProperties: () => 0,
};

export function installIndicTextSupport(term: Terminal): void {
  try {
    if (!term.unicode.versions.includes(VERSION)) {
      term.unicode.register(indicUnicodeProvider);
    }
    term.unicode.activeVersion = VERSION;
  } catch (e) {
    console.warn("[agni] indic unicode provider unavailable:", e);
  }

  try {
    term.registerCharacterJoiner(kannadaJoinRanges);
  } catch (e) {
    console.warn("[agni] kannada character joiner unavailable:", e);
  }
}
