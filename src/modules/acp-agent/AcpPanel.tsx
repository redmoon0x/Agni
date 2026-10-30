import {
  Add01Icon,
  ArrowDown01Icon,
  AttachmentIcon,
  Clock01Icon,
  FileEditIcon,
  Loading03Icon,
  MoreHorizontalIcon,
  PowerIcon,
  RefreshIcon,
  Robot01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ClaudeLogoIcon } from "@/modules/acp-agent/ClaudeLogoIcon";
import { CommandCodeLogoIcon } from "@/modules/acp-agent/CommandCodeLogoIcon";
import {
  type AcpElicitationValues,
  defaultElicitationValues,
  elicitationContent,
} from "@/modules/acp-agent/elicitation";
import { HermesLogoIcon } from "@/modules/acp-agent/HermesLogoIcon";
import { KiloLogoIcon } from "@/modules/acp-agent/KiloLogoIcon";
import { type AcpAgentId, acpAgent } from "@/modules/acp-agent/lib/agent";
import { OpenCodeLogoIcon } from "@/modules/acp-agent/OpenCodeLogoIcon";
import {
  cancelAcp,
  deleteAcpSession,
  ensureAcpStarted,
  forkAcpSession,
  listAcpSessions,
  loadAcpSession,
  loginAcp,
  logoutAcp,
  newAcpSession,
  promptAcp,
  refreshAcpTerminal,
  respondToElicitation,
  respondToPermission,
  restartAcp,
  resumeAcpSession,
  setAcpConfigOption,
  setAcpMode,
  setAcpModel,
  stopAcp,
  useAcpStore,
} from "@/modules/acp-agent/store";
import type {
  AcpAttachment,
  AcpConfigOption,
  AcpDiffChange,
  AcpElicitationRequest,
  AcpMessage,
  AcpModeState,
  AcpPermissionSubject,
  AcpSessionInfo,
  AcpToolCall,
  AcpToolContent,
} from "@/modules/acp-agent/types";
import { clipboardImageFiles } from "@/modules/agent-panel/lib/clipboardImages";
import {
  formatCost,
  formatCount,
  formatTokens,
} from "@/modules/agent-panel/lib/usage";
import { AgentCard, AgentError } from "@/modules/agent-ui/Card";
import {
  AgentAttachmentChip,
  AgentAttachmentRow,
  AgentComposerFrame,
  AgentComposerIconButton,
  AgentComposerSendButton,
  AgentComposerTextarea,
  AgentSuggestionItem,
  AgentSuggestions,
} from "@/modules/agent-ui/Composer";
import { AgentConversation } from "@/modules/agent-ui/Conversation";
import { AgentEmptyState } from "@/modules/agent-ui/EmptyState";
import {
  AgentHeader,
  AgentIconButton,
  type AgentRunStatus,
  type AgentSubtitleTone,
} from "@/modules/agent-ui/Header";
import { baseName, displayPath } from "@/modules/agent-ui/lib/path";
import { AgentAssistantMessage, AgentUserMessage } from "@/modules/agent-ui/Messages";
import { AgentThinking } from "@/modules/agent-ui/Thinking";
import { AgentToolRow, type AgentToolStatus } from "@/modules/agent-ui/ToolRow";
import {
  type CommandPaletteFileHit,
  useWorkspaceFileSearch,
} from "@/modules/command-palette/useWorkspaceFileSearch";
import { usePreviewAnnotateDraftStore } from "@/modules/preview-annotate";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setAcpAdditionalDirectories } from "@/modules/settings/store";
import { type WorkspaceEnv, workspaceScopeKey } from "@/modules/workspace";

type Props = {
  agent: AcpAgentId;
  cwd: string | null;
  workspace: WorkspaceEnv;
  agentPicker?: ReactNode;
  onOpenFile?: (path: string, line?: number) => void;
};

type AtToken = { query: string; start: number };
type MentionEntry = { rel: string; path: string };

const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;

function runAcpAction(action: Promise<unknown>) {
  void action.catch((error) => {
    useAcpStore.setState({ rpcError: String(error) });
  });
}

function AgentMark({
  agent,
  size,
  className,
}: {
  agent: AcpAgentId;
  size: number;
  className?: string;
}) {
  if (agent === "opencode") {
    return <OpenCodeLogoIcon size={size} className={className} />;
  }
  if (agent === "kilo") {
    return <KiloLogoIcon size={size} className={className} />;
  }
  if (agent === "commandcode") {
    return <CommandCodeLogoIcon size={size} className={className} />;
  }
  if (agent === "claude") {
    return <ClaudeLogoIcon size={size} className={className} />;
  }
  if (agent === "hermes") {
    return <HermesLogoIcon size={size} className={className} />;
  }
  return <HugeiconsIcon icon={Robot01Icon} size={size} className={className} />;
}

function readAttachment(
  file: File,
  kind: "image" | "audio",
): Promise<AcpAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read file"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const data = result.slice(result.indexOf(",") + 1);
      if (!data) {
        reject(new Error("Could not encode file"));
        return;
      }
      resolve({
        type: kind,
        name: file.name,
        data,
        mimeType: file.type || (kind === "image" ? "image/png" : "audio/mpeg"),
      });
    };
    reader.readAsDataURL(file);
  });
}

function detectAtToken(value: string, caret: number): AtToken | null {
  const uptoCaret = value.slice(0, caret);
  const at = uptoCaret.lastIndexOf("@");
  if (at === -1) return null;
  const before = uptoCaret[at - 1];
  if (before !== undefined && !/\s/.test(before)) return null;
  const query = uptoCaret.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { query, start: at };
}

function contentKey(content: AcpToolContent): string {
  if (content.type === "diff")
    return `diff:${content.path}:${content.changes.length}:${content.patch?.length ?? 0}`;
  if (content.type === "terminal") return `terminal:${content.terminalId}`;
  if (content.type === "content")
    return `content:${content.content.text ?? ""}`;
  return `unknown:${JSON.stringify(content.value)}`;
}

