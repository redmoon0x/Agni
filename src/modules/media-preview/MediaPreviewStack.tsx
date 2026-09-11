import { cn } from "@/lib/utils";
import type { ImageTab, PdfTab, Tab } from "@/modules/tabs";
import { MediaPreviewPane } from "./MediaPreviewPane";

type Props = {
  tabs: Tab[];
  activeId: number;
};

export function MediaPreviewStack({ tabs, activeId }: Props) {
  const media = tabs.filter(
    (t): t is ImageTab | PdfTab => t.kind === "image" || t.kind === "pdf",
  );
  if (media.length === 0) return null;
  return (
    <div className="relative h-full w-full">
      {media.map((t) => {
        const visible = t.id === activeId;
        return (
          <div
            key={t.id}
            className={cn(
              "absolute inset-0",
              !visible && "invisible pointer-events-none",
            )}
            aria-hidden={!visible}
          >
            <MediaPreviewPane path={t.path} kind={t.kind} />
          </div>
        );
      })}
    </div>
  );
}
