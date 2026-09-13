import { Robot01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { KiloLogoIcon } from "@/modules/acp-agent/KiloLogoIcon";
import { OpenCodeLogoIcon } from "@/modules/acp-agent/OpenCodeLogoIcon";
import { PiLogoIcon } from "@/modules/pi-agent/PiLogoIcon";
import type { AgentId } from "@/modules/settings/store";

export function AgentIcon({
  agent,
  size = 15,
  className,
}: {
  agent: AgentId;
  size?: number;
  className?: string;
}) {
  if (agent === "opencode") {
    return <OpenCodeLogoIcon size={size} className={className} />;
  }
  if (agent === "kilo") {
    return <KiloLogoIcon size={size} className={className} />;
  }
  if (agent === "pi") {
    return <PiLogoIcon size={size} className={className} />;
  }
  return <HugeiconsIcon icon={Robot01Icon} size={size} className={className} />;
}
