import type { HttpHeader, HttpMethod } from "./http";

export type CurlImportResult = {
  method: HttpMethod;
  url: string;
  headers: HttpHeader[];
  body: string;
};

/** Flags that take a value and map into the request. */
const VALUE_FLAGS = new Set([
  "-x",
  "--request",
  "-h",
  "--header",
  "-d",
  "--data",
  "--data-raw",
  "--data-ascii",
  "--data-binary",
  "--data-urlencode",
  "-u",
  "--user",
]);

/** Value-taking flags that are irrelevant to the request; skip token + value. */
const SKIP_WITH_VALUE = new Set([
  "-o",
  "--output",
  "-c",
  "--cookie-jar",
  "-b",
  "--cookie",
  "-e",
  "--referer",
  "-a",
  "--user-agent",
]);

/** No-value flags that are safe to skip. */
const NO_VALUE_FLAGS = new Set([
  "-s",
  "--silent",
  "-s",
  "--show-error",
  "-l",
  "--location",
  "-f",
  "--fail",
  "-k",
  "--insecure",
  "-v",
  "--verbose",
  "--compressed",
  "-i",
  "--include",
]);

/**
 * Parse a `curl` command line into a request. Handles -X/--request,
 * -H/--header, -d/--data/--data-raw/--data-json, -u/--user (→ Authorization:
 * Basic), -G (GET with body → query params), -I/--head, positional URL,
 * single/double-quoted tokens, and backslash continuation. Returns null when
 * no URL is found.
 */
export function parseCurl(input: string): CurlImportResult | null {
  const tokens = tokenize(input);
  return parseCurlTokens(tokens);
}

function parseCurlTokens(tokens: string[]): CurlImportResult | null {
  // Drop a leading `curl`/`curl.exe` token if present.
  const first = tokens[0]?.toLowerCase() ?? "";
  const bodyTokens = first.startsWith("curl") ? tokens.slice(1) : tokens;
  if (bodyTokens.length === 0) return null;

  let method: HttpMethod = "GET";
  let url = "";
  const headers: HttpHeader[] = [];
  const data: string[] = [];
  let user: string | null = null;
  let isGet = false;
  let isHead = false;

  let i = 0;
  while (i < bodyTokens.length) {
    const token = bodyTokens[i]!;
    const lower = token.toLowerCase();

    if (VALUE_FLAGS.has(lower) || lower.startsWith("--data-json")) {
      const value = bodyTokens[i + 1];
      if (value === undefined) break;
      i += 1;
      if (lower === "-x" || lower === "--request") {
        method = normalizeMethod(value);
      } else if (lower === "-h" || lower === "--header") {
        const parsed = parseHeader(value);
        if (parsed) headers.push(parsed);
      } else if (lower === "-u" || lower === "--user") {
        user = stripQuotes(value);
      } else {
        // -d / --data / --data-raw / --data-binary / --data-json / --data-urlencode
        data.push(stripQuotes(value));
      }
      i += 1;
      continue;
    }

    if (lower === "-g" || lower === "--get") {
      isGet = true;
      i += 1;
      continue;
    }
    if (lower === "-i" || lower === "--head") {
      isHead = true;
      i += 1;
      continue;
    }
    if (SKIP_WITH_VALUE.has(lower)) {
      i += 2; // skip flag + value
      continue;
    }
    if (NO_VALUE_FLAGS.has(lower)) {
      i += 1;
      continue;
    }

    // First non-flag token is the URL; ignore any later bare tokens.
    if (!token.startsWith("-")) {
      if (!url) url = stripQuotes(token);
      i += 1;
      continue;
    }

    // Unknown flag: skip just it.
    i += 1;
  }

  if (!url) return null;

  // -G turns the data into query params on GET.
  let finalBody = data.join("&");
  if (isGet && data.length > 0) {
    const separator = url.includes("?") ? "&" : "?";
    url = `${url}${separator}${finalBody}`;
    finalBody = "";
  }

  // -I/--head forces HEAD.
  if (isHead) method = "HEAD";

  if (user) {
    headers.push({
      name: "Authorization",
      value: `Basic ${btoa(user)}`,
    });
  }

  // Default to POST when -d is given without an explicit -X.
  if (data.length > 0 && method === "GET" && !isGet) {
    method = "POST";
  }

  return { method, url, headers, body: finalBody };
}

function normalizeMethod(value: string): HttpMethod {
  const v = value.toUpperCase();
  if (v === "HEAD") return "HEAD";
  return v as HttpMethod;
}

function parseHeader(value: string): HttpHeader | null {
  const stripped = stripQuotes(value);
  const idx = stripped.indexOf(":");
  if (idx === -1) return null;
  const name = stripped.slice(0, idx).trim();
  const headerValue = stripped.slice(idx + 1).trim();
  if (!name) return null;
  return { name, value: headerValue };
}

/**
 * Split a shell-ish command line into tokens, respecting single and double
 * quotes and backslash escapes. Backslash-newline continuations are joined.
 */
function tokenize(input: string): string[] {
  const out: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let tokenOpen = false;

  const flush = () => {
    if (tokenOpen) {
      out.push(current);
      current = "";
      tokenOpen = false;
    }
  };

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;

    if (escaped) {
      // Backslash-newline is a continuation; drop both.
      if (ch === "\n" || ch === "\r") {
        escaped = false;
        continue;
      }
      current += ch;
      tokenOpen = true;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      tokenOpen = true;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      tokenOpen = true;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      tokenOpen = true;
      continue;
    }

    if (!inSingle && !inDouble && /\s/.test(ch)) {
      flush();
      continue;
    }

    current += ch;
    tokenOpen = true;
  }
  flush();

  return out.filter(Boolean);
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Turn a full `curl ...` command (with or without the `curl` prefix) into a
 * request. Returns null if it doesn't look like a curl command.
 */
export function importCurl(command: string): CurlImportResult | null {
  return parseCurl(command);
}
