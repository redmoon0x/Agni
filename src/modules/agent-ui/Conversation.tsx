import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { useStickToBottom } from "use-stick-to-bottom";
import { cn } from "@/lib/utils";

export function AgentConversation({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
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
          className="mx-auto flex min-h-full w-full max-w-[860px] flex-col px-3 py-3"
        >
          {children}
        </div>
      </div>
      {isAtBottom ? null : (
        <button
          type="button"
          onClick={() => void scrollToBottom("smooth")}
          className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border/70 bg-popover/95 px-2 py-1 text-[10px] text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
        >
          <HugeiconsIcon icon={ArrowDown01Icon} size={11} strokeWidth={2} />
          Latest
        </button>
      )}
    </div>
  );
}
