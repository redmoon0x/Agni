import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Spinner } from "@/components/ui/spinner";
import {
  native,
  type GitBranch,
  type GitDeleteMergedBranchesResult,
} from "@/lib/native";
import {
  ArrowRight01Icon,
  GitBranchIcon,
  PlusSignIcon,
  Refresh01Icon,
  RemoveSquareIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  repoRoot: string | null;
  currentBranch: string | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void>;
};

function normalizeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown Git branch error";
}

function branchValue(branch: GitBranch): string {
  return `branch:${branch.fullName}`;
}

function matchesQuery(branch: GitBranch, query: string): boolean {
  const q = query.toLowerCase();
  if (!q) return true;
  return [branch.name, branch.upstream ?? "", branch.lastCommit ?? ""]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

function canCreateBranch(name: string): boolean {
  const value = name.trim();
  if (!value || value.length > 128) return false;
  if (value.startsWith("-") || value.startsWith("/") || value.endsWith("/")) {
    return false;
  }
  if (value.includes("..") || value.includes("@{") || value.endsWith(".lock")) {
    return false;
  }
  return !/[\\\s~^:?*[\]\0]/.test(value);
}

function resultMessage(result: GitDeleteMergedBranchesResult): string {
  if (result.deleted.length === 0 && result.skipped.length === 0) {
    return "No merged local branches to delete.";
  }
  const parts: string[] = [];
  if (result.deleted.length > 0) {
    parts.push(
      `Deleted ${result.deleted.length} merged local branch${result.deleted.length === 1 ? "" : "es"}.`,
    );
  }
  if (result.skipped.length > 0) {
    parts.push(
      `Skipped ${result.skipped.length} protected or busy branch${result.skipped.length === 1 ? "" : "es"}.`,
    );
  }
  return parts.join(" ");
}

export function BranchSwitcher({
  open,
  repoRoot,
  currentBranch,
  onOpenChange,
  onChanged,
}: Props) {
  const [query, setQuery] = useState("");
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const load = useCallback(async () => {
    if (!repoRoot) return;
    setLoading(true);
    setError(null);
    try {
      setBranches(await native.gitBranches(repoRoot));
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setLoading(false);
    }
  }, [repoRoot]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setError(null);
      setMessage(null);
      setBusy(null);
      setConfirmDeleteOpen(false);
      return;
    }
    void load();
  }, [load, open]);

  const localBranches = useMemo(
    () =>
      branches.filter(
        (branch) => !branch.remote && matchesQuery(branch, query),
      ),
    [branches, query],
  );
  const remoteBranches = useMemo(
    () =>
      branches.filter((branch) => branch.remote && matchesQuery(branch, query)),
    [branches, query],
  );
  const createName = query.trim();
  const branchExists = branches.some((branch) => branch.name === createName);
  const showCreate = canCreateBranch(createName) && !branchExists;

  const checkoutBranch = useCallback(
    async (branch: GitBranch) => {
      if (!repoRoot || branch.current || busy) return;
      setBusy(`checkout:${branch.fullName}`);
      setError(null);
      setMessage(null);
      try {
        await native.gitCheckoutBranch(repoRoot, branch.name, branch.remote);
        await onChanged();
        onOpenChange(false);
      } catch (err) {
        setError(normalizeError(err));
      } finally {
        setBusy(null);
      }
    },
    [busy, onChanged, onOpenChange, repoRoot],
  );

  const createBranch = useCallback(async () => {
    if (!repoRoot || !showCreate || busy) return;
    setBusy("create");
    setError(null);
    setMessage(null);
    try {
      await native.gitCreateBranch(repoRoot, createName, true);
      await onChanged();
      onOpenChange(false);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(null);
    }
  }, [busy, createName, onChanged, onOpenChange, repoRoot, showCreate]);

  const deleteMergedBranches = useCallback(async () => {
    if (!repoRoot || busy) return;
    setConfirmDeleteOpen(false);
    setBusy("delete-merged");
    setError(null);
    setMessage(null);
    try {
      const result = await native.gitDeleteMergedBranches(repoRoot);
      setMessage(resultMessage(result));
      await load();
      await onChanged();
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(null);
    }
  }, [busy, load, onChanged, repoRoot]);

  const hasResults =
    localBranches.length > 0 || remoteBranches.length > 0 || showCreate;
  const deleteBusy = busy === "delete-merged";

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Switch Branch"
        description="Search, checkout, create, or delete merged Git branches."
        className="top-1/2 w-[min(620px,calc(100vw-32px))] -translate-y-1/2"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search branches or type a new branch name..."
          />
          <CommandList className="max-h-[360px]">
            {loading ? (
              <StatusItem label="Loading branches..." />
            ) : error ? (
              <StatusItem label={error} tone="error" />
            ) : hasResults ? (
              <>
                {showCreate ? (
                  <CommandGroup heading="Create">
                    <CommandItem
                      value={`create:${createName}`}
                      onSelect={createBranch}
                      disabled={!!busy}
                      className="text-[12.5px]"
                    >
                      <HugeiconsIcon
                        icon={PlusSignIcon}
                        size={14}
                        strokeWidth={1.8}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        Create and checkout {createName}
                      </span>
                    </CommandItem>
                  </CommandGroup>
                ) : null}
                {localBranches.length > 0 ? (
                  <CommandGroup heading="Local">
                    {localBranches.map((branch) => (
                      <BranchItem
                        key={branch.fullName}
                        branch={branch}
                        busy={busy === `checkout:${branch.fullName}`}
                        disabled={!!busy || branch.current}
                        onSelect={() => void checkoutBranch(branch)}
                      />
                    ))}
                  </CommandGroup>
                ) : null}
                {remoteBranches.length > 0 ? (
                  <CommandGroup heading="Remote">
                    {remoteBranches.map((branch) => (
                      <BranchItem
                        key={branch.fullName}
                        branch={branch}
                        busy={busy === `checkout:${branch.fullName}`}
                        disabled={!!busy || branch.current}
                        onSelect={() => void checkoutBranch(branch)}
                      />
                    ))}
                  </CommandGroup>
                ) : null}
              </>
            ) : (
              <StatusItem label="No branches found" />
            )}
          </CommandList>
          <div className="flex min-h-11 items-center gap-2 border-t border-border/50 px-3 py-2">
            <div className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              {message ??
                (currentBranch
                  ? `Current: ${currentBranch}`
                  : "No current branch")}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={loading || !!busy}
              onClick={() => void load()}
              title="Refresh branches"
            >
              {loading ? (
                <Spinner className="size-3" />
              ) : (
                <HugeiconsIcon
                  icon={Refresh01Icon}
                  size={13}
                  strokeWidth={1.9}
                />
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!repoRoot || loading || !!busy}
              onClick={() => setConfirmDeleteOpen(true)}
            >
              {deleteBusy ? (
                <Spinner className="size-3" />
              ) : (
                <HugeiconsIcon
                  icon={RemoveSquareIcon}
                  size={13}
                  strokeWidth={1.9}
                />
              )}
              Delete merged
            </Button>
          </div>
        </Command>
      </CommandDialog>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete merged branches?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes local branches already merged into the current
              branch. Protected branches like main, master, develop, dev, and
              trunk are skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteMergedBranches()}>
              Delete merged
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function BranchItem({
  branch,
  busy,
  disabled,
  onSelect,
}: {
  branch: GitBranch;
  busy: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const rightLabel = branch.current
    ? "current"
    : branch.remote
      ? "track"
      : (branch.lastCommit ?? null);
  return (
    <CommandItem
      value={branchValue(branch)}
      data-checked={branch.current ? true : undefined}
      disabled={disabled}
      onSelect={onSelect}
      className="text-[12.5px]"
    >
      {busy ? (
        <Spinner className="size-3.5" />
      ) : (
        <HugeiconsIcon
          icon={branch.remote ? ArrowRight01Icon : GitBranchIcon}
          size={14}
          strokeWidth={1.8}
          className="text-muted-foreground"
        />
      )}
      <span className="min-w-0 flex-1 truncate">{branch.name}</span>
      {rightLabel ? (
        <CommandShortcut className="normal-case tracking-normal">
          {rightLabel}
        </CommandShortcut>
      ) : null}
    </CommandItem>
  );
}

function StatusItem({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: "muted" | "error";
}) {
  return (
    <CommandItem value={`status:${label}`} disabled className="text-[12.5px]">
      <span
        className={
          tone === "error" ? "text-destructive" : "text-muted-foreground"
        }
      >
        {label}
      </span>
    </CommandItem>
  );
}
