/** A partially typed `@` mention. `start` is the index of the `@` character. */
export type AtToken = { query: string; start: number };

/**
 * Detect an `@` mention ending at the caret. The `@` must start the input or
 * follow whitespace, and no whitespace may appear between it and the caret.
 * Shared by both agent composers so the behavior cannot drift.
 */
export function detectAtToken(value: string, caret: number): AtToken | null {
  const uptoCaret = value.slice(0, caret);
  const at = uptoCaret.lastIndexOf("@");
  if (at === -1) return null;
  const before = uptoCaret[at - 1];
  if (before !== undefined && !/\s/.test(before)) return null;
  const query = uptoCaret.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { query, start: at };
}

/** The `@…` token under the caret, replaced by a mention chip. */
export function replaceAtToken(
  value: string,
  token: AtToken,
  mention: string,
): { value: string; caret: number } {
  const end = token.start + 1 + token.query.length;
  const next = `${value.slice(0, token.start)}@${mention} ${value.slice(end)}`;
  return { value: next, caret: token.start + 1 + mention.length + 1 };
}

/** A leading `/command` token, only when the whole input is one token. */
export function detectSlashToken(value: string): string | null {
  const match = /^\/(\S*)$/.exec(value);
  return match ? match[1] : null;
}
