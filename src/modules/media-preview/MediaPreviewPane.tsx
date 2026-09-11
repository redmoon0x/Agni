import { useBase64File } from "./lib/useBase64File";

type Props = {
  path: string;
  kind: "image" | "pdf";
};

export function MediaPreviewPane({ path, kind }: Props) {
  const status = useBase64File(path);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background">
      {status.kind === "ready" ? (
        kind === "image" ? (
          <div className="flex h-full w-full items-center justify-center overflow-auto p-4">
            <img
              src={status.dataUrl}
              alt={path}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : (
          <iframe
            src={status.dataUrl}
            title={path}
            className="h-full w-full border-0 bg-white"
          />
        )
      ) : (
        <div className="flex-1 overflow-auto px-6 py-4">
          {status.kind === "loading" && (
            <p className="text-[12px] text-muted-foreground">Loading...</p>
          )}
          {status.kind === "error" && (
            <p className="text-[12px] text-destructive">
              Failed to load file: {status.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
