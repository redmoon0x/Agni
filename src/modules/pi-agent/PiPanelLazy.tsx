import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { PiPanel as PiPanelType } from "@/modules/pi-agent/PiPanel";

const PiPanelInner = lazy(() =>
  import("@/modules/pi-agent/PiPanel").then((module) => ({
    default: module.PiPanel,
  })),
);

type Props = ComponentProps<typeof PiPanelType>;

export function PiPanel(props: Props) {
  return (
    <Suspense fallback={null}>
      <PiPanelInner {...props} />
    </Suspense>
  );
}
