import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { HtmlPreviewStack as HtmlPreviewStackType } from "./HtmlPreviewStack";

const HtmlPreviewStackInner = lazy(() =>
  import("./HtmlPreviewStack").then((m) => ({ default: m.HtmlPreviewStack })),
);

type Props = ComponentProps<typeof HtmlPreviewStackType>;

export function HtmlPreviewStack(props: Props) {
  return (
    <Suspense fallback={null}>
      <HtmlPreviewStackInner {...props} />
    </Suspense>
  );
}
