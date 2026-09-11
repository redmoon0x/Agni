import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowUp02Icon,
  BubbleChatIcon,
  Clock01Icon,
  ComputerTerminal02Icon,
  FileEditIcon,
  Loading03Icon,
  MoreHorizontalIcon,
  PowerIcon,
  RefreshIcon,
  Square01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { useStickToBottom } from "use-stick-to-bottom";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
  type CommandPaletteFileHit,
  useWorkspaceFileSearch,
} from "@/modules/command-palette/useWorkspaceFileSearch";
import {
  InlineCode,
  MarkdownCodeBlock,
} from "@/modules/markdown/MarkdownCodeBlock";
import { PI_TERMINAL_LEAF_ID } from "@/modules/pi-agent/lib/terminalLeaf";
import { PiLogoIcon } from "@/modules/pi-agent/PiLogoIcon";
import { usePiPanelModeStore } from "@/modules/pi-agent/panelModeStore";
import { messageText } from "@/modules/pi-agent/rpcState";
import {
  abortPi,
  abortPiRetry,
  clonePiSession,
  compactPiSession,
  ensurePiStarted,
  exportPiSession,
  followUpPi,
  forkPiSession,
  listPiSessions,
  loadPiForkMessages,
  newPiSession,
  promptPi,
  respondToPiExtension,
  restartPi,
  setPiAutoCompaction,
  setPiAutoRetry,
  setPiFollowUpMode,
  setPiModel,
  setPiSessionName,
  setPiSteeringMode,
  setPiThinkingLevel,
  steerPi,
  stopPi,
  switchPiSession,
  usePiStore,
} from "@/modules/pi-agent/store";
import type {
  PiExtensionRequest,
  PiExtensionWidget,
  PiImageAttachment,
  PiMessage,
  PiSessionEntry,
  PiToolActivity,
} from "@/modules/pi-agent/types";
import { usePreviewAnnotateDraftStore } from "@/modules/preview-annotate";
import { TerminalPane } from "@/modules/terminal";
import { respawnSession } from "@/modules/terminal/lib/useTerminalSession";
import type { WorkspaceEnv } from "@/modules/workspace";

type Props = {
  cwd: string | null;
  workspace: WorkspaceEnv;
};

function runPiAction(action: Promise<unknown>) {
  void action.catch((error) => {
    usePiStore.setState({ rpcError: String(error) });
  });
}

const markdownComponents = { code: InlineCode, pre: MarkdownCodeBlock };

function ToolRow({ tool }: { tool: PiToolActivity }) {
  const [open, setOpen] = useState(false);
  const command =
    tool.args && typeof tool.args === "object" && "command" in tool.args
      ? String((tool.args as { command?: unknown }).command ?? "")
      : "";
  return (
    <div className="rounded-lg border border-border/50 bg-foreground/[0.025]">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            tool.status === "running" && "animate-pulse bg-primary",
            tool.status === "done" && "bg-emerald-500",
            tool.status === "error" && "bg-destructive",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
          {tool.name}
          {command ? ` · ${command}` : ""}
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={12}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (tool.output || command) ? (
        <pre className="select-text max-h-48 overflow-auto border-t border-border/40 px-2.5 py-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {tool.output || command}
        </pre>
      ) : null}
    </div>
  );
}

function Message({ message }: { message: PiMessage }) {
  const text = messageText(message);
  const thinking = messageText(message, "thinking");
  if (!text && !thinking) return null;
  if (message.role === "user") {
    return (
      <div className="ml-7 rounded-xl bg-foreground/[0.065] px-3 py-2.5 text-[12px] leading-relaxed whitespace-pre-wrap">
        {text}
      </div>
    );
  }
  return (
    <div className="select-text min-w-0 text-[12px] leading-relaxed">
      {thinking ? (
        <details className="mb-2 text-muted-foreground">
          <summary className="cursor-pointer text-[10px] font-medium uppercase tracking-wider">
            Thinking
          </summary>
          <div className="mt-1.5 whitespace-pre-wrap opacity-80">
            {thinking}
          </div>
        </details>
      ) : null}
      {text ? (
        <Streamdown
          className="prose-sm min-w-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
          components={markdownComponents}
        >
          {text}
        </Streamdown>
      ) : null}
    </div>
  );
}

