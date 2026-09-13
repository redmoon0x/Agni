import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowUp02Icon,
  Clock01Icon,
  FileEditIcon,
  Loading03Icon,
  MoreHorizontalIcon,
  PowerIcon,
  RefreshIcon,
  Robot01Icon,
  Square01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Streamdown } from "streamdown";
import { useStickToBottom } from "use-stick-to-bottom";
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
import {
  formatCost,
  formatTokens,
} from "@/modules/agent-panel/lib/usage";
import {
  type CommandPaletteFileHit,
  useWorkspaceFileSearch,
} from "@/modules/command-palette/useWorkspaceFileSearch";
import {
  InlineCode,
  MarkdownCodeBlock,
} from "@/modules/markdown/MarkdownCodeBlock";
import { acpAgent, type AcpAgentId } from "@/modules/acp-agent/lib/agent";
import { KiloLogoIcon } from "@/modules/acp-agent/KiloLogoIcon";
import { OpenCodeLogoIcon } from "@/modules/acp-agent/OpenCodeLogoIcon";
import {
  cancelAcp,
  ensureAcpStarted,
  listAcpSessions,
  loadAcpSession,
  newAcpSession,
  promptAcp,
  respondToPermission,
  restartAcp,
  setAcpConfigOption,
  setAcpMode,
  stopAcp,
  useAcpStore,
} from "@/modules/acp-agent/store";
import type {
  AcpConfigOption,
  AcpImageAttachment,
  AcpMessage,
  AcpModeState,
  AcpSessionInfo,
  AcpToolCall,
  AcpToolContent,
} from "@/modules/acp-agent/types";
import type { WorkspaceEnv } from "@/modules/workspace";

type Props = {
  agent: AcpAgentId;
  cwd: string | null;
  workspace: WorkspaceEnv;
};

type AtToken = { query: string; start: number };
type MentionEntry = { rel: string; path: string };

const markdownComponents = { code: InlineCode, pre: MarkdownCodeBlock };
const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

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
  return <HugeiconsIcon icon={Robot01Icon} size={size} className={className} />;
}

