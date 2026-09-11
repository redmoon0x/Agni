import {
  Cancel01Icon,
  ComputerTerminal02Icon,
  Eraser01Icon,
  LayoutTwoColumnIcon,
  LayoutTwoRowIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import type { SplitDir } from "@/modules/terminal/lib/panes";

function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i === -1 ? path : path.slice(i + 1);
}

type Props = {
  cwd: string | null;
  canSplit: boolean;
  onSplit: (dir: SplitDir) => void;
  onClear: () => void;
  onHide: () => void;
};

export function TerminalDockHeader({
  cwd,
  canSplit,
  onSplit,
  onClear,
  onHide,
}: Props) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-0.5 border-b border-border/60 px-2">
      <HugeiconsIcon
        icon={ComputerTerminal02Icon}
        size={13}
        strokeWidth={1.75}
        className="mr-1 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted-foreground">
        Terminal{cwd ? ` · ${basename(cwd) || cwd}` : ""}
      </span>
      <ToolbarButton
        title="Split right"
        icon={LayoutTwoColumnIcon}
        disabled={!canSplit}
        onClick={() => onSplit("row")}
      />
      <ToolbarButton
        title="Split down"
        icon={LayoutTwoRowIcon}
        disabled={!canSplit}
        onClick={() => onSplit("col")}
      />
      <ToolbarButton title="Clear terminal" icon={Eraser01Icon} onClick={onClear} />
      <ToolbarButton title="Hide terminal panel" icon={Cancel01Icon} onClick={onHide} />
    </div>
  );
}

function ToolbarButton({
  icon,
  title,
  onClick,
  disabled,
}: {
  icon: IconSvgElement;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
    >
      <HugeiconsIcon icon={icon} size={13} strokeWidth={1.75} />
    </Button>
  );
}
