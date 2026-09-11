import { useEffect, useRef, useState } from "react";
import type { RectPx } from "./resolve";

type Props = {
  anchor: RectPx;
  containerSize: { width: number; height: number };
  targetLabel: string;
  onCancel: () => void;
  onSubmit: (instruction: string) => void;
};

const POPOVER_WIDTH = 280;
const POPOVER_HEIGHT = 190;
const GAP = 12;
const PADDING = 12;

/**
 * Popover anchored near a selected region, carrying the resolved target
 * label and an instruction textarea. Clamped inside the preview container.
 */
export function AnnotationComposer({
  anchor,
  containerSize,
  targetLabel,
  onCancel,
  onSubmit,
}: Props) {
  const [instruction, setInstruction] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const left = Math.max(
    PADDING,
    Math.min(anchor.x + GAP, containerSize.width - POPOVER_WIDTH - PADDING),
  );
  const top = Math.max(
    PADDING,
    Math.min(anchor.y + GAP, containerSize.height - POPOVER_HEIGHT - PADDING),
  );

  return (
    <div
      className="absolute z-20 overflow-hidden rounded-xl border border-border/80 bg-popover shadow-lg ring-1 ring-foreground/5"
      style={{ left, top, width: POPOVER_WIDTH }}
      role="dialog"
      aria-label="Annotate for Pi"
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <span className="text-[11px] font-semibold">Send to Pi</span>
        <span className="min-w-0 flex-1 truncate text-right text-[10px] text-muted-foreground">
          {targetLabel}
        </span>
      </div>
      <div className="p-2.5">
        <textarea
          ref={textareaRef}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (instruction.trim()) onSubmit(instruction.trim());
            }
            if (event.key === "Escape") onCancel();
          }}
          placeholder="What should Pi change here?"
          rows={3}
          className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-2 text-[12px] leading-relaxed outline-none focus:border-ring"
        />
        <div className="mt-2 flex justify-end gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-foreground/[0.05]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!instruction.trim()}
            onClick={() => onSubmit(instruction.trim())}
            className="rounded-md bg-primary px-2.5 py-1.5 text-[11px] text-primary-foreground disabled:opacity-40"
          >
            Send to Pi
          </button>
        </div>
      </div>
    </div>
  );
}
