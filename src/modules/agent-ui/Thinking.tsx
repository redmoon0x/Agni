import {
  ArrowDown01Icon,
  BrainIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function AgentThinking({
  text,
  streaming = false,
  label = "Thought process",
  children,
}: {
  text: string;
  streaming?: boolean;
  label?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !streaming || !text) return;
    const element = bodyRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [open, streaming, text]);

  const preview =
    text
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-1)[0] ?? "";

  return (
    <div className="rounded-md border border-border/40 bg-foreground/[0.015]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
      >
        <HugeiconsIcon
          icon={streaming ? Loading03Icon : BrainIcon}
          size={11}
          strokeWidth={1.8}
          className={cn(
            "shrink-0",
            streaming
              ? "animate-pulse text-primary"
              : "text-muted-foreground/70",
          )}
        />
        <span
          className={cn(
            "shrink-0 text-[10px] font-medium",
            streaming ? "text-primary" : "text-muted-foreground",
          )}
        >
          {streaming ? "Thinking" : label}
        </span>
        {open ? (
          <span className="flex-1" />
        ) : (
          <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground/50">
            {preview}
          </span>
        )}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={11}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div
          ref={bodyRef}
          className="max-h-64 overflow-y-auto overscroll-contain border-t border-border/40 px-2.5 py-2 text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground select-text"
        >
          {text}
          {children}
        </div>
      ) : null}
    </div>
  );
}
