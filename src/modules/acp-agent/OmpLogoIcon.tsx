import { useId } from "react";

export function OmpLogoIcon({
  size = 15,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const gradientId = useId();
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(0.7 0.24 340)" />
          <stop offset=".5" stopColor="oklch(0.62 0.21 295)" />
          <stop offset="1" stopColor="oklch(0.81 0.14 200)" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradientId})`}
        d="M10 14h44v9H43v33h-9V23h-9v22h-9V23H10z"
      />
    </svg>
  );
}