function readImageAttachment(file: File): Promise<AcpImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const data = result.slice(result.indexOf(",") + 1);
      if (!data) {
        reject(new Error("Could not encode image"));
        return;
      }
      resolve({
        type: "image",
        name: file.name,
        data,
        mimeType: file.type || "image/png",
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
  if (content.type === "diff") return `diff:${content.path}`;
  if (content.type === "terminal") return `terminal:${content.terminalId}`;
  if (content.type === "content") return `content:${content.content.text ?? ""}`;
  return `unknown:${JSON.stringify(content.value)}`;
}

function ToolContentItem({ content }: { content: AcpToolContent }) {
  if (content.type === "diff") {
    return (
      <div className="border-t border-border/40">
        <div className="px-2.5 pt-1.5 font-mono text-[10px] text-muted-foreground">
          {content.path}
        </div>
        <pre className="select-text max-h-48 overflow-auto px-2.5 py-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {content.newText}
        </pre>
      </div>
    );
  }
  if (content.type === "content") {
    const text = content.content.text ?? "";
    if (!text) return null;
    return (
      <pre className="select-text max-h-48 overflow-auto border-t border-border/40 px-2.5 py-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
        {text}
      </pre>
    );
  }
  if (content.type === "terminal") {
    return (
      <div className="border-t border-border/40 px-2.5 py-2 font-mono text-[10px] text-muted-foreground">
        terminal {content.terminalId}
      </div>
    );
  }
  return null;
}

function ToolRow({ tool }: { tool: AcpToolCall }) {
  const [open, setOpen] = useState(false);
  const detail = tool.content.length > 0;
  return (
    <div className="rounded-lg border border-border/50 bg-foreground/[0.025]">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
        onClick={() => detail && setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            tool.status === "in_progress" && "animate-pulse bg-primary",
            tool.status === "pending" && "bg-muted-foreground/50",
            tool.status === "completed" && "bg-emerald-500",
            tool.status === "failed" && "bg-destructive",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
          {tool.title || tool.kind}
        </span>
        <span className="shrink-0 text-[9px] tracking-wide text-muted-foreground uppercase">
          {tool.kind}
        </span>
        {detail ? (
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={12}
            className={cn(
              "shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        ) : null}
      </button>
      {open
        ? tool.content.map((content) => (
            <ToolContentItem key={contentKey(content)} content={content} />
          ))
        : null}
    </div>
  );
}

function Message({ message }: { message: AcpMessage }) {
  if (message.role === "thought") {
    return (
      <div className="rounded-lg border border-border/40 bg-foreground/[0.015] px-2.5 py-2">
        <div className="mb-1 text-[9px] tracking-wide text-muted-foreground uppercase">
          Thinking
        </div>
        <div className="text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {message.text}
        </div>
      </div>
    );
  }
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary/10 px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap">
          {message.text}
        </div>
      </div>
    );
  }
  return (
    <div className="text-[12px] leading-relaxed">
      <Streamdown components={markdownComponents}>{message.text}</Streamdown>
    </div>
  );
}

function PlanList() {
  const plan = useAcpStore((state) => state.plan);
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
      {open ? (
        <div className="space-y-1 px-2.5 pb-2">
          {plan.map((entry) => (
            <div key={entry.content} className="flex items-start gap-2">
              <span
                className={cn(
                  "mt-1 size-1.5 shrink-0 rounded-full",
                  entry.status === "completed" && "bg-emerald-500",
                  entry.status === "in_progress" && "animate-pulse bg-primary",
                  (!entry.status || entry.status === "pending") &&
                    "bg-muted-foreground/50",
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

function PermissionPrompt() {
  const permission = useAcpStore((state) => state.permission);
  if (!permission) return null;
  return (
    <div className="mx-2 mb-2 rounded-lg border border-border/60 bg-foreground/[0.02] p-2.5">
      <div className="mb-2 text-[11px] font-medium">
        {permission.title ?? "The agent wants to run a tool"}
      </div>
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
    </div>
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
            onSelect={() => runAcpAction(setAcpConfigOption(option.id, value.value))}
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

function ModelPicker({ option }: { option: AcpConfigOption }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const current = option.options.find(
    (value) => value.value === option.currentValue,
  );
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? option.options.filter((value) =>
        `${value.name} ${value.value}`.toLowerCase().includes(needle),
      )
    : option.options;
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
          title={option.name}
          className="max-w-40 truncate rounded-md px-1.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
        >
          {current?.name ?? option.name}
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
                  runAcpAction(setAcpConfigOption(option.id, value.value));
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-accent hover:text-accent-foreground",
                  value.value === option.currentValue && "font-medium",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{value.name}</span>
                {value.value === option.currentValue ? (
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

function SessionSwitcherDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const currentId = useAcpStore((state) => state.sessionId);
  const [sessions, setSessions] = useState<AcpSessionInfo[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSessions(null);
    setQuery("");
    void listAcpSessions()
      .then((items) => {
        if (!cancelled) setSessions(items);
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
              <button
                key={session.sessionId}
                type="button"
                onClick={() => {
                  runAcpAction(loadAcpSession(session.sessionId));
                  onOpenChange(false);
                }}
                className={cn(
                  "flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-accent hover:text-accent-foreground",
                  session.sessionId === currentId && "bg-foreground/[0.05]",
                )}
              >
                <span className="flex items-center gap-2">
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
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AcpComposer({ agent, root }: { agent: AcpAgentId; root: string | null }) {
  const connection = useAcpStore((state) => state.connection);
  const isStreaming = useAcpStore((state) => state.isStreaming);
  const capabilities = useAcpStore((state) => state.capabilities);
  const configOptions = useAcpStore((state) => state.configOptions);
  const modeState = useAcpStore((state) => state.modeState);
  const commands = useAcpStore((state) => state.commands);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [atToken, setAtToken] = useState<AtToken | null>(null);
  const [atHighlight, setAtHighlight] = useState(0);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [mentions, setMentions] = useState<MentionEntry[]>([]);
  const [attachments, setAttachments] = useState<AcpImageAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const canMention = capabilities.promptEmbeddedContext;
  const canAttach = capabilities.promptImage;
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
  const otherOptions = configOptions.filter(
    (option) =>
      option !== modelOption &&
      option !== thoughtOption &&
      option !== modeOption,
  );
  const showModeSelect = !modeOption && modeState !== null;

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
        images: canAttach ? attachments : [],
      });
    } catch (error) {
      setInput(text);
      setMentions(usedMentions);
      useAcpStore.setState({ rpcError: String(error) });
    } finally {
      setSending(false);
    }
  };

  const addImages = async (files: FileList | null) => {
    if (!files?.length) return;
    const nextFiles = Array.from(files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (nextFiles.length !== files.length) {
      useAcpStore.setState({ rpcError: "Only image files can be attached." });
    }
    const available = MAX_IMAGE_ATTACHMENTS - attachments.length;
    const selected = nextFiles.slice(0, available);
    const currentBytes = attachments.reduce(
      (total, image) => total + Math.ceil((image.data.length * 3) / 4),
      0,
    );
    const accepted: File[] = [];
    let totalBytes = currentBytes;
    for (const file of selected) {
      if (totalBytes + file.size > MAX_IMAGE_BYTES) break;
      accepted.push(file);
      totalBytes += file.size;
    }
    if (accepted.length !== selected.length || nextFiles.length > available) {
      useAcpStore.setState({
        rpcError: "Up to 4 images with a combined size of 6 MB.",
      });
    }
    try {
      const images = await Promise.all(accepted.map(readImageAttachment));
      setAttachments((current) => [...current, ...images]);
    } catch (error) {
      useAcpStore.setState({ rpcError: String(error) });
    } finally {
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
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

  return (
    <div className="relative shrink-0 p-2">
      {atToken && fileHits.length > 0 ? (
        <div className="absolute inset-x-2 bottom-full z-10 mb-1 max-h-56 overflow-y-auto rounded-xl border border-border/80 bg-popover shadow-lg ring-1 ring-foreground/5">
          {fileHits.map((hit, index) => (
            <button
              key={hit.path}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyMention(hit)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px]",
                index === safeAtHighlight
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground",
              )}
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
            </button>
          ))}
        </div>
      ) : commandSuggestions.length > 0 ? (
        <div className="absolute inset-x-2 bottom-full z-10 mb-1 overflow-hidden rounded-xl border border-border/80 bg-popover shadow-lg ring-1 ring-foreground/5">
          {commandSuggestions.map((command, index) => (
            <button
              key={command.name}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyCommand(command.name)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px]",
                index === highlightIndex
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground",
              )}
            >
              <span className="font-medium">/{command.name}</span>
              {command.description ? (
                <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
                  {command.description}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      <div className="rounded-xl border border-border/80 bg-background shadow-sm focus-within:border-ring/70">
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2">
            {attachments.map((image) => (
              <button
                key={`${image.name}-${image.data.length}`}
                type="button"
                title={`Remove ${image.name}`}
                onClick={() =>
                  setAttachments((current) =>
                    current.filter((candidate) => candidate !== image),
                  )
                }
                className="flex max-w-36 items-center gap-1 rounded-md bg-foreground/[0.06] px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-foreground/[0.1] hover:text-foreground"
              >
                <img
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt=""
                  className="size-4 rounded-sm object-cover"
                />
                <span className="truncate">{image.name}</span>
              </button>
            ))}
          </div>
        ) : null}
        <textarea
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
          placeholder={placeholder}
          rows={3}
          disabled={connection !== "ready"}
          className="block max-h-40 min-h-16 w-full resize-none bg-transparent px-3 pt-3 text-[12px] leading-relaxed outline-none placeholder:text-muted-foreground/70 disabled:opacity-50"
        />
        <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5">
          {canAttach ? (
            <>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(event) => void addImages(event.target.files)}
              />
              <button
                type="button"
                disabled={attachments.length >= MAX_IMAGE_ATTACHMENTS}
                onClick={() => imageInputRef.current?.click()}
                className="rounded-md px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-50"
              >
                Image
              </button>
            </>
          ) : null}
          <span className="min-w-0 flex-1" />
          {modelOption ? <ModelPicker option={modelOption} /> : null}
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
          <button
            type="button"
            aria-label={isStreaming ? "Stop the agent" : "Send"}
            disabled={
              connection !== "ready" ||
              (!isStreaming && !input.trim() && attachments.length === 0)
            }
            onClick={() =>
              isStreaming ? cancelAcp() : void submit()
            }
            className="ml-0.5 flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-35"
          >
            <HugeiconsIcon
              icon={isStreaming ? Square01Icon : ArrowUp02Icon}
              size={14}
              strokeWidth={2.2}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

export function AcpPanel({ agent, cwd, workspace }: Props) {
  const state = useAcpStore();
  const descriptor = acpAgent(agent);
  const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false);
  const { scrollRef, contentRef } = useStickToBottom({
    initial: "instant",
    resize: "instant",
  });

  useEffect(() => {
    void ensureAcpStarted(agent, cwd, workspace).catch(() => {});
  }, [agent, cwd, workspace]);

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
  const agentLabel = state.agentInfo.title ?? state.agentInfo.name;
  const usageCost = formatCost(
    state.usage?.cost?.amount,
    state.usage?.cost?.currency,
  );
  const usageText = state.usage
    ? `${formatTokens(state.usage.used, state.usage.size)} tokens${
        usageCost ? ` · ${usageCost}` : ""
      }`
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <AgentMark agent={agent} size={16} />
        <span className="text-[11px] font-semibold tracking-wide uppercase">
          {descriptor.label}
        </span>
        <span
          className={cn(
            "ml-0.5 size-1.5 rounded-full",
            state.connection === "ready" && !state.isStreaming && "bg-emerald-500",
            state.isStreaming && "animate-pulse bg-primary",
            state.connection === "starting" && "animate-pulse bg-muted-foreground",
            unavailable && "bg-destructive",
            state.connection === "idle" && "bg-muted-foreground/50",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
          {usageText ??
            (state.isStreaming
              ? "Working"
              : (agentLabel ??
                (state.connection === "ready" ? "Ready" : state.connection)))}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Agent session menu"
              className="rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <HugeiconsIcon icon={MoreHorizontalIcon} size={15} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => runAcpAction(newAcpSession())}>
              <HugeiconsIcon icon={Add01Icon} />
              New session
            </DropdownMenuItem>
            {state.capabilities.sessionList ? (
              <DropdownMenuItem onSelect={() => setSessionSwitcherOpen(true)}>
                <HugeiconsIcon icon={Clock01Icon} />
                Switch session
              </DropdownMenuItem>
            ) : null}
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
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div ref={contentRef} className="min-h-full">
          {state.connection === "starting" ? (
            <div className="flex h-full items-center justify-center gap-2 text-[11px] text-muted-foreground">
              <HugeiconsIcon
                icon={Loading03Icon}
                size={14}
                className="animate-spin"
              />
              Starting {descriptor.label}
            </div>
          ) : unavailable ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <div className="mb-3 flex size-9 items-center justify-center rounded-xl bg-foreground/[0.05]">
                <AgentMark agent={agent} size={18} />
              </div>
              <p className="text-[12px] font-medium">
                {state.connection === "stopped"
                  ? `${descriptor.label} stopped`
                  : `${descriptor.label} is unavailable`}
              </p>
              <p className="mt-1.5 max-w-64 text-[10px] leading-relaxed text-muted-foreground">
                {state.connection === "stopped"
                  ? "You stopped the agent process."
                  : (state.processError ?? "The agent process has exited.")}
              </p>
              <button
                type="button"
                onClick={() => runAcpAction(restartAcp())}
                className="mt-3 rounded-md border border-border px-3 py-1.5 text-[11px] hover:bg-foreground/[0.05]"
              >
                {state.connection === "stopped"
                  ? `Start ${descriptor.label}`
                  : "Try again"}
              </button>
            </div>
          ) : empty ? (
            <div className="flex h-full flex-col items-center justify-center px-5 text-center">
              <div className="flex size-20 items-center justify-center rounded-3xl bg-foreground/[0.05]">
                <AgentMark agent={agent} size={44} />
              </div>
              <p className="mt-4 text-[12px] font-medium text-muted-foreground">
                Ask {descriptor.label} to work on something
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {items.map((item) =>
                item.kind === "message" ? (
                  <Message key={item.message.id} message={item.message} />
                ) : (
                  <ToolRow key={item.tool.id} tool={item.tool} />
                ),
              )}
            </div>
          )}
        </div>
      </div>

      {state.rpcError ? (
        <div className="mx-2 mb-2 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-[10px] leading-relaxed text-destructive">
          {state.rpcError}
        </div>
      ) : null}
      <PermissionPrompt />
      <PlanList />
      <AcpComposer agent={agent} root={cwd} />
      <SessionSwitcherDialog
        open={sessionSwitcherOpen}
        onOpenChange={setSessionSwitcherOpen}
      />
    </div>
  );
}
