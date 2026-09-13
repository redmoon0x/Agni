import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { AcpPanel as AcpPanelType } from "@/modules/acp-agent/AcpPanel";

const AcpPanelInner = lazy(() =>
  import("@/modules/acp-agent/AcpPanel").then((module) => ({
    default: module.AcpPanel,
  })),
);

type Props = ComponentProps<typeof AcpPanelType>;

export function AcpPanel(props: Props) {
  return (
    <Suspense fallback={null}>
      <AcpPanelInner {...props} />
    </Suspense>
  );
}
