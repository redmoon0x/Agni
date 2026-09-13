import { useTheme } from "@/modules/theme/ThemeProvider";

export function OpenCodeLogoIcon({
  size = 15,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const { resolvedMode } = useTheme();
  const dark = resolvedMode === "dark";
  return (
    <svg
      viewBox="0 0 240 300"
      width={size}
      height={size}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      aria-hidden="true"
    >
      <path d="M180 240H60V120H180V240Z" fill={dark ? "#CFCECD" : "#4B4646"} />
      <path
        d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z"
        fill={dark ? "#211E1E" : "#F1ECEC"}
      />
    </svg>
  );
}
