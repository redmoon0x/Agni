import { cn } from "@/lib/utils";

type Props = {
  url: string;
  className?: string;
};

/**
 * Renders a file/folder glyph as a CSS mask instead of an <img>, so it picks
 * up `currentColor` and stays monochrome and theme-tinted regardless of the
 * icon source's own stroke colors.
 */
export function PathIcon({ url, className }: Props) {
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 bg-current", className)}
      style={{
        WebkitMaskImage: `url("${url}")`,
        maskImage: `url("${url}")`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
    />
  );
}
