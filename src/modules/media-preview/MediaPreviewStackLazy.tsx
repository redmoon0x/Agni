import type { ComponentProps } from "react";
import { lazy, Suspense } from "react";
import type { MediaPreviewStack as MediaPreviewStackType } from "./MediaPreviewStack";

const MediaPreviewStackInner = lazy(() =>
  import("./MediaPreviewStack").then((m) => ({ default: m.MediaPreviewStack })),
);

type Props = ComponentProps<typeof MediaPreviewStackType>;

export function MediaPreviewStack(props: Props) {
  return (
    <Suspense fallback={null}>
      <MediaPreviewStackInner {...props} />
    </Suspense>
  );
}
