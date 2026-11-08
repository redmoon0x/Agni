import { cn } from "@/lib/utils";
import type { MinimapMarker } from "@/modules/agent-ui/lib/minimap";

const TONE: Record<MinimapMarker["tone"], string> = {
  user: "bg-foreground/60",
  agent: "bg-foreground/25",
  tool: "bg-foreground/15",
  error: "bg-destructive",
};

/**
 * Right-edge scrubber over the whole thread. Markers jump to their position;
 * clicking the track jumps proportionally. Hidden on short threads.
 */
export function AgentTimelineMinimap({
  markers,
  onJump,
}: {
  markers: MinimapMarker[];
  onJump: (position: number) => void;
}) {
  if (markers.length < 8) return null;
  return (
    <div
      className="relative h-full w-3 cursor-pointer rounded-full bg-background/30 backdrop-blur transition-colors motion-reduce:transition-none hover:bg-background/50"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.height <= 0) return;
        onJump((event.clientY - rect.top) / rect.height);
      }}
      role="presentation"
    >
      {markers.map((marker, index) => (
        <button
          key={index}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onJump(marker.position);
          }}
          title={`Jump to ${Math.round(marker.position * 100)}%`}
          aria-label={`Jump to ${Math.round(marker.position * 100)} percent`}
          style={{ top: `${marker.position * 100}%` }}
          className={cn(
            "absolute left-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform hover:scale-150 focus-visible:scale-150",
            TONE[marker.tone],
          )}
        />
      ))}
    </div>
  );
}