function DiffChangeList({ changes }: { changes: AcpDiffChange[] }) {
  if (changes.length === 0) return null;
  return (
    <ul className="space-y-0.5 px-2.5 pt-1.5 font-mono text-[10px]">
      {changes.map((change) => (
        <li
          key={`${change.operation}:${change.oldPath ?? ""}:${change.path}`}
          className="flex items-baseline gap-1.5"
        >
          <span
            className={cn(
              "shrink-0 uppercase",
              change.operation === "delete" && "text-destructive",
              change.operation === "add" &&
                "text-[var(--terminal-ansi-green)]",
              (change.operation === "modify" ||
                change.operation === "move" ||
                change.operation === "copy") && "text-primary",
              change.operation !== "delete" &&
                change.operation !== "add" &&
                change.operation !== "modify" &&
                change.operation !== "move" &&
                change.operation !== "copy" &&
                "text-muted-foreground",
            )}
          >
            {change.operation}
          </span>
          <span className="min-w-0 flex-1 break-all text-muted-foreground">
            {change.oldPath ? `${change.oldPath} -> ${change.path}` : change.path}
          </span>
          {change.fileType && change.fileType !== "text" ? (
            <span className="shrink-0 text-muted-foreground/70">
              {change.fileType}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ToolContentItem({
  content,
  cwd,
  onOpenPath,
}: {
  content: AcpToolContent;
  cwd?: string | null;
  onOpenPath?: (path: string) => void;
}) {
  if (content.type === "diff") {
    // v2 reports `changes` plus an optional git patch; there is no
    // old/new text pair, so the patch (or the change list) carries the render.
    const binary =
      content.changes.length > 0 &&
      content.changes.every((change) => change.fileType && change.fileType !== "text");
    return (
      <div className="border-t border-border/40">
        <div className="px-2.5 pt-1.5 font-mono text-[10px] text-muted-foreground">
          {onOpenPath ? (
            <button
              type="button"
              onClick={() => onOpenPath(content.path)}
              title={content.path}
              className="max-w-full truncate text-left hover:text-foreground hover:underline"
            >
              {displayPath(content.path, cwd ?? null)}
            </button>
          ) : (
            <span className="block truncate" title={content.path}>
              {displayPath(content.path, cwd ?? null)}
            </span>
          )}
        </div>
        <DiffChangeList changes={content.changes} />
        {binary ? (
          <p className="px-2.5 pt-1.5 text-[10px] text-muted-foreground">
            Binary change, no text preview.
          </p>
        ) : null}
        {content.oldText !== null ? (
          <pre className="select-text max-h-32 overflow-auto border-b border-destructive/10 bg-destructive/[0.025] px-2.5 py-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-destructive/80">
            {content.oldText}
          </pre>
        ) : null}
        {content.patch ? (
          <pre className="select-text max-h-48 overflow-auto border-t border-border/40 px-2.5 py-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {content.patch}
          </pre>
        ) : content.oldText === null && !binary ? (
          <pre className="select-text max-h-48 overflow-auto px-2.5 py-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {content.newText || "File deleted"}
          </pre>
        ) : null}
      </div>
    );
  }
  if (content.type === "content") {
    return <ContentBlockView content={content.content} compact />;
  }
  if (content.type === "terminal") {
    return <TerminalOutput terminalId={content.terminalId} />;
  }
  return null;
}

function TerminalOutput({ terminalId }: { terminalId: string }) {
  const terminal = useAcpStore((state) => state.terminals[terminalId]);
  const polling =
    terminal === undefined ||
    (terminal.source !== "agent" && terminal.state !== "exited");
  useEffect(() => {
    if (!polling) return;
    void refreshAcpTerminal(terminalId);
    const timer = window.setInterval(() => {
      void refreshAcpTerminal(terminalId);
    }, 900);
    return () => window.clearInterval(timer);
  }, [polling, terminalId]);
  if (!terminal) {
    return (
      <div className="border-t border-border/40 px-2.5 py-2 font-mono text-[10px] text-muted-foreground">
        terminal {terminalId}
      </div>
    );
  }
  return (
    <div className="border-t border-border/40">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2.5 pt-1.5 font-mono text-[10px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {terminal.title ?? terminal.command ?? terminalId}
        </span>
        {terminal.cwd ? (
          <span className="min-w-0 truncate text-muted-foreground/70" title={terminal.cwd}>
            {terminal.cwd}
          </span>
        ) : null}
        {terminal.state ? <span>{terminal.state}</span> : null}
        {terminal.exitCode !== null ? (
          <span>exit {terminal.exitCode}</span>
        ) : null}
        {terminal.signal ? <span>{terminal.signal}</span> : null}
      </div>
      {terminal.output ? (
        <pre className="select-text max-h-48 overflow-auto px-2.5 py-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {terminal.output}
        </pre>
      ) : null}
    </div>
  );
}

function ContentBlockView({
  content,
  compact = false,
}: {
  content: AcpMessage["content"][number];
  compact?: boolean;
}) {
  const resource = content.resource;
  if (content.type === "text") {
    if (!content.text || !compact) return null;
    return (
      <pre className="select-text max-h-48 overflow-auto border-t border-border/40 px-2.5 py-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
        {content.text}
      </pre>
    );
  }
  if (content.type === "image" && content.data && content.mimeType) {
    return (
      <img
        src={`data:${content.mimeType};base64,${content.data}`}
        alt={content.name ?? "Agent supplied image"}
        className="mt-2 max-h-72 max-w-full rounded-md border border-border/50 object-contain"
      />
    );
  }
  if (content.type === "audio" && content.data && content.mimeType) {
    return (
      // biome-ignore lint/a11y/useMediaCaption: agent audio data URIs cannot carry a caption track
      <audio controls className="mt-2 max-w-full">
        <source
          src={`data:${content.mimeType};base64,${content.data}`}
          type={content.mimeType}
        />
      </audio>
    );
  }
  if (content.type === "resource" && resource) {
    const text = typeof resource.text === "string" ? resource.text : null;
    const uri = typeof resource.uri === "string" ? resource.uri : "Resource";
    return text ? (
      <details className="mt-2 rounded-md border border-border/50 px-2.5 py-1.5 text-[10px]">
        <summary className="cursor-pointer text-muted-foreground">
          {uri}
        </summary>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap">
          {text}
        </pre>
      </details>
    ) : (
      <span className="mt-2 block text-[10px] text-muted-foreground">
        {uri}
      </span>
    );
  }
  if (content.type === "resource_link" && content.uri) {
    return (
      <span
        className="mt-2 block truncate text-[10px] text-muted-foreground"
        title={content.uri}
      >
        {content.name ?? content.uri}
      </span>
    );
  }
  return null;
}

const ACP_TOOL_STATUS: Record<AcpToolCall["status"], AgentToolStatus> = {
  pending: "pending",
  in_progress: "running",
  completed: "success",
  failed: "error",
  cancelled: "cancelled",
};

function ToolRow({
  tool,
  cwd,
  onOpenPath,
}: {
  tool: AcpToolCall;
  cwd: string | null;
  onOpenPath?: (path: string, line?: number) => void;
}) {
  const location = tool.locations[0];
  return (
    <AgentToolRow
      title={tool.title || tool.name || tool.kind}
      subtitle={location ? displayPath(location.path, cwd) : null}
      kind={tool.kind}
      status={ACP_TOOL_STATUS[tool.status] ?? "pending"}
      meta={tool.name}
      path={location?.path}
      line={location?.line}
      onOpenPath={onOpenPath}
      detail={
        tool.content.length > 0 ? (
          <div>
            {tool.content.map((content) => (
              <ToolContentItem
                key={contentKey(content)}
                content={content}
                cwd={cwd}
                onOpenPath={
                  onOpenPath ? (path) => onOpenPath(path) : undefined
                }
              />
            ))}
          </div>
        ) : null
      }
    />
  );
}

function Message({ message }: { message: AcpMessage }) {
  const extras = message.content
    .filter((content) => content.type !== "text")
    .map((content, index) => (
      <ContentBlockView key={`${content.type}-${index}`} content={content} />
    ));

  if (message.role === "thought") {
    return (
      <AgentThinking text={message.text}>
        {extras.length > 0 ? (
          <div className="mt-2 space-y-1">{extras}</div>
        ) : null}
      </AgentThinking>
    );
  }
  if (message.role === "user") {
    return <AgentUserMessage text={message.text}>{extras}</AgentUserMessage>;
  }
  return (
    <AgentAssistantMessage text={message.text}>{extras}</AgentAssistantMessage>
  );
}

function PlanList() {
  const plan = useAcpStore((state) => state.plan);
  const planId = useAcpStore((state) => state.planId);
  const [open, setOpen] = useState(true);
  if (plan.length === 0) return null;
  const done = plan.filter((entry) => entry.status === "completed").length;
  return (
    <div className="mx-2 mb-2 rounded-lg border border-border/60 bg-foreground/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
        aria-expanded={open}
      >
        <span className="text-[10px] font-medium tracking-wide uppercase">
          Plan
        </span>
        {planId ? (
          <span
            className="min-w-0 flex-1 truncate font-mono text-[9px] text-muted-foreground/70"
            title={planId}
          >
            {planId}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <span className="text-[10px] text-muted-foreground">
          {done}/{plan.length}
        </span>
        <span className="flex-1" />
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={12}
          className={cn(
            "text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      <div className="mx-2.5 h-0.5 overflow-hidden rounded-full bg-foreground/[0.05]">
        <div
          className="h-full rounded-full bg-primary/70 transition-[width]"
          style={{ width: `${Math.round((done / plan.length) * 100)}%` }}
        />
      </div>
      {open ? (
        <div className="space-y-1 px-2.5 pb-2">
          {plan.map((entry) => (
            <div key={entry.content} className="flex items-start gap-2">
              <span
                className={cn(
                  "mt-1 size-1.5 shrink-0 rounded-full",
                  entry.status === "completed" && "bg-muted-foreground/40",
                  entry.status === "in_progress" && "animate-pulse bg-primary",
                  (!entry.status || entry.status === "pending") &&
                    "border border-muted-foreground/40",
                )}
              />
              <span
                className={cn(
                  "text-[11px] leading-relaxed",
                  entry.status === "completed" &&
                    "text-muted-foreground line-through",
                )}
              >
                {entry.content}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PermissionSubjectDetail({ subject }: { subject: AcpPermissionSubject }) {
  if (subject.type === "tool_call") {
    const tool = subject.toolCall;
    if (!tool.title && !tool.name) return null;
    return (
      <div className="mt-1 text-[10px] text-muted-foreground">
        <span className="font-medium text-foreground/80">
          {tool.title || tool.name}
        </span>
        {tool.name && tool.title ? (
          <span className="ml-1.5 font-mono text-muted-foreground/70">
            {tool.name}
          </span>
        ) : null}
      </div>
    );
  }
  if (subject.type === "command") {
    return (
      <div className="mt-1.5 rounded-md border border-border/60 bg-background/60 px-2 py-1.5">
        <div className="truncate font-mono text-[10px]">{subject.command}</div>
        <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
          {subject.cwd}
        </div>
      </div>
    );
  }
  return (
    <div className="mt-1.5 rounded-md border border-border/60 bg-background/60 px-2 py-1.5 font-mono text-[10px] text-muted-foreground break-all">
      {JSON.stringify(subject.value)}
    </div>
  );
}

function PermissionPrompt() {
  const permission = useAcpStore((state) => state.permission);
  if (!permission) return null;
  return (
    <AgentCard
      eyebrow="Permission"
      title={permission.title ?? "The agent wants to run a tool"}
      description={permission.description}
      tone="primary"
    >
      {permission.subject ? (
        <div className="mb-2">
          <PermissionSubjectDetail subject={permission.subject} />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {permission.options.map((option) => (
          <button
            key={option.optionId}
            type="button"
            onClick={() => respondToPermission(option.optionId)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-[11px] transition-colors",
              option.kind.startsWith("reject")
                ? "border-border text-muted-foreground hover:bg-foreground/[0.05]"
                : "border-primary/40 bg-primary/10 text-foreground hover:bg-primary/20",
            )}
          >
            {option.name}
          </button>
        ))}
      </div>
    </AgentCard>
  );
}

function ElicitationForm({
  elicitation,
}: {
  elicitation: Extract<AcpElicitationRequest, { mode: "form" }>;
}) {
  const [values, setValues] = useState<AcpElicitationValues>(() =>
    defaultElicitationValues(elicitation.fields),
  );
  const [invalid, setInvalid] = useState(false);
  const submit = () => {
    const content = elicitationContent(elicitation.fields, values);
    if (!content) {
      setInvalid(true);
      return;
    }
    respondToElicitation("accept", content);
  };

  return (
    <AgentCard
      eyebrow="Input required"
      title={elicitation.title ?? "The agent needs information"}
      description={elicitation.message}
      tone="primary"
    >
      <div className="space-y-2.5">
        {elicitation.fields.map((field) => {
          const id = `elicitation-${String(elicitation.id)}-${field.name}`;
          const value = values[field.name];
          return (
            <div key={field.name} className="space-y-1">
              {field.type === "boolean" ? (
                <label
                  htmlFor={id}
                  className="flex cursor-pointer items-center gap-2 text-[11px]"
                >
                  <input
                    id={id}
                    type="checkbox"
                    checked={value === true}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field.name]: event.target.checked,
                      }))
                    }
                  />
                  {field.title}
                </label>
              ) : (
                <>
                  <label htmlFor={id} className="block text-[11px] font-medium">
                    {field.title}
                    {field.required ? " *" : ""}
                  </label>
                  {field.type === "select" ? (
                    <select
                      id={id}
                      value={typeof value === "string" ? value : ""}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [field.name]: event.target.value,
                        }))
                      }
                      className="h-8 w-full rounded-md border border-border/70 bg-background px-2 text-[11px] outline-none focus:border-primary/70"
                    >
                      <option value="">Select an option</option>
                      {field.choices.map((choice) => (
                        <option key={choice.id} value={choice.id}>
                          {choice.name}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "multiselect" ? (
                    <div className="space-y-1 rounded-md border border-border/70 bg-background px-2 py-1.5">
                      {field.choices.map((choice) => {
                        const selected = Array.isArray(value)
                          ? value.includes(choice.id)
                          : false;
                        const optionId = `${id}-${choice.id}`;
                        return (
                          <label
                            key={choice.id}
                            htmlFor={optionId}
                            className="flex cursor-pointer items-center gap-2 text-[11px]"
                          >
                            <input
                              id={optionId}
                              type="checkbox"
                              checked={selected}
                              onChange={(event) =>
                                setValues((current) => {
                                  const existing = current[field.name];
                                  const ids = Array.isArray(existing) ? existing : [];
                                  return {
                                    ...current,
                                    [field.name]: event.target.checked
                                      ? [...ids, choice.id]
                                      : ids.filter((item) => item !== choice.id),
                                  };
                                })
                              }
                            />
                            {choice.name}
                          </label>
                        );
                      })}
                    </div>
                  ) : field.type === "json" ? (
                    <textarea
                      id={id}
                      rows={4}
                      spellCheck={false}
                      value={typeof value === "string" ? value : ""}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [field.name]: event.target.value,
                        }))
                      }
                      placeholder={'{ "key": "value" }'}
                      className="w-full resize-y rounded-md border border-border/70 bg-background px-2 py-1.5 font-mono text-[11px] outline-none focus:border-primary/70"
                    />
                  ) : (
                    <input
                      id={id}
                      type={field.type === "string" ? "text" : "number"}
                      step={field.type === "integer" ? "1" : "any"}
                      value={typeof value === "string" ? value : ""}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [field.name]: event.target.value,
                        }))
                      }
                      className="h-8 w-full rounded-md border border-border/70 bg-background px-2 text-[11px] outline-none focus:border-primary/70"
                    />
                  )}
                </>
              )}
              {field.description ? (
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  {field.description}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      {invalid ? (
        <p className="mt-2 text-[10px] text-destructive">
          Complete the required fields with valid values.
        </p>
      ) : null}
      <div className="mt-3 flex gap-1.5">
        <button
          type="button"
          onClick={submit}
          className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-primary/20"
        >
          Continue
        </button>
        <button
          type="button"
          onClick={() => respondToElicitation("cancel")}
          className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.05]"
        >
          Cancel
        </button>
      </div>
    </AgentCard>
  );
}

function ElicitationPrompt() {
  const elicitation = useAcpStore((state) => state.elicitation);
  if (!elicitation) return null;
  if (elicitation.mode === "url") {
    return (
      <UrlElicitation key={String(elicitation.id)} elicitation={elicitation} />
    );
  }
  if (elicitation.mode === "other") {
    return <OpaqueElicitation elicitation={elicitation} />;
  }
  return (
    <ElicitationForm key={String(elicitation.id)} elicitation={elicitation} />
  );
}

/** `_`-prefixed and future elicitation modes are never rendered as a known
 *  mode. The user can still decline, and the raw payload is preserved. */
function OpaqueElicitation({
  elicitation,
}: {
  elicitation: Extract<AcpElicitationRequest, { mode: "other" }>;
}) {
  return (
    <AgentCard
      eyebrow="Input requested"
      title="Unsupported request"
      description={elicitation.message}
    >
      <p className="font-mono text-[10px] text-muted-foreground">
        mode: {elicitation.rawMode || "(unspecified)"}
      </p>
      <button
        type="button"
        onClick={() => respondToElicitation("decline")}
        className="mt-2.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.05]"
      >
        Decline
      </button>
    </AgentCard>
  );
}

function UrlElicitation({
  elicitation,
}: {
  elicitation: Extract<AcpElicitationRequest, { mode: "url" }>;
}) {
  let host = elicitation.url;
  try {
    host = new URL(elicitation.url).host;
  } catch {
    // Keep the raw value when the URL cannot be parsed.
  }
  const respond = (action: "accept" | "decline" | "cancel") => {
    if (action === "accept") {
      void openUrl(elicitation.url).catch(() => {});
    }
    respondToElicitation(action);
  };
  return (
    <AgentCard
      eyebrow="Open link"
      title={elicitation.title ?? "The agent wants to open a link"}
      description={elicitation.message}
      tone="primary"
    >
      <div className="rounded-md border border-border/60 bg-background/60 px-2 py-1.5">
        <div className="text-[10px] text-muted-foreground">
          Opens in your browser:{" "}
          <span className="font-medium text-foreground">{host}</span>
        </div>
        <div className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">
          {elicitation.url}
        </div>
      </div>
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          onClick={() => respond("accept")}
          className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-primary/20"
        >
          Open link
        </button>
        <button
          type="button"
          onClick={() => respond("decline")}
          className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.05]"
        >
          Decline
        </button>
        <button
          type="button"
          onClick={() => respond("cancel")}
          className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.05]"
        >
          Cancel
        </button>
      </div>
    </AgentCard>
  );
}

function ConfigSelect({ option }: { option: AcpConfigOption }) {
  const current =
    option.options.find((value) => value.value === option.currentValue)?.name ??
    option.name;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={option.name}
          className="max-w-32 truncate rounded-md px-1.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
        >
          {current}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        className="max-h-80 w-56 overflow-y-auto"
      >
        <DropdownMenuLabel>{option.name}</DropdownMenuLabel>
        {option.options.map((value) => (
          <DropdownMenuItem
            key={value.value}
            onSelect={() =>
              runAcpAction(setAcpConfigOption(option.id, value.value))
            }
          >
            <span className="min-w-0 flex-1 truncate">{value.name}</span>
            {value.value === option.currentValue ? (
              <HugeiconsIcon icon={Tick02Icon} className="ml-auto" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ConfigToggle({ option }: { option: AcpConfigOption }) {
  const on = option.currentValue === true;
  return (
    <button
      type="button"
      title={option.name}
      onClick={() => runAcpAction(setAcpConfigOption(option.id, !on))}
      className={cn(
        "rounded-md px-1.5 py-1 text-[10px] font-medium hover:bg-foreground/[0.05]",
        on ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {option.name}
    </button>
  );
}

function ModeSelect({ modeState }: { modeState: AcpModeState }) {
  const current = useAcpStore((state) => state.currentMode);
  const active =
    modeState.availableModes.find((mode) => mode.id === current) ??
    modeState.availableModes[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Session mode"
          className="max-w-32 truncate rounded-md px-1.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
        >
          {active?.name ?? "Mode"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-56">
        <DropdownMenuLabel>Mode</DropdownMenuLabel>
        {modeState.availableModes.map((mode) => (
          <DropdownMenuItem
            key={mode.id}
            onSelect={() => runAcpAction(setAcpMode(mode.id))}
          >
            <span className="min-w-0 flex-1 truncate">{mode.name}</span>
            {mode.id === active?.id ? (
              <HugeiconsIcon icon={Tick02Icon} className="ml-auto" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelPicker({
  label,
  options,
  currentValue,
  onSelect,
}: {
  label: string;
  options: { value: string; name: string }[];
  currentValue: string;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const current = options.find((value) => value.value === currentValue);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? options.filter((value) =>
        `${value.name} ${value.value}`.toLowerCase().includes(needle),
      )
    : options;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title={label}
          className="max-w-40 truncate rounded-md px-1.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
        >
          {current?.name ?? label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={6}
        collisionPadding={8}
        className="w-72 overflow-hidden rounded-2xl p-2"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search models..."
          className="mb-1.5 w-full rounded-md border border-border/70 bg-transparent px-2 py-1.5 text-[12px] outline-none placeholder:text-muted-foreground/70"
        />
        <div
          className="min-h-0 overflow-y-auto overscroll-contain"
          style={{ maxHeight: "min(60vh, 18rem)" }}
        >
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
              No models found.
            </p>
          ) : (
            filtered.map((value) => (
              <button
                key={value.value}
                type="button"
                onClick={() => {
                  onSelect(value.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-accent hover:text-accent-foreground",
                  value.value === currentValue && "font-medium",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{value.name}</span>
                {value.value === currentValue ? (
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    className="ml-auto shrink-0"
                  />
                ) : null}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatSessionTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function SessionActions({ sessionId }: { sessionId: string }) {
  const capabilities = useAcpStore((state) => state.capabilities);
  if (
    !capabilities.sessionResume &&
    !capabilities.sessionDelete &&
    !capabilities.sessionFork
  ) {
    return null;
  }
  return (
    <div className="mr-1 flex shrink-0 items-center gap-1">
      {capabilities.sessionResume ? (
        <button
          type="button"
          title="Resume without replaying history"
          onClick={() => runAcpAction(resumeAcpSession(sessionId))}
          className="rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"
        >
          Resume
        </button>
      ) : null}
      {capabilities.sessionFork ? (
        <button
          type="button"
          title="Fork this session into a new one"
          onClick={() => runAcpAction(forkAcpSession(sessionId))}
          className="rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"
        >
          Fork
        </button>
      ) : null}
      {capabilities.sessionDelete ? (
        <button
          type="button"
          title="Delete session"
          onClick={() => runAcpAction(deleteAcpSession(sessionId))}
          className="rounded px-1.5 py-1 text-[10px] text-destructive/80 hover:bg-destructive/10"
        >
          Delete
        </button>
      ) : null}
    </div>
  );
}

function SessionSwitcherDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const currentId = useAcpStore((state) => state.sessionId);
  const [sessions, setSessions] = useState<AcpSessionInfo[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSessions(null);
    setNextCursor(null);
    setLoadingMore(false);
    setQuery("");
    void listAcpSessions()
      .then((page) => {
        if (cancelled) return;
        setSessions(page.sessions);
        setNextCursor(page.nextCursor);
      })
      .catch((error) => {
        if (cancelled) return;
        useAcpStore.setState({ rpcError: String(error) });
        setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const loadMore = () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    void listAcpSessions(nextCursor)
      .then((page) => {
        setSessions((current) => {
          const existing = new Set(
            (current ?? []).map((session) => session.sessionId),
          );
          return [
            ...(current ?? []),
            ...page.sessions.filter(
              (session) => !existing.has(session.sessionId),
            ),
          ];
        });
        setNextCursor(page.nextCursor);
      })
      .catch((error) => {
        useAcpStore.setState({ rpcError: String(error) });
      })
      .finally(() => setLoadingMore(false));
  };

  const needle = query.trim().toLowerCase();
  const filtered =
    sessions === null
      ? null
      : needle
        ? sessions.filter((session) =>
            `${session.title ?? ""} ${session.sessionId} ${session.cwd ?? ""}`
              .toLowerCase()
              .includes(needle),
          )
        : sessions;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-3">
        <DialogHeader className="sr-only">
          <DialogTitle>Sessions</DialogTitle>
          <DialogDescription>Switch to a previous session</DialogDescription>
        </DialogHeader>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search sessions..."
          className="w-full rounded-md border border-border/70 bg-transparent px-2.5 py-1.5 text-[12px] outline-none placeholder:text-muted-foreground/70"
        />
        <div
          className="min-h-0 overflow-y-auto overscroll-contain"
          style={{ maxHeight: "min(60vh, 22rem)" }}
        >
          {filtered === null ? (
            <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
              Loading sessions...
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
              No sessions found.
            </p>
          ) : (
            filtered.map((session) => (
              <div
                key={session.sessionId}
                className={cn(
                  "flex items-center rounded-md hover:bg-accent hover:text-accent-foreground",
                  session.sessionId === currentId && "bg-foreground/[0.05]",
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    runAcpAction(loadAcpSession(session.sessionId));
                    onOpenChange(false);
                  }}
                  className="flex min-w-0 flex-1 flex-col gap-0.5 px-2.5 py-2 text-left"
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                      {session.title || session.sessionId}
                    </span>
                    {session.sessionId === currentId ? (
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        size={12}
                        className="shrink-0"
                      />
                    ) : null}
                  </span>
                  <span className="flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
                    {session.cwd ? (
                      <span className="min-w-0 truncate">{session.cwd}</span>
                    ) : null}
                    {session.updatedAt ? (
                      <span className="shrink-0">
                        {formatSessionTime(session.updatedAt)}
                      </span>
                    ) : null}
                  </span>
                </button>
                <SessionActions sessionId={session.sessionId} />
              </div>
            ))
          )}
          {nextCursor && !needle && filtered !== null ? (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-1 w-full rounded-md border border-border/60 px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-50"
            >
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExtraFoldersDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const directories = usePreferencesStore(
    (state) => state.acpAdditionalDirectories,
  );
  const canRestart = useAcpStore((state) => state.sessionConfig !== null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async (next: string[]) => {
    setError(null);
    try {
      await setAcpAdditionalDirectories(next);
    } catch (cause) {
      setError(String(cause));
    }
  };

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    if (!/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(value)) {
      setError("Enter an absolute path.");
      return;
    }
    if (directories.some((dir) => dir.toLowerCase() === value.toLowerCase())) {
      setError("That folder is already included.");
      return;
    }
    void save([...directories, value]);
    setDraft("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Extra folders</DialogTitle>
          <DialogDescription>
            Additional workspace roots for agent sessions, beyond the project
            folder. Applied when a session starts; agents without the additional
            directories capability ignore them.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-1.5">
          <input
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            placeholder="Absolute folder path"
            className="min-w-0 flex-1 rounded-md border border-border/70 bg-transparent px-2.5 py-1.5 text-[12px] outline-none placeholder:text-muted-foreground/70"
          />
          <Button
            type="button"
            size="sm"
            className="shrink-0 text-[11px]"
            onClick={add}
          >
            Add
          </Button>
        </div>
        {directories.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-[12px] text-muted-foreground">
            No extra folders.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {directories.map((directory) => (
              <div
                key={directory}
                className="flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                  {directory}
                </span>
                <Button
                  type="button"
                  variant="destructive"
                  size="xs"
                  className="text-[11px]"
                  onClick={() =>
                    void save(
                      directories.filter((entry) => entry !== directory),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
        {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-muted-foreground">
            Files and terminal commands outside the session roots are rejected.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5 px-2.5 text-[11px]"
            disabled={!canRestart}
            onClick={() => void restartAcp().catch(() => {})}
          >
            <HugeiconsIcon icon={RefreshIcon} size={12} strokeWidth={2} />
            Restart agent
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AcpComposer({
  agent,
  root,
}: {
  agent: AcpAgentId;
  root: string | null;
}) {
  const connection = useAcpStore((state) => state.connection);
  const isStreaming = useAcpStore((state) => state.isStreaming);
  const capabilities = useAcpStore((state) => state.capabilities);
  const configOptions = useAcpStore((state) => state.configOptions);
  const modeState = useAcpStore((state) => state.modeState);
  const modelState = useAcpStore((state) => state.modelState);
  const commands = useAcpStore((state) => state.commands);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [atToken, setAtToken] = useState<AtToken | null>(null);
  const [atHighlight, setAtHighlight] = useState(0);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [mentions, setMentions] = useState<MentionEntry[]>([]);
  const [attachments, setAttachments] = useState<AcpAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Pick up an annotation draft (preview → agent) staged for this agent.
  useEffect(() => {
    const draft = usePreviewAnnotateDraftStore.getState().consumeFor(agent);
    if (draft) {
      setInput(draft);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [agent]);

  const canMention = capabilities.promptEmbeddedContext;
  const canAttach = capabilities.promptImage || capabilities.promptAudio;
  const attachmentAccept = [
    capabilities.promptImage ? "image/*" : null,
    capabilities.promptAudio ? "audio/*" : null,
  ]
    .filter(Boolean)
    .join(",");
  const slashQuery = /^\/(\S*)$/.exec(input)?.[1];
  const commandSuggestions =
    slashQuery === undefined
      ? []
      : commands
          .filter((command) =>
            command.name.toLowerCase().startsWith(slashQuery.toLowerCase()),
          )
          .slice(0, 8);

  const { results: fileHits } = useWorkspaceFileSearch({
    root,
    query: atToken?.query ?? "",
    enabled: atToken !== null && canMention,
    minQueryLength: 1,
    listOnEmpty: true,
  });

  const modelOption = configOptions.find(
    (option) => option.category === "model" && option.type === "select",
  );
  const thoughtOption = configOptions.find(
    (option) => option.category === "thought_level" && option.type === "select",
  );
  const modeOption = configOptions.find(
    (option) => option.category === "mode" && option.type === "select",
  );
  const modelConfigOptions = configOptions.filter(
    (option) => option.category === "model_config",
  );
  const otherOptions = configOptions.filter(
    (option) =>
      option !== modelOption &&
      option !== thoughtOption &&
      option !== modeOption &&
      !modelConfigOptions.includes(option),
  );
  const showModeSelect = !modeOption && modeState !== null;
  // Agents expose models either as a `model` config option or as an ACP
  // `SessionModelState` catalog. The config option wins when both are present.
  const showModelSelect = !modelOption && modelState !== null;

  const applyCommand = (name: string) => {
    setInput(`/${name} `);
    setHighlightIndex(0);
  };

  const applyMention = (hit: CommandPaletteFileHit | undefined) => {
    if (!atToken || !hit) return;
    const before = input.slice(0, atToken.start);
    const after = input.slice(atToken.start + 1 + atToken.query.length);
    const mention = `@${hit.rel} `;
    setInput(`${before}${mention}${after}`);
    setMentions((current) => [
      ...current.filter((entry) => entry.rel !== hit.rel),
      { rel: hit.rel, path: hit.path },
    ]);
    setAtToken(null);
    requestAnimationFrame(() => {
      const pos = before.length + mention.length;
      textareaRef.current?.setSelectionRange(pos, pos);
      textareaRef.current?.focus();
    });
  };

  const submit = async () => {
    const text = input.trim();
    const usedMentions = canMention
      ? mentions.filter((entry) => input.includes(`@${entry.rel}`))
      : [];
    if (
      (!text && attachments.length === 0 && usedMentions.length === 0) ||
      connection !== "ready" ||
      sending
    ) {
      return;
    }
    setInput("");
    setAtToken(null);
    setAttachments([]);
    setMentions([]);
    setSending(true);
    try {
      await promptAcp({
        text: text || "Analyze the attached context.",
        mentions: usedMentions,
        attachments: canAttach ? attachments : [],
      });
    } catch (error) {
      setInput(text);
      setMentions(usedMentions);
      useAcpStore.setState({ rpcError: String(error) });
    } finally {
      setSending(false);
    }
  };

  const addAttachments = async (files: FileList | readonly File[] | null) => {
    if (!files?.length) return;
    const nextFiles = Array.from(files).flatMap(
      (file): { file: File; kind: "image" | "audio" }[] => {
        if (file.type.startsWith("image/") && capabilities.promptImage) {
          return [{ file, kind: "image" }];
        }
        if (file.type.startsWith("audio/") && capabilities.promptAudio) {
          return [{ file, kind: "audio" }];
        }
        return [];
      },
    );
    if (nextFiles.length !== files.length) {
      useAcpStore.setState({
        rpcError: "This agent does not accept that attachment type.",
      });
    }
    const available = MAX_ATTACHMENTS - attachments.length;
    const selected = nextFiles.slice(0, available);
    const currentBytes = attachments.reduce(
      (total, attachment) =>
        total + Math.ceil((attachment.data.length * 3) / 4),
      0,
    );
    const accepted: { file: File; kind: "image" | "audio" }[] = [];
    let totalBytes = currentBytes;
    for (const entry of selected) {
      if (totalBytes + entry.file.size > MAX_ATTACHMENT_BYTES) break;
      accepted.push(entry);
      totalBytes += entry.file.size;
    }
    if (accepted.length !== selected.length || nextFiles.length > available) {
      useAcpStore.setState({
        rpcError: "Up to 4 attachments with a combined size of 6 MB.",
      });
    }
    try {
      const next = await Promise.all(
        accepted.map((entry) => readAttachment(entry.file, entry.kind)),
      );
      setAttachments((current) => [...current, ...next]);
    } catch (error) {
      useAcpStore.setState({ rpcError: String(error) });
    } finally {
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  const handleImagePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!capabilities.promptImage) return;
    const images = clipboardImageFiles(event.clipboardData);
    if (images.length === 0) return;
    event.preventDefault();
    void addAttachments(images);
  };

  const safeAtHighlight =
    fileHits.length > 0 ? Math.min(atHighlight, fileHits.length - 1) : 0;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (atToken && fileHits.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setAtHighlight((safeAtHighlight + 1) % fileHits.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setAtHighlight(
          (safeAtHighlight - 1 + fileHits.length) % fileHits.length,
        );
        return;
      }
      if (
        (event.key === "Enter" || event.key === "Tab") &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        applyMention(fileHits[safeAtHighlight]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setAtToken(null);
        return;
      }
    }
    if (commandSuggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightIndex((index) => (index + 1) % commandSuggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightIndex(
          (index) =>
            (index - 1 + commandSuggestions.length) % commandSuggestions.length,
        );
        return;
      }
      if (
        (event.key === "Enter" || event.key === "Tab") &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        applyCommand(commandSuggestions[highlightIndex].name);
        return;
      }
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submit();
    }
  };

  const placeholder = `Ask ${acpAgent(agent).label} to work on something${
    canMention ? "... (@ to reference a file)" : "..."
  }`;
  const attachmentLabel =
    capabilities.promptImage && capabilities.promptAudio
      ? "Attach an image or audio clip"
      : capabilities.promptImage
        ? "Choose or paste an image"
        : "Attach an audio clip";
  const suggestions =
    atToken && fileHits.length > 0 ? (
      <AgentSuggestions className="max-h-56 overflow-y-auto">
        {fileHits.map((hit, index) => (
          <AgentSuggestionItem
            key={hit.path}
            active={index === safeAtHighlight}
            onClick={() => applyMention(hit)}
          >
            <HugeiconsIcon
              icon={FileEditIcon}
              size={12}
              strokeWidth={1.75}
              className="shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 flex-1 truncate">{hit.name}</span>
            <span className="min-w-0 max-w-40 shrink-0 truncate text-[10px] text-muted-foreground">
              {hit.rel}
            </span>
          </AgentSuggestionItem>
        ))}
      </AgentSuggestions>
    ) : commandSuggestions.length > 0 ? (
      <AgentSuggestions>
        {commandSuggestions.map((command, index) => (
          <AgentSuggestionItem
            key={command.name}
            active={index === highlightIndex}
            onClick={() => applyCommand(command.name)}
          >
            <span className="font-medium">/{command.name}</span>
            {command.description ? (
              <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
                {command.description}
              </span>
            ) : null}
          </AgentSuggestionItem>
        ))}
      </AgentSuggestions>
    ) : undefined;
  const attachmentRow =
    attachments.length > 0 ? (
      <AgentAttachmentRow>
        {attachments.map((attachment) => (
          <AgentAttachmentChip
            key={`${attachment.name}-${attachment.data.length}`}
            name={attachment.name}
            badge={attachment.type === "audio" ? "audio" : undefined}
            preview={
              attachment.type === "image" ? (
                <img
                  src={`data:${attachment.mimeType};base64,${attachment.data}`}
                  alt=""
                  className="size-4 rounded-sm object-cover"
                />
              ) : undefined
            }
            onRemove={() =>
              setAttachments((current) =>
                current.filter((candidate) => candidate !== attachment),
              )
            }
          />
        ))}
      </AgentAttachmentRow>
    ) : undefined;

  return (
    <AgentComposerFrame
      suggestions={suggestions}
      attachments={attachmentRow}
      input={
        <AgentComposerTextarea
          ref={textareaRef}
          value={input}
          onChange={(event) => {
            const value = event.target.value;
            setInput(value);
            setHighlightIndex(0);
            setAtHighlight(0);
            setAtToken(
              canMention
                ? detectAtToken(
                    value,
                    event.target.selectionStart ?? value.length,
                  )
                : null,
            );
          }}
          onKeyDown={handleKeyDown}
          onPaste={canAttach ? handleImagePaste : undefined}
          placeholder={placeholder}
          disabled={connection !== "ready"}
        />
      }
      toolbar={
        <>
          {canAttach ? (
            <>
              <input
                ref={imageInputRef}
                type="file"
                accept={attachmentAccept}
                multiple
                className="sr-only"
                onChange={(event) => void addAttachments(event.target.files)}
              />
              <AgentComposerIconButton
                label={attachmentLabel}
                disabled={attachments.length >= MAX_ATTACHMENTS}
                onClick={() => imageInputRef.current?.click()}
              >
                <HugeiconsIcon
                  icon={AttachmentIcon}
                  size={14}
                  strokeWidth={1.8}
                />
              </AgentComposerIconButton>
            </>
          ) : null}
          <span className="min-w-0 flex-1" />
          {modelOption ? (
            <ModelPicker
              label={modelOption.name}
              options={modelOption.options}
              currentValue={String(modelOption.currentValue)}
              onSelect={(value) =>
                runAcpAction(setAcpConfigOption(modelOption.id, value))
              }
            />
          ) : null}
          {showModelSelect && modelState ? (
            <ModelPicker
              label="Model"
              options={modelState.availableModels.map((model) => ({
                value: model.modelId,
                name: model.name,
              }))}
              currentValue={modelState.currentModelId ?? ""}
              onSelect={(value) => runAcpAction(setAcpModel(value))}
            />
          ) : null}
          {modelConfigOptions.map((option) =>
            option.type === "boolean" ? (
              <ConfigToggle key={option.id} option={option} />
            ) : (
              <ConfigSelect key={option.id} option={option} />
            ),
          )}
          {thoughtOption ? <ConfigSelect option={thoughtOption} /> : null}
          {modeOption ? <ConfigSelect option={modeOption} /> : null}
          {showModeSelect && modeState ? (
            <ModeSelect modeState={modeState} />
          ) : null}
          {otherOptions.map((option) =>
            option.type === "boolean" ? (
              <ConfigToggle key={option.id} option={option} />
            ) : (
              <ConfigSelect key={option.id} option={option} />
            ),
          )}
          <AgentComposerSendButton
            streaming={isStreaming}
            disabled={
              connection !== "ready" ||
              (!isStreaming && !input.trim() && attachments.length === 0)
            }
            onClick={() => (isStreaming ? cancelAcp() : void submit())}
          />
        </>
      }
    />
  );
}

export function AcpPanel({
  agent,
  cwd,
  workspace,
  agentPicker,
  onOpenFile,
}: Props) {
  const state = useAcpStore();
  const descriptor = acpAgent(agent);
  const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false);
  const [extraFoldersOpen, setExtraFoldersOpen] = useState(false);
  const extraFolderCount = usePreferencesStore(
    (s) => s.acpAdditionalDirectories.length,
  );

  useEffect(() => {
    void ensureAcpStarted(agent, cwd, workspace).catch(() => {});
  }, [agent, cwd, workspace]);

  useEffect(() => {
    return () => {
      void stopAcp();
    };
  }, []);

  const items = useMemo(() => {
    const messages = state.messages.map((message) => ({
      kind: "message" as const,
      sequence: message.sequence,
      message,
    }));
    const tools = state.tools.map((tool) => ({
      kind: "tool" as const,
      sequence: tool.sequence,
      tool,
    }));
    return [...messages, ...tools].sort((a, b) => a.sequence - b.sequence);
  }, [state.messages, state.tools]);

  const unavailable =
    state.connection === "error" ||
    state.connection === "exited" ||
    state.connection === "stopped";
  const empty = items.length === 0;
  const configMatches =
    state.sessionConfig !== null &&
    state.sessionConfig.agent === agent &&
    state.sessionConfig.cwd === cwd &&
    workspaceScopeKey(state.sessionConfig.workspace) ===
      workspaceScopeKey(workspace);
  const switching = state.connection === "starting" || !configMatches;
  const cwdLabel = cwd ? baseName(cwd) : null;
  const agentLabel =
    state.agentInfo.title ?? state.agentInfo.name ?? descriptor.label;
  const usageCost = formatCost(
    state.usage?.cost?.amount,
    state.usage?.cost?.currency,
  );
  const usageText = state.usage
    ? `${
        state.usage.size > 0
          ? formatTokens(state.usage.used, state.usage.size)
          : `${formatCount(state.usage.used)} tokens`
      }${usageCost ? ` · ${usageCost}` : ""}`
    : null;
  const meta = [cwdLabel, usageText].filter(Boolean).join(" · ") || null;

  const runStatus: AgentRunStatus =
    state.connection === "stopped"
      ? "stopped"
      : unavailable
        ? "error"
        : switching
          ? "starting"
          : state.sessionState === "requires_action"
            ? "waiting"
            : state.isStreaming
              ? "working"
              : "ready";

  let subtitle = state.sessionTitle ?? agentLabel;
  let subtitleTone: AgentSubtitleTone = "default";
  if (switching) {
    subtitle = `Starting ${descriptor.label}`;
  } else if (state.sessionState === "requires_action") {
    subtitle = "Waiting for your input";
    subtitleTone = "primary";
  } else if (state.isStreaming) {
    subtitle = state.sessionTitle ?? "Working";
  } else if (state.notice) {
    subtitle =
      state.notice.severity && state.notice.severity !== "info"
        ? `${state.notice.severity}: ${state.notice.text}`
        : state.notice.text;
    subtitleTone =
      state.notice.kind === "auth"
        ? "primary"
        : state.notice.severity === "error"
          ? "destructive"
          : state.notice.severity === "warning"
            ? "warning"
            : "default";
  } else if (state.lastStopReason === "error" && state.lastStopError) {
    subtitle = state.lastStopError;
    subtitleTone = "destructive";
  } else if (!state.sessionTitle && state.connection === "ready") {
    subtitle = "Ready";
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <AgentHeader
        picker={agentPicker}
        mark={<AgentMark agent={agent} size={14} />}
        label={descriptor.label}
        status={runStatus}
        subtitle={subtitle}
        subtitleTone={subtitleTone}
        meta={meta}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <AgentIconButton label="Agent session menu">
                  <HugeiconsIcon icon={MoreHorizontalIcon} size={15} />
                </AgentIconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onSelect={() => runAcpAction(newAcpSession())}>
                  <HugeiconsIcon icon={Add01Icon} />
                  New session
                </DropdownMenuItem>
                {state.capabilities.sessionList ? (
                  <DropdownMenuItem
                    onSelect={() => setSessionSwitcherOpen(true)}
                  >
                    <HugeiconsIcon icon={Clock01Icon} />
                    Switch session
                  </DropdownMenuItem>
                ) : null}
                {state.authMethods.map((method) => (
                  <DropdownMenuItem
                    key={method.methodId}
                    onSelect={() => runAcpAction(loginAcp(method.methodId))}
                  >
                    Sign in: {method.name}
                  </DropdownMenuItem>
                ))}
                {(state.protocolVersion === 2 ||
                  state.capabilities.authLogout) &&
                state.authMethods.length > 0 ? (
                  <DropdownMenuItem onSelect={() => runAcpAction(logoutAcp())}>
                    Sign out
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={() => setExtraFoldersOpen(true)}>
                  Extra folders
                  {extraFolderCount > 0 ? ` (${extraFolderCount})` : ""}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => runAcpAction(restartAcp())}>
                  <HugeiconsIcon icon={RefreshIcon} />
                  Restart
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => runAcpAction(stopAcp())}>
                  <HugeiconsIcon icon={PowerIcon} />
                  Stop
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <AgentConversation>
        {switching ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <HugeiconsIcon
              icon={Loading03Icon}
              size={14}
              className="animate-spin"
            />
            Starting {descriptor.label}
          </div>
        ) : unavailable ? (
          <AgentEmptyState
            mark={<AgentMark agent={agent} size={24} />}
            title={
              state.connection === "stopped"
                ? `${descriptor.label} stopped`
                : `${descriptor.label} is unavailable`
            }
            hint={
              state.connection === "stopped"
                ? "You stopped the agent process."
                : (state.processError ?? "The agent process has exited.")
            }
          >
            <button
              type="button"
              onClick={() => runAcpAction(restartAcp())}
              className="mt-3 rounded-md border border-border px-3 py-1.5 text-[11px] transition-colors hover:bg-foreground/[0.05]"
            >
              {state.connection === "stopped"
                ? `Start ${descriptor.label}`
                : "Try again"}
            </button>
          </AgentEmptyState>
        ) : empty ? (
          <AgentEmptyState
            mark={<AgentMark agent={agent} size={30} />}
            title={`Ask ${descriptor.label} to work on something`}
            hint="Mention files with @ and press Enter to send."
          />
        ) : (
          <div className="space-y-4">
            {items.map((item) =>
              item.kind === "message" ? (
                <Message key={item.message.id} message={item.message} />
              ) : (
                <ToolRow
                  key={item.tool.id}
                  tool={item.tool}
                  cwd={cwd}
                  onOpenPath={onOpenFile}
                />
              ),
            )}
          </div>
        )}
      </AgentConversation>

      {state.rpcError ? (
        <AgentError
          message={state.rpcError}
          onDismiss={() => useAcpStore.setState({ rpcError: null })}
        />
      ) : null}
      <ElicitationPrompt />
      <PermissionPrompt />
      <PlanList />
      <AcpComposer agent={agent} root={cwd} />
      <SessionSwitcherDialog
        open={sessionSwitcherOpen}
        onOpenChange={setSessionSwitcherOpen}
      />
      <ExtraFoldersDialog
        open={extraFoldersOpen}
        onOpenChange={setExtraFoldersOpen}
      />
    </div>
  );
}
