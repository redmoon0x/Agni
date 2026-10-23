import { cn } from "@/lib/utils";
import { useTheme } from "@/modules/theme/ThemeProvider";

/**
 * The official Hermes mark, shipped as a static asset because the artwork is
 * too detailed to inline. The light and dark files are the two official
 * renditions, so only the one in use is ever fetched.
 */
export function HermesLogoIcon({
  size = 15,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const { resolvedMode } = useTheme();
  return (
    <img
      src={resolvedMode === "dark" ? "/hermes-dark.svg" : "/hermes.svg"}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 object-contain", className)}
      draggable={false}
    />
  );
}
