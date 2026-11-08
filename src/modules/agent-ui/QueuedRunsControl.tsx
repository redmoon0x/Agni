import { Cancel01Icon, PlayIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { QueuedPrompt } from "@/modules/agent-ui/lib/promptQueue";

/**
 * Editable queue stacked above the composer. Items persist as text; scheduling
 * and attachments stay in memory for the session.
 */
export function AgentQueuedRuns({
  items,
  onEdit,
  onRemove,
  onRunNow,
}: {
  items: QueuedPrompt[];
  onEdit: (id: string, text: string) => void;
  onRemove: (id: string) => void;
  onRunNow: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mx-2 mb-1 space-y-1">
      <div className="px-1 text-[9px] font-medium tracking-wide text-muted-foreground/60 uppercase">
        Queued · {items.length}
      </div>
      {items.map((item) => (
        <QueuedRow
          key={item.id}
          item={item}
          onEdit={onEdit}
          onRemove={onRemove}
          onRunNow={onRunNow}
        />
      ))}
    </div>
  );
}

function QueuedRow({
  item,
  onEdit,
  onRemove,
  onRunNow,
}: {
  item: QueuedPrompt;
  onEdit: (id: string, text: string) => void;
  onRemove: (id: string) => void;
  onRunNow: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft !== item.text) onEdit(item.id, draft.trim());
    else setDraft(item.text);
  };

  return (
    <div className="group/queued flex items-center gap-1.5 rounded-md border border-border/50 bg-foreground/[0.02] px-1.5 py-1">
      <span
        className={cn(
          "shrink-0 rounded-sm px-1 py-0.5 text-[8.5px] uppercase",
          item.mode === "steer"
            ? "bg-primary/15 text-primary"
            : "bg-foreground/[0.07] text-muted-foreground",
        )}
      >
        {item.mode === "steer" ? "now" : "next"}
      </span>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") {
              setDraft(item.text);
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-[11px] outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="min-w-0 flex-1 truncate text-left text-[11px] text-foreground/80"
          title={item.text}
        >
          {item.text}
        </button>
      )}
      {item.attachmentCount > 0 ? (
        <span className="shrink-0 text-[9px] text-muted-foreground/60">
          +{item.attachmentCount}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => onRunNow(item.id)}
        title="Run now (interrupts the current turn)"
        aria-label="Run now"
        className="shrink-0 rounded p-0.5 text-muted-foreground/60 hover:bg-foreground/[0.06] hover:text-foreground"
      >
        <HugeiconsIcon icon={PlayIcon} size={11} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        onClick={editing ? commit : () => onRemove(item.id)}
        title={editing ? "Save" : "Remove"}
        aria-label={editing ? "Save" : "Remove"}
        className="shrink-0 rounded p-0.5 text-muted-foreground/60 hover:bg-foreground/[0.06] hover:text-foreground"
      >
        <HugeiconsIcon
          icon={editing ? Tick02Icon : Cancel01Icon}
          size={11}
          strokeWidth={1.8}
        />
      </button>
    </div>
  );
}