function ExtensionPrompt({ request }: { request: PiExtensionRequest }) {
  const [value, setValue] = useState(request.prefill ?? "");
  const cancel = () =>
    runPiAction(respondToPiExtension(request, { cancelled: true }));
  return (
    <div className="mx-2 mb-2 rounded-xl border border-border bg-popover p-3 shadow-lg">
      <p className="text-[12px] font-semibold">
        {request.title ?? "Pi needs input"}
      </p>
      {request.message ? (
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {request.message}
        </p>
      ) : null}
      {request.method === "select" ? (
        <div className="mt-2 grid gap-1">
          {request.options?.map((option) => (
            <button
              type="button"
              key={option}
              className="rounded-md bg-foreground/[0.05] px-2.5 py-2 text-left text-[11px] hover:bg-foreground/[0.09]"
              onClick={() =>
                runPiAction(respondToPiExtension(request, { value: option }))
              }
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
      {request.method === "input" || request.method === "editor" ? (
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={request.placeholder}
          rows={request.method === "editor" ? 5 : 2}
          className="mt-2 w-full resize-none rounded-lg border border-border bg-background px-2.5 py-2 text-[11px] outline-none focus:border-ring"
        />
      ) : null}
      <div className="mt-3 flex justify-end gap-1.5">
        <button
          type="button"
          onClick={cancel}
          className="rounded-md px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-foreground/[0.05]"
        >
          Cancel
        </button>
        {request.method === "confirm" ? (
          <>
            <button
              type="button"
              onClick={() =>
                runPiAction(respondToPiExtension(request, { confirmed: false }))
              }
              className="rounded-md bg-foreground/[0.05] px-2.5 py-1.5 text-[11px]"
            >
              No
            </button>
            <button
              type="button"
              onClick={() =>
                runPiAction(respondToPiExtension(request, { confirmed: true }))
              }
              className="rounded-md bg-primary px-2.5 py-1.5 text-[11px] text-primary-foreground"
            >
              Yes
            </button>
          </>
        ) : null}
        {request.method === "input" || request.method === "editor" ? (
          <button
            type="button"
            onClick={() =>
              runPiAction(respondToPiExtension(request, { value }))
            }
            className="rounded-md bg-primary px-2.5 py-1.5 text-[11px] text-primary-foreground"
          >
            Submit
          </button>
        ) : null}
      </div>
    </div>
  );
}

type AtToken = { query: string; start: number };
type DeliveryMode = "steer" | "followUp";

const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

function readImageAttachment(file: File): Promise<PiImageAttachment> {
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

/** Finds the `@mention` token the caret is currently inside, if any -- the
 * `@` must start the input or follow whitespace, and no whitespace may sit
 * between it and the caret. */
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

function PiComposer({ root }: { root: string | null }) {
  const connection = usePiStore((state) => state.connection);
  const session = usePiStore((state) => state.session);
  const models = usePiStore((state) => state.models);
  const thinkingLevels = usePiStore((state) => state.thinkingLevels);
  const commands = usePiStore((state) => state.commands);
  const [input, setInput] = useState("");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [atToken, setAtToken] = useState<AtToken | null>(null);
  const [atHighlight, setAtHighlight] = useState(0);
  const [attachments, setAttachments] = useState<PiImageAttachment[]>([]);
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("steer");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const activeModel = session.model;
  const extensionEditorText = usePiStore((state) => state.extensionEditorText);

  // Pick up an annotation draft (preview → Pi) when the panel mounts.
  useEffect(() => {
    const draft = usePreviewAnnotateDraftStore.getState().consume();
    if (draft) setInput(draft);
  }, []);

  useEffect(() => {
    if (!extensionEditorText) return;
    setInput(extensionEditorText.text);
    usePiStore.setState({ extensionEditorText: null });
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [extensionEditorText]);

  const slashQuery = /^\/(\S*)$/.exec(input)?.[1];
  const commandSuggestions =
    slashQuery === undefined
      ? []
      : commands
          .filter((c) =>
            c.name.toLowerCase().startsWith(slashQuery.toLowerCase()),
          )
          .slice(0, 8);

  const { results: fileHits } = useWorkspaceFileSearch({
    root,
    query: atToken?.query ?? "",
    enabled: atToken !== null,
    // Pi mentions should suggest from a single character, unlike the
    // command palette's 2-char gate, and a bare `@` lists files so there's
    // always something to pick from.
    minQueryLength: 1,
    listOnEmpty: true,
  });

  const applyCommand = (name: string) => {
    setInput(`/${name} `);
    setHighlightIndex(0);
  };

  /** Replaces the in-progress `@query` token with the picked file's
   * workspace-relative path -- Pi's CLI resolves `@path` mentions itself. */
  const applyMention = (hit: CommandPaletteFileHit | undefined) => {
    if (!atToken || !hit) return;
    const before = input.slice(0, atToken.start);
    const after = input.slice(atToken.start + 1 + atToken.query.length);
    const mention = `@${hit.rel} `;
    setInput(`${before}${mention}${after}`);
    setAtToken(null);
    requestAnimationFrame(() => {
      const pos = before.length + mention.length;
      textareaRef.current?.setSelectionRange(pos, pos);
      textareaRef.current?.focus();
    });
  };

  const submit = async () => {
    if (
      (!input.trim() && attachments.length === 0) ||
      connection !== "ready" ||
      sending
    ) {
      return;
    }
    const message = input.trim() || "Analyze the attached image.";
    const messageAttachments = attachments;
    setInput("");
    setAtToken(null);
    setAttachments([]);
    setSending(true);
    try {
      if (session.isStreaming) {
        if (deliveryMode === "followUp") {
          await followUpPi(message, messageAttachments);
        } else {
          await steerPi(message, messageAttachments);
        }
      } else {
        await promptPi(message, messageAttachments);
      }
    } catch (error) {
      setInput(message);
      setAttachments(messageAttachments);
      usePiStore.setState({ rpcError: String(error) });
    } finally {
      setSending(false);
    }
  };

  const addImages = async (files: FileList | null) => {
    if (!files?.length) return;
    const nextFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (nextFiles.length !== files.length) {
      usePiStore.setState({ rpcError: "Only image files can be attached to Pi." });
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
      usePiStore.setState({
        rpcError: "Pi accepts up to 4 images with a combined size of 6 MB.",
      });
    }
    try {
      const images = await Promise.all(accepted.map(readImageAttachment));
      setAttachments((current) => [...current, ...images]);
    } catch (error) {
      usePiStore.setState({ rpcError: String(error) });
    } finally {
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  // `fileHits` can shrink after an async search resolves without another
  // keystroke resetting `atHighlight` (e.g. after arrowing further down the
  // list), so clamp rather than index straight into a possibly-stale value.
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
        setHighlightIndex((i) => (i + 1) % commandSuggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightIndex(
          (i) =>
            (i - 1 + commandSuggestions.length) % commandSuggestions.length,
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

  return (
    <div className="relative shrink-0 p-2 pt-0">
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
              detectAtToken(value, event.target.selectionStart ?? value.length),
            );
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            session.isStreaming && deliveryMode === "followUp"
              ? "Queue a follow-up for Pi... (@ to reference a file)"
              : session.isStreaming
                ? "Steer Pi... (@ to reference a file)"
              : "Ask Pi to work on something... (@ to reference a file)"
          }
          rows={3}
          disabled={connection !== "ready"}
          className="block max-h-40 min-h-16 w-full resize-none bg-transparent px-3 pt-3 text-[12px] leading-relaxed outline-none placeholder:text-muted-foreground/70 disabled:opacity-50"
        />
        <div className="flex h-9 items-center gap-1 px-2 pb-1.5">
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
          {session.isStreaming ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="rounded-md px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
                >
                  {deliveryMode === "followUp" ? "Follow-up" : "Steer"}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-44">
                <DropdownMenuItem onSelect={() => setDeliveryMode("steer")}>
                  Steer current turn
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDeliveryMode("followUp")}>
                  Queue follow-up
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <span className="min-w-0 flex-1" />
          <Popover open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={!models.length || session.isStreaming}
                className="max-w-32 truncate rounded-md px-1.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-50"
                title={activeModel?.name ?? "Select model"}
              >
                {activeModel?.name ?? "Model"}
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="end"
              sideOffset={6}
              className="w-64 gap-0 rounded-3xl p-0"
            >
              <Command>
                <CommandInput placeholder="Search models..." />
                <CommandList className="max-h-64">
                  <CommandEmpty className="py-4 text-[12px] text-muted-foreground">
                    No models found.
                  </CommandEmpty>
                  {models.map((model) => (
                    <CommandItem
                      key={`${model.provider}/${model.id}`}
                      value={`${model.name} ${model.provider} ${model.id}`}
                      data-checked={
                        activeModel?.provider === model.provider &&
                        activeModel?.id === model.id
                      }
                      onSelect={() => {
                        runPiAction(setPiModel(model.provider, model.id));
                        setModelPickerOpen(false);
                      }}
                      className="text-[12px]"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {model.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {model.provider}
                      </span>
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={session.isStreaming}
                className="rounded-md px-1.5 py-1 text-[10px] capitalize text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-50"
              >
                {session.thinkingLevel}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-40">
              <DropdownMenuLabel>Thinking level</DropdownMenuLabel>
              {thinkingLevels.map((level) => (
                <DropdownMenuItem
                  key={level}
                  onSelect={() => runPiAction(setPiThinkingLevel(level))}
                >
                  <span className="capitalize">{level}</span>
                  {session.thinkingLevel === level ? (
                    <HugeiconsIcon icon={Tick02Icon} className="ml-auto" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            aria-label={session.isStreaming ? "Stop Pi" : "Send to Pi"}
            disabled={
              connection !== "ready" ||
              (!session.isStreaming && (!input.trim() || sending))
            }
            onClick={() =>
              session.isStreaming ? runPiAction(abortPi()) : void submit()
            }
            className="ml-0.5 flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-35"
          >
            <HugeiconsIcon
              icon={session.isStreaming ? Square01Icon : ArrowUp02Icon}
              size={14}
              strokeWidth={2.2}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

function formatSessionTimestamp(timestamp: string | null): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ExtensionWidgets({
  widgets,
  placement,
}: {
  widgets: PiExtensionWidget[];
  placement: PiExtensionWidget["placement"];
}) {
  const visible = widgets.filter((widget) => widget.placement === placement);
  if (visible.length === 0) return null;
  return (
    <div className="mx-2 mb-2 grid gap-1.5">
      {visible.map((widget) => (
        <div
          key={widget.key}
          className="rounded-lg border border-border/60 bg-foreground/[0.025] px-2.5 py-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground"
        >
          {widget.lines.join("\n")}
        </div>
      ))}
    </div>
  );
}

function PiForkDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const messages = usePiStore((state) => state.forkMessages);

  useEffect(() => {
    if (open) runPiAction(loadPiForkMessages());
  }, [open]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Fork Pi session"
      description="Start a new session from a previous user message."
      className="top-1/2 w-[min(480px,calc(100vw-32px))] -translate-y-1/2"
    >
      <div className="max-h-[360px] overflow-y-auto p-1">
        {messages.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">
            No messages available to fork from.
          </p>
        ) : (
          messages.map((message) => (
            <button
              key={message.entryId}
              type="button"
              onClick={() => {
                runPiAction(forkPiSession(message.entryId));
                onOpenChange(false);
              }}
              className="block w-full rounded-lg px-3 py-2 text-left text-[12px] leading-relaxed hover:bg-accent"
            >
              {message.text}
            </button>
          ))
        )}
      </div>
    </CommandDialog>
  );
}

function RenameSessionDialog({
  open,
  onOpenChange,
  initialName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string | undefined;
}) {
  const [name, setName] = useState(initialName ?? "");

  useEffect(() => {
    if (open) setName(initialName ?? "");
  }, [initialName, open]);

  const submit = () => {
    if (!name.trim()) return;
    runPiAction(setPiSessionName(name));
    onOpenChange(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Rename Pi session"
      description="Choose a name for this Pi session."
      className="top-1/2 w-[min(420px,calc(100vw-32px))] -translate-y-1/2"
    >
      <form
        className="flex gap-2 p-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Session name"
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-2 text-[12px] outline-none focus:border-ring"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="rounded-lg bg-primary px-3 text-[12px] text-primary-foreground disabled:opacity-50"
        >
          Save
        </button>
      </form>
    </CommandDialog>
  );
}

function PiSessionSwitcher({
  open,
  onOpenChange,
  currentSessionFile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentSessionFile: string | undefined;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<PiSessionEntry[]>([]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    listPiSessions()
      .then(setSessions)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [open]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Switch Pi session"
      description="Search and resume a past Pi session for this workspace."
      className="top-1/2 w-[min(480px,calc(100vw-32px))] -translate-y-1/2"
    >
      <Command>
        <CommandInput placeholder="Search sessions..." />
        <CommandList className="max-h-[360px]">
          {loading ? (
            <CommandItem
              value="status:loading"
              disabled
              className="text-[12.5px]"
            >
              Loading sessions...
            </CommandItem>
          ) : error ? (
            <CommandItem
              value="status:error"
              disabled
              className="text-[12.5px]"
            >
              <span className="text-destructive">{error}</span>
            </CommandItem>
          ) : sessions.length === 0 ? (
            <CommandEmpty className="py-6 text-center text-[12.5px] text-muted-foreground">
              No past sessions for this workspace.
            </CommandEmpty>
          ) : (
            sessions.map((entry) => (
              <CommandItem
                key={entry.path}
                value={`${entry.name ?? ""} ${entry.path}`}
                data-checked={entry.path === currentSessionFile}
                onSelect={() => {
                  runPiAction(switchPiSession(entry.path));
                  onOpenChange(false);
                }}
                className="text-[12.5px]"
              >
                <HugeiconsIcon
                  icon={Clock01Icon}
                  size={14}
                  strokeWidth={1.8}
                  className="text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate">
                  {entry.name ?? "Untitled session"}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {formatSessionTimestamp(entry.timestamp)}
                </span>
              </CommandItem>
            ))
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

function formatSessionCost(cost: number | undefined): string | null {
  if (typeof cost !== "number") return null;
  return `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}`;
}

function PiPanelModeToggle() {
  const mode = usePiPanelModeStore((s) => s.mode);
  const setMode = usePiPanelModeStore((s) => s.setMode);
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-md bg-foreground/[0.05] p-0.5">
      <button
        type="button"
        title="Pi chat"
        aria-pressed={mode === "chat"}
        onClick={() => setMode("chat")}
        className={cn(
          "flex h-6 items-center gap-1.5 rounded px-2 text-[11px] font-medium",
          mode === "chat"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <HugeiconsIcon icon={BubbleChatIcon} size={13} strokeWidth={1.75} />
        Chat
      </button>
      <button
        type="button"
        title="Terminal"
        aria-pressed={mode === "terminal"}
        onClick={() => setMode("terminal")}
        className={cn(
          "flex h-6 items-center gap-1.5 rounded px-2 text-[11px] font-medium",
          mode === "terminal"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <HugeiconsIcon
          icon={ComputerTerminal02Icon}
          size={13}
          strokeWidth={1.75}
        />
        Terminal
      </button>
    </div>
  );
}

export function PiPanel({ cwd, workspace }: Props) {
  const state = usePiStore();
  const mode = usePiPanelModeStore((s) => s.mode);
  const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false);
  const [forkDialogOpen, setForkDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [autoRetryEnabled, setAutoRetryEnabled] = useState(true);
  const shownNotification = useRef<string | null>(null);
  const shownExportPath = useRef<string | null>(null);
  const { scrollRef, contentRef } = useStickToBottom({
    initial: "instant",
    resize: "instant",
  });

  useEffect(() => {
    void ensurePiStarted(cwd, workspace).catch(() => {});
  }, [cwd, workspace]);

  useEffect(() => {
    const notification = state.extensionNotification;
    if (!notification || shownNotification.current === notification.id) return;
    shownNotification.current = notification.id;
    if (notification.type === "error") {
      toast.error(notification.message);
    } else if (notification.type === "warning") {
      toast.warning(notification.message);
    } else {
      toast(notification.message);
    }
  }, [state.extensionNotification]);

  useEffect(() => {
    const path = state.exportedHtmlPath;
    if (!path || shownExportPath.current === path) return;
    shownExportPath.current = path;
    toast.success("Pi session exported", { description: path });
  }, [state.exportedHtmlPath]);

  const unavailable =
    state.connection === "error" ||
    state.connection === "exited" ||
    state.connection === "stopped";
  const empty = state.messages.length === 0 && state.tools.length === 0;
  const extensionStatus = Object.values(state.extensionStatuses).join(" · ");

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <PiLogoIcon size={15} />
        <span className="text-[11px] font-semibold tracking-wide">PI</span>
        <span
          className={cn(
            "ml-0.5 size-1.5 rounded-full",
            state.connection === "ready" &&
              !state.session.isStreaming &&
              "bg-emerald-500",
            state.session.isStreaming && "animate-pulse bg-primary",
            state.connection === "starting" &&
              "animate-pulse bg-muted-foreground",
            unavailable && "bg-destructive",
            state.connection === "idle" && "bg-muted-foreground/50",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
          {mode === "terminal"
            ? "Terminal"
            : (state.extensionTitle ??
              (state.session.isCompacting
                ? "Compacting"
                : state.session.isStreaming
                  ? "Working"
                  : (state.session.sessionName ??
                    (state.connection === "ready"
                      ? "Ready"
                      : state.connection))))}
        </span>
        {extensionStatus ? (
          <span className="max-w-28 truncate text-[10px] text-muted-foreground" title={extensionStatus}>
            {extensionStatus}
          </span>
        ) : null}
        {mode === "chat" ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Pi session menu"
                className="rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
              >
                <HugeiconsIcon icon={MoreHorizontalIcon} size={15} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {state.stats ? (
                <DropdownMenuLabel className="text-[10px]">
                  {state.stats.totalMessages ?? 0} msgs
                  {state.stats.toolCalls
                    ? ` · ${state.stats.toolCalls} tools`
                    : ""}
                  {formatSessionCost(state.stats.cost)
                    ? ` · ${formatSessionCost(state.stats.cost)}`
                    : ""}
                </DropdownMenuLabel>
              ) : null}
              <DropdownMenuItem onSelect={() => runPiAction(newPiSession())}>
                <HugeiconsIcon icon={Add01Icon} />
                New session
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!state.session.sessionFile}
                onSelect={() => setSessionSwitcherOpen(true)}
              >
                <HugeiconsIcon icon={Clock01Icon} />
                Switch session
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={state.session.isStreaming}
                onSelect={() => setRenameDialogOpen(true)}
              >
                Rename session
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={state.session.isStreaming}
                onSelect={() => setForkDialogOpen(true)}
              >
                Fork from message
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={state.session.isStreaming}
                onSelect={() => runPiAction(clonePiSession())}
              >
                Clone current branch
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => runPiAction(exportPiSession())}>
                Export session HTML
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={state.session.isStreaming}
                onSelect={() => runPiAction(compactPiSession())}
              >
                Compact context
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={state.session.autoCompactionEnabled}
                onCheckedChange={(checked) =>
                  runPiAction(setPiAutoCompaction(checked))
                }
              >
                Auto-compact
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={autoRetryEnabled}
                onCheckedChange={(checked) => {
                  setAutoRetryEnabled(checked);
                  runPiAction(setPiAutoRetry(checked));
                }}
              >
                Auto-retry
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={state.session.steeringMode === "all"}
                onCheckedChange={(checked) =>
                  runPiAction(
                    setPiSteeringMode(checked ? "all" : "one-at-a-time"),
                  )
                }
              >
                Run all steering messages
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={state.session.followUpMode === "all"}
                onCheckedChange={(checked) =>
                  runPiAction(
                    setPiFollowUpMode(checked ? "all" : "one-at-a-time"),
                  )
                }
              >
                Run all follow-ups
              </DropdownMenuCheckboxItem>
              {state.session.isRetrying ? (
                <DropdownMenuItem onSelect={() => runPiAction(abortPiRetry())}>
                  Cancel retry
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => runPiAction(restartPi())}>
                <HugeiconsIcon icon={RefreshIcon} />
                Restart Pi
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={
                  state.connection !== "ready" &&
                  state.connection !== "starting"
                }
                onSelect={() => runPiAction(stopPi())}
              >
                <HugeiconsIcon icon={PowerIcon} />
                Stop Pi
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {mode === "chat" ? (
          <PiSessionSwitcher
            open={sessionSwitcherOpen}
            onOpenChange={setSessionSwitcherOpen}
            currentSessionFile={state.session.sessionFile}
          />
        ) : null}
        {mode === "chat" ? (
          <PiForkDialog
            open={forkDialogOpen}
            onOpenChange={setForkDialogOpen}
          />
        ) : null}
        {mode === "chat" ? (
          <RenameSessionDialog
            open={renameDialogOpen}
            onOpenChange={setRenameDialogOpen}
            initialName={state.session.sessionName}
          />
        ) : null}
      </div>

      <div className="flex h-7 shrink-0 items-center border-b border-border/60 px-2">
        <PiPanelModeToggle />
      </div>

      {mode === "terminal" ? (
        <div className="min-h-0 flex-1 p-2">
          <TerminalPane
            leafId={PI_TERMINAL_LEAF_ID}
            visible
            focused
            initialCwd={cwd ?? undefined}
            onExit={() =>
              void respawnSession(PI_TERMINAL_LEAF_ID, cwd ?? undefined)
            }
          />
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
        >
          <div ref={contentRef} className="min-h-full">
            {state.connection === "starting" ? (
              <div className="flex h-full items-center justify-center gap-2 text-[11px] text-muted-foreground">
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="animate-spin"
                />
                Starting Pi
              </div>
            ) : unavailable ? (
              <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                <div className="mb-3 flex size-9 items-center justify-center rounded-xl bg-foreground/[0.05]">
                  <PiLogoIcon size={18} />
                </div>
                <p className="text-[12px] font-medium">
                  {state.connection === "stopped"
                    ? "Pi stopped"
                    : "Pi is unavailable"}
                </p>
                <p className="mt-1.5 max-w-56 text-[10px] leading-relaxed text-muted-foreground">
                  {state.connection === "stopped"
                    ? "You stopped the Pi process."
                    : (state.processError ?? "The Pi process has exited.")}
                </p>
                <button
                  type="button"
                  onClick={() => runPiAction(restartPi())}
                  className="mt-3 rounded-md border border-border px-3 py-1.5 text-[11px] hover:bg-foreground/[0.05]"
                >
                  {state.connection === "stopped" ? "Start Pi" : "Try again"}
                </button>
              </div>
            ) : empty ? (
              <div className="flex h-full flex-col items-center justify-center px-5 text-center">
                <div className="flex size-20 items-center justify-center rounded-3xl bg-foreground/[0.05]">
                  <PiLogoIcon size={44} className="text-foreground/70" />
                </div>
                <p className="mt-4 text-[12px] font-medium text-muted-foreground">
                  Ask Pi to work on something
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {[...state.messages, ...state.tools]
                  .sort(
                    (a, b) =>
                      (a.sequence ?? Number.MAX_SAFE_INTEGER) -
                      (b.sequence ?? Number.MAX_SAFE_INTEGER),
                  )
                  .map((item) => {
                    if ("role" in item) {
                      return (
                        <Message
                          key={`${item.role}-${item.timestamp ?? item.sequence ?? item}`}
                          message={item}
                        />
                      );
                    }
                    return <ToolRow key={item.id} tool={item} />;
                  })}
              </div>
            )}
          </div>
        </div>
      )}

      {mode === "chat" && state.rpcError ? (
        <div className="mx-2 mb-2 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-[10px] leading-relaxed text-destructive">
          {state.rpcError}
        </div>
      ) : null}
      {mode === "chat" && state.extensionRequest ? (
        <ExtensionPrompt request={state.extensionRequest} />
      ) : null}

      {mode === "chat" ? (
        <>
          <ExtensionWidgets
            widgets={state.extensionWidgets}
            placement="aboveEditor"
          />
          <PiComposer root={cwd} />
          <ExtensionWidgets
            widgets={state.extensionWidgets}
            placement="belowEditor"
          />
        </>
      ) : null}
    </div>
  );
}
