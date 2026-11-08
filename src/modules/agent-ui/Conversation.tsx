import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { useStickToBottom } from "use-stick-to-bottom";
import { cn } from "@/lib/utils";

export function AgentConversation({
  children,
  className,
  busy = false,
  minimap,
}: {
  children: ReactNode;
  className?: string;
  /** True while the agent is still producing output (read mode indicator). */
  busy?: boolean;
  /** Optional right-edge scrubber, given a scroll controller. */
  minimap?: (controls: { jumpToFraction: (fraction: number) => void }) => ReactNode;
}) {
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } =
    useStickToBottom({
      initial: "instant",
      resize: "instant",
    });

  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div
          ref={contentRef}
          className="mx-auto flex min-h-full w-full max-w-[1120px] flex-col px-4 py-4"
        >
          {children}
        </div>
      </div>
      {isAtBottom ? null : (
        <button
          type="button"
          onClick={() => void scrollToBottom("smooth")}
          className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border/70 bg-popover/95 px-2 py-1 text-[12px] text-muted-foreground shadow-sm backdrop-blur transition-colors motion-reduce:transition-none hover:text-foreground"
        >
          <HugeiconsIcon icon={ArrowDown01Icon} size={11} strokeWidth={2} />
          {busy ? "New output · jump to latest" : "Latest"}
        </button>
      )}
      {busy && !isAtBottom ? (
        <span className="sr-only" role="status" aria-live="polite">
          The agent is still working while you read.
        </span>
      ) : null}
      {minimap ? (
        <div className="absolute inset-y-3 right-1 z-10">
          {minimap({
            jumpToFraction: (fraction) => {
              const element = scrollRef.current;
              if (!element) return;
              const max = element.scrollHeight - element.clientHeight;
              if (max <= 0) return;
              element.scrollTop =
                Math.min(1, Math.max(0, fraction)) * max;
            },
          })}
        </div>
      ) : null}
    </div>
  );
}
