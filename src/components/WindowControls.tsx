import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";

export function WindowControls() {
  if (!USE_CUSTOM_WINDOW_CONTROLS) return null;

  return (
    <div className="flex h-full shrink-0 items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={() => void getCurrentWindow().close()}
        className="grid h-full w-10 place-items-center text-muted-foreground hover:bg-red-600 hover:text-white"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}
