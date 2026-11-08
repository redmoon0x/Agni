export type MarkdownSplit = {
  /** Prefix that only changes when a fence or paragraph boundary seals it. */
  stable: string;
  /** The part that is still changing per token. */
  tail: string;
};

/**
 * Split streaming markdown so the already-rendered prefix can be memoized.
 *
 * We seal at the last *complete* fenced code block (an even number of fences).
 * An unterminated fence keeps everything after the previous complete fence in
 * the tail, so partial code never flickers. CRLF/BOM input falls back to a full
 * reparse because offset math stops being trustworthy.
 */
export function splitStreamingMarkdown(text: string): MarkdownSplit {
  if (text.includes("\r") || text.charCodeAt(0) === 0xfeff) {
    return { stable: "", tail: text };
  }

  const fence = /```/g;
  let count = 0;
  let lastEnd = -1;
  let match: RegExpExecArray | null = fence.exec(text);
  while (match !== null) {
    count += 1;
    if (count % 2 === 0) lastEnd = match.index + 3;
    match = fence.exec(text);
  }

  if (lastEnd > 0 && lastEnd < text.length) {
    return { stable: text.slice(0, lastEnd), tail: text.slice(lastEnd) };
  }

  // Large prose also benefits from sealing at a paragraph boundary, leaving the
  // most recent chunk in the tail so it stays responsive.
  if (text.length > 2000) {
    const boundary = text.lastIndexOf("\n\n", text.length - 500);
    if (boundary > 0) {
      return { stable: text.slice(0, boundary + 2), tail: text.slice(boundary + 2) };
    }
  }

  return { stable: "", tail: text };
}
