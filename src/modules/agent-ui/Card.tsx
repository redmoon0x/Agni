import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function AgentCard({
  eyebrow,
  icon,
  title,
  description,
  tone = "default",
  children,
  className,
}: {
  eyebrow?: string;
  icon?: ReactNode;
  title: string;
  description?: string | null;
  tone?: "default" | "primary" | "danger";
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-2 mb-2 rounded-lg border p-2.5 shadow-sm",
        tone === "default" && "border-border/70 bg-foreground/[0.02]",
        tone === "primary" && "border-primary/30 bg-primary/[0.035]",
        tone === "danger" && "border-destructive/30 bg-destructive/[0.035]",
        className,
      )}
    >
      {eyebrow ? (
        <div
          className={cn(
            "mb-1 flex items-center gap-1 text-[9px] font-medium tracking-wide uppercase",
            tone === "default" && "text-muted-foreground",
            tone === "primary" && "text-primary",
            tone === "danger" && "text-destructive",
          )}
        >
          {icon}
          {eyebrow}
        </div>
      ) : null}
      <div className="text-[11.5px] font-medium">{title}</div>
      {description ? (
        <p className="mt-1 text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {description}
        </p>
      ) : null}
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

export function AgentError({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div className="mx-2 mb-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.04] px-2.5 py-2 text-[10px] leading-relaxed text-destructive">
      <span className="mt-px shrink-0 text-[10px] font-semibold">!</span>
      <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">
        {message}
      </span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          title="Dismiss"
          className="shrink-0 rounded p-0.5 text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}
