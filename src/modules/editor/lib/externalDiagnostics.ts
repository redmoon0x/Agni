import { type Diagnostic, lintGutter, linter } from "@codemirror/lint";
import type { Extension, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";

const LINT_TIMEOUT_SECS = 10;

type Severity = "error" | "warning" | "info";

type RawIssue = {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  message: string;
  severity: Severity;
};

type LintSpec = {
  program: string;
  args: (path: string) => string[];
  parse: (stdout: string) => RawIssue[];
};

type StdinResult = {
  stdout: string;
  exit_code: number | null;
  timed_out: boolean;
  truncated: boolean;
};

/** ESLint `--format json`: one entry per file with a `messages` array. */
export function parseEslint(stdout: string): RawIssue[] {
  const files = JSON.parse(stdout) as Array<{
    messages?: {
      line?: number;
      column?: number;
      endLine?: number;
      endColumn?: number;
      severity?: number;
      message?: string;
    }[];
  }>;
  const out: RawIssue[] = [];
  for (const file of files) {
    for (const m of file.messages ?? []) {
      if (!m.line || !m.message) continue;
      out.push({
        line: m.line,
        column: m.column ?? 1,
        endLine: m.endLine,
        endColumn: m.endColumn,
        message: m.message,
        severity: m.severity === 2 ? "error" : "warning",
      });
    }
  }
  return out;
}

/** Ruff `check --output-format json`: a flat array with `location` rows. */
export function parseRuff(stdout: string): RawIssue[] {
  const items = JSON.parse(stdout) as Array<{
    message?: string;
    location?: { row?: number; column?: number };
    end_location?: { row?: number; column?: number };
  }>;
  const out: RawIssue[] = [];
  for (const d of items) {
    if (!d.location?.row || !d.message) continue;
    out.push({
      line: d.location.row,
      column: d.location.column ?? 1,
      endLine: d.end_location?.row,
      endColumn: d.end_location?.column,
      message: d.message,
      severity: "warning",
    });
  }
  return out;
}

const eslintSpec: LintSpec = {
  program: "eslint",
  args: (path) => ["--format", "json", "--stdin", "--stdin-filename", path],
  parse: parseEslint,
};

const ruffSpec: LintSpec = {
  program: "ruff",
  args: (path) => [
    "check",
    "--output-format",
    "json",
    "--stdin-filename",
    path,
    "-",
  ],
  parse: parseRuff,
};

const SPECS: Record<string, LintSpec> = {
  ts: eslintSpec,
  tsx: eslintSpec,
  js: eslintSpec,
  jsx: eslintSpec,
  mjs: eslintSpec,
  cjs: eslintSpec,
  py: ruffSpec,
};

function offsetAt(doc: Text, line: number, column: number): number {
  const clampedLine = Math.min(Math.max(1, line), doc.lines);
  const l = doc.line(clampedLine);
  return Math.min(l.from + Math.max(0, column - 1), l.to);
}

function toDiagnostic(view: EditorView, issue: RawIssue): Diagnostic {
  const doc = view.state.doc;
  const from = offsetAt(doc, issue.line, issue.column);
  const to = Math.max(
    from,
    offsetAt(doc, issue.endLine ?? issue.line, issue.endColumn ?? issue.column + 1),
  );
  return { from, to, severity: issue.severity, message: issue.message };
}

function safeParse(spec: LintSpec, stdout: string): RawIssue[] {
  if (!stdout.trim()) return [];
  try {
    return spec.parse(stdout);
  } catch {
    return [];
  }
}

async function runLint(
  view: EditorView,
  path: string,
  spec: LintSpec,
): Promise<Diagnostic[]> {
  const code = view.state.doc.toString();
  if (!code.trim()) return [];
  const slash = path.lastIndexOf("/");
  const cwd = slash > 0 ? path.slice(0, slash) : null;
  try {
    const res = await invoke<StdinResult>("run_stdin_command", {
      program: spec.program,
      args: spec.args(path),
      cwd,
      input: code,
      timeoutSecs: LINT_TIMEOUT_SECS,
      workspace: currentWorkspaceEnv(),
    });
    if (res.timed_out || res.truncated) return [];
    return safeParse(spec, res.stdout).map((issue) => toDiagnostic(view, issue));
  } catch {
    // Missing binary or a linter error: show nothing rather than a fake error.
    return [];
  }
}

/**
 * Builds the optional linter extension for a file, or null when no external
 * linter is configured for its extension. The gutter is only mounted when this
 * is active, so diagnostics cost nothing while the preference is off.
 */
export function lintExtension(path: string): Extension | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const spec = SPECS[ext];
  if (!spec) return null;
  return [
    lintGutter(),
    EditorView.theme({ ".cm-gutter-lint": { width: "14px" } }),
    linter((view) => runLint(view, path, spec), { delay: 800 }),
  ];
}
