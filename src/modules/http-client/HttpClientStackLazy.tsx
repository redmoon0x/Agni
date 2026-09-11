import type { ComponentProps } from "react";
import { lazy, Suspense } from "react";
import type { HttpClientStack as HttpClientStackType } from "./HttpClientStack";

const HttpClientStackInner = lazy(() =>
  import("./HttpClientStack").then((m) => ({ default: m.HttpClientStack })),
);

type Props = ComponentProps<typeof HttpClientStackType>;

export function HttpClientStack(props: Props) {
  return (
    <Suspense fallback={null}>
      <HttpClientStackInner {...props} />
    </Suspense>
  );
}
