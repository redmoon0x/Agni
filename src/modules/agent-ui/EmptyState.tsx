import type { ReactNode } from "react";

export function AgentEmptyState({
  mark,
  title,
  hint,
  children,
}: {
  mark: ReactNode;
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl border border-border/50 bg-background/40 text-muted-foreground">
        {mark}
      </div>
      <p className="mt-3 text-[12px] font-medium text-foreground/80">{title}</p>
      {hint ? (
        <p className="mt-1 max-w-64 text-[10.5px] leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {children}
    </div>
  );
}
