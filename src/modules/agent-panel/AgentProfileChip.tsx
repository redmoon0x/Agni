import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { defaultProfileFor } from "@/modules/agent-panel/lib/profile";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";

type Props = {
  agent: string;
  profileId?: string | null;
  onSwitchProfile?: (profileId: string) => void;
};

/**
 * The active harness account. Switching replaces the current session tab, so
 * the chip is the only account control (no duplicate in the composer).
 */
export function AgentProfileChip({ agent, profileId, onSwitchProfile }: Props) {
  const profiles = usePreferencesStore((state) => state.agentProfiles);
  const defaults = usePreferencesStore((state) => state.agentDefaultProfile);
  const active = profileId
    ? (profiles.find((profile) => profile.id === profileId) ?? null)
    : defaultProfileFor(profiles, agent, defaults);
  if (!active) return null;

  const options = profiles.filter(
    (profile) => profile.enabled && profile.agent === agent,
  );
  const title = active.accountLabel ?? active.label;

  const chip = (
    <>
      <span className="max-w-24 truncate">{active.label}</span>
      {onSwitchProfile && options.length > 1 ? (
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={10}
          strokeWidth={2}
          className="shrink-0 opacity-70"
        />
      ) : null}
    </>
  );
  const chipClass = cn(
    "flex items-center gap-1 rounded-md border border-border/60 bg-foreground/[0.03] px-1.5 py-0.5",
    "text-[9.5px] font-medium text-muted-foreground",
    onSwitchProfile &&
      options.length > 1 &&
      "transition-colors hover:bg-foreground/[0.07] hover:text-foreground",
  );

  if (!onSwitchProfile || options.length <= 1) {
    return (
      <span className={chipClass} title={title}>
        {chip}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account ${active.label}`}
          title={title}
          className={chipClass}
        >
          {chip}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-[10px]">Account</DropdownMenuLabel>
        {options.map((profile) => (
          <DropdownMenuItem
            key={profile.id}
            onSelect={() => {
              if (profile.id !== active.id) onSwitchProfile(profile.id);
            }}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[11.5px]">{profile.label}</span>
              {profile.accountLabel ? (
                <span className="truncate text-[9.5px] text-muted-foreground">
                  {profile.accountLabel}
                </span>
              ) : null}
            </span>
            {profile.id === active.id ? (
              <HugeiconsIcon icon={Tick02Icon} size={14} />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void openSettingsWindow("providers")}>
          Manage accounts…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
