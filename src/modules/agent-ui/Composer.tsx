import { ArrowUp02Icon, Square01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function AgentSuggestions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "absolute inset-x-2 bottom-full z-10 mb-1 overflow-hidden rounded-xl border border-border/80 bg-popover shadow-lg ring-1 ring-foreground/5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function AgentSuggestionItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px]",
        active
          ? "bg-accent text-accent-foreground"
          : "text-foreground hover:bg-foreground/[0.04]",
      )}
    >
      {children}
    </button>
  );
}

export function AgentComposerFrame({
  suggestions,
  attachments,
  input,
  toolbar,
  hint,
}: {
  suggestions?: ReactNode;
  attachments?: ReactNode;
  input: ReactNode;
  toolbar: ReactNode;
  hint?: string;
}) {
  return (
    <div className="relative shrink-0 px-2 pb-2">
      {suggestions}
      <div className="rounded-xl border border-border/70 bg-background/70 shadow-sm transition-colors focus-within:border-ring/60">
        {attachments}
        {input}
        <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5">
          {toolbar}
        </div>
      </div>
      {hint ? (
        <p className="mt-1 px-1 text-[9px] text-muted-foreground/50">{hint}</p>
      ) : null}
    </div>
  );
}

export function AgentComposerTextarea({
  className,
  ...props
}: ComponentProps<"textarea">) {
  return (
    <textarea
      rows={3}
      className={cn(
        "block max-h-40 min-h-16 w-full resize-none bg-transparent px-3 pt-3 text-[12px] leading-relaxed outline-none placeholder:text-muted-foreground/70 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function AgentComposerChip({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "max-w-40 truncate rounded-md px-1.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function AgentComposerIconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function AgentComposerSendButton({
  streaming,
  disabled,
  onClick,
}: {
  streaming: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={streaming ? "Stop" : "Send"}
      disabled={disabled}
      onClick={onClick}
      className="ml-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-35"
    >
      <HugeiconsIcon
        icon={streaming ? Square01Icon : ArrowUp02Icon}
        size={14}
        strokeWidth={2.2}
      />
    </button>
  );
}

export function AgentAttachmentRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-1.5 px-3 pt-2">{children}</div>;
}

export function AgentAttachmentChip({
  name,
  preview,
  badge,
  onRemove,
}: {
  name: string;
  preview?: ReactNode;
  badge?: string;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      title={`Remove ${name}`}
      onClick={onRemove}
      className="flex max-w-36 items-center gap-1 rounded-md bg-foreground/[0.06] px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-foreground/[0.1] hover:text-foreground"
    >
      {preview ??
        (badge ? (
          <span className="rounded-sm bg-foreground/[0.08] px-1 text-[9px] uppercase">
            {badge}
          </span>
        ) : null)}
      <span className="truncate">{name}</span>
    </button>
  );
}
