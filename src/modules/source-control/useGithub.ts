import { useCallback, useEffect, useRef, useState } from "react";
import {
  type GithubAvailability,
  type GithubPullRequest,
  native,
} from "@/lib/native";
import { currentWorkspaceEnv } from "@/modules/workspace";

const PR_REFRESH_MS = 60_000;

export type CreatePullRequestInput = {
  title: string;
  body: string;
  base: string | null;
  draft: boolean;
};

export type GithubState = {
  availability: GithubAvailability | null;
  pullRequest: GithubPullRequest | null;
  loading: boolean;
  error: string | null;
  creating: boolean;
  refresh: () => Promise<void>;
  create: (input: CreatePullRequestInput) => Promise<GithubPullRequest>;
};

function normalizeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "GitHub request failed";
}

/** Availability never changes during a session; probe once and share it. */
let availabilityPromise: Promise<GithubAvailability> | null = null;
function probeAvailability(): Promise<GithubAvailability> {
  if (!availabilityPromise) {
    availabilityPromise = native.githubAvailable().catch(() => ({
      installed: false,
      authenticated: false,
      account: null,
    }));
  }
  return availabilityPromise;
}

/** Reset for tests. */
export function resetGithubAvailabilityForTests(): void {
  availabilityPromise = null;
}

/**
 * The current branch's pull request, checks and PR creation, through the
 * user's own `gh` login. Nothing is requested when gh is absent or the branch
 * is detached, so a repo without GitHub costs one availability probe.
 */
export function useGithub(
  repoRoot: string | null,
  branch: string | null,
  enabled: boolean,
): GithubState {
  const [availability, setAvailability] = useState<GithubAvailability | null>(
    null,
  );
  const [pullRequest, setPullRequest] = useState<GithubPullRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const requestIdRef = useRef(0);

  const canQuery =
    enabled && !!repoRoot && !!branch && branch !== "detached";

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void probeAvailability().then((result) => {
      if (alive) setAvailability(result);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);

  const refresh = useCallback(async () => {
    if (!canQuery || !repoRoot || !branch) {
      setPullRequest(null);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const next = await native.githubPrStatus(
        repoRoot,
        branch,
        currentWorkspaceEnv(),
      );
      if (requestId !== requestIdRef.current) return;
      setPullRequest(next);
      setError(null);
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      setError(normalizeError(caught));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [branch, canQuery, repoRoot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!canQuery) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, PR_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [canQuery, refresh]);

  const create = useCallback(
    async (input: CreatePullRequestInput) => {
      if (!repoRoot) throw new Error("No repository is open");
      setCreating(true);
      setError(null);
      try {
        const created = await native.githubPrCreate(
          {
            repoRoot,
            title: input.title,
            body: input.body,
            base: input.base,
            draft: input.draft,
          },
          currentWorkspaceEnv(),
        );
        setPullRequest(created);
        return created;
      } catch (caught) {
        const message = normalizeError(caught);
        setError(message);
        throw new Error(message);
      } finally {
        setCreating(false);
      }
    },
    [repoRoot],
  );

  return {
    availability,
    pullRequest,
    loading,
    error,
    creating,
    refresh,
    create,
  };
}
