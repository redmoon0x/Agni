import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";
import { splitStreamingMarkdown } from "@/modules/agent-ui/lib/incrementalMarkdown";
import {
  InlineCode,
  MarkdownCodeBlock,
} from "@/modules/markdown/MarkdownCodeBlock";

const markdownComponents = { code: InlineCode, pre: MarkdownCodeBlock };

export function AgentUserMessage({
  text,
  children,
}: {
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex justify-end pl-6">
      <div className="max-w-[88%] rounded-xl rounded-br-sm bg-foreground/[0.065] px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap select-text">
        {text}
        {children}
      </div>
    </div>
  );
}

export function AgentAssistantMessage({
  text,
  children,
  className,
  streaming = false,
  actions,
}: {
  text: string;
  children?: ReactNode;
  className?: string;
  streaming?: boolean;
  actions?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const split = streaming
    ? splitStreamingMarkdown(text)
    : { stable: "", tail: text };

  // The sealed prefix only changes at fence/paragraph boundaries, so memoizing
  // it skips reparsing the whole message on every token.
  const stableMarkdown = useMemo(
    () =>
      split.stable ? (
        <Streamdown className="prose-sm min-w-0" components={markdownComponents}>
          {split.stable}
        </Streamdown>
      ) : null,
    [split.stable],
  );

  const copy = () => {
    if (!text) return;
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div className={cn("group/message relative min-w-0", className)}>
      <div className="min-w-0 text-[14px] leading-relaxed select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        {stableMarkdown}
        {split.tail ? (
          <Streamdown className="prose-sm min-w-0" components={markdownComponents}>
            {split.tail}
          </Streamdown>
        ) : null}
        {children}
      </div>
      {text || actions ? (
        <div className="absolute -top-2 right-1 flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
          {actions}
          {text ? (
            <button
              type="button"
              onClick={copy}
              title={copied ? "Copied" : "Copy message"}
              aria-label={copied ? "Copied" : "Copy message"}
              className="rounded-md border border-border/50 bg-popover/95 p-1 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
            >
              <HugeiconsIcon
                icon={copied ? Tick02Icon : Copy01Icon}
                size={11}
                strokeWidth={1.8}
              />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
