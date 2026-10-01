import { cn } from "@/lib/utils";

type Props = {
  url: string;
  className?: string;
};

export function PathIcon({ url, className }: Props) {
  return (
    <img
      aria-hidden
      alt=""
      className={cn("inline-block shrink-0 object-contain", className)}
      src={url}
    />
  );
}
