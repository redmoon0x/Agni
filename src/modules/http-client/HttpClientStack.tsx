import { cn } from "@/lib/utils";
import type { HttpClientTab, Tab } from "@/modules/tabs";
import { HttpClientPane } from "./HttpClientPane";

type Props = {
  tabs: Tab[];
  activeId: number;
};

export function HttpClientStack({ tabs, activeId }: Props) {
  const clients = tabs.filter(
    (t): t is HttpClientTab => t.kind === "http-client",
  );
  if (clients.length === 0) return null;
  return (
    <div className="relative h-full w-full">
      {clients.map((t) => {
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
            <HttpClientPane title={t.title} url={t.url} />
          </div>
        );
      })}
    </div>
  );
}
