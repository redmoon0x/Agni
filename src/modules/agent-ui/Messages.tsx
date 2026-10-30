import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";
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
      <div className="max-w-[88%] rounded-xl rounded-br-sm bg-foreground/[0.055] px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap select-text">
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
}: {
  text: string;
  children?: ReactNode;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (!text) return;
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div className={cn("group/message relative min-w-0", className)}>
      <div className="min-w-0 text-[12px] leading-relaxed select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        {text ? (
          <Streamdown
            className="prose-sm min-w-0"
            components={markdownComponents}
          >
            {text}
          </Streamdown>
        ) : null}
        {children}
      </div>
      {text ? (
        <button
          type="button"
          onClick={copy}
          title={copied ? "Copied" : "Copy message"}
          aria-label={copied ? "Copied" : "Copy message"}
          className="absolute -top-2 -right-1 rounded-md border border-border/50 bg-popover/95 p-1 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/message:opacity-100"
        >
          <HugeiconsIcon
            icon={copied ? Tick02Icon : Copy01Icon}
            size={11}
            strokeWidth={1.8}
          />
        </button>
      ) : null}
    </div>
  );
}
