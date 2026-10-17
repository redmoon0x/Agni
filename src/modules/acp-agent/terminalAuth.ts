import { IS_WINDOWS } from "@/lib/platform";
import type { AcpAgentId } from "@/modules/acp-agent/lib/agent";
import { acpAgent } from "@/modules/acp-agent/lib/agent";
import type { AcpAuthMethod } from "@/modules/acp-agent/types";

const SAFE_ARG = /^[\w./:@=+-]+$/;

function quoteArg(value: string): string {
  if (SAFE_ARG.test(value)) return value;
  if (IS_WINDOWS) return `"${value.replace(/"/g, '""')}"`;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function quoteValue(value: string): string {
  return IS_WINDOWS ? `'${value.replace(/'/g, "''")}'` : `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Builds the shell line a `type: "terminal"` auth method asks the client to
 * run: the agent's own invocation plus the method's `args`, prefixed with the
 * method's `env`. Env is set as a shell prefix rather than through the PTY so
 * no Rust-side change is needed to pass it to the interactive login.
 */
export function terminalAuthCommand(
  agent: AcpAgentId,
  method: AcpAuthMethod,
): string {
  const descriptor = acpAgent(agent);
  const argv = [descriptor.program, ...descriptor.args, ...method.args].filter(
    Boolean,
  );
  const command = argv.map(quoteArg).join(" ");
  const env = method.env.filter((entry) => entry.name);
  if (env.length === 0) return command;
  if (IS_WINDOWS) {
    // PowerShell needs explicit `$env:` assignments, terminated so the login
    // runs as its own statement.
    const assignments = env
      .map((entry) => `$env:${entry.name}=${quoteValue(entry.value)}`)
      .join("; ");
    return `${assignments}; ${command}`;
  }
  const assignments = env
    .map((entry) => `${entry.name}=${quoteValue(entry.value)}`)
    .join(" ");
  return `${assignments} ${command}`;
}

/** Human-readable hint shown once the login terminal is open. */
export function terminalAuthHint(command: string): string {
  return `Complete sign-in in the terminal (${command}), then restart the agent.`;
}