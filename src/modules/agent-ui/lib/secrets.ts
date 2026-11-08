export type SecretRedaction = {
  text: string;
  /** Human-readable names of the patterns that matched. */
  redacted: string[];
};

type Pattern = { name: string; pattern: RegExp };

const PLACEHOLDER = "[redacted]";

const PATTERNS: Pattern[] = [
  { name: "Anthropic key", pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g },
  { name: "OpenAI key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  {
    name: "GitHub token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  },
  { name: "GitHub fine-grained token", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "Stripe key", pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  {
    name: "credential assignment",
    pattern:
      /\b(?:api[_-]?key|token|secret|password|passwd)\s*[:=]\s*['"]?[A-Za-z0-9_\-./+=]{16,}['"]?/gi,
  },
];

/**
 * Strip credentials out of outgoing prompts. Intentionally conservative: the
 * `credential assignment` rule needs a keyish name plus a 16+ char value, so
 * ordinary prose and paths are untouched.
 */
export function redactSecrets(text: string): SecretRedaction {
  let output = text;
  const redacted: string[] = [];
  for (const { name, pattern } of PATTERNS) {
    pattern.lastIndex = 0;
    if (!pattern.test(output)) continue;
    pattern.lastIndex = 0;
    output = output.replace(pattern, PLACEHOLDER);
    redacted.push(name);
  }
  return { text: output, redacted };
}
