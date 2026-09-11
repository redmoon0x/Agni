import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { EditorStack, GitDiffStack } from "@/modules/editor";
import { GitHistoryStack } from "@/modules/git-history";
import { HtmlPreviewStack } from "@/modules/html-preview";
import { HttpClientStack } from "@/modules/http-client";
import { MarkdownStack } from "@/modules/markdown";
import { MediaPreviewStack } from "@/modules/media-preview";
import { PiPanel } from "@/modules/pi-agent";
import { PreviewStack } from "@/modules/preview";
import type { Tab } from "@/modules/tabs";
import type { WorkspaceEnv } from "@/modules/workspace";

type EditorStackProps = ComponentProps<typeof EditorStack>;
type PreviewStackProps = ComponentProps<typeof PreviewStack>;
type GitHistoryStackProps = ComponentProps<typeof GitHistoryStack>;

type Props = {
  tabs: Tab[];
  activeId: number;
  activeTab: Tab | undefined;
  registerEditorHandle: EditorStackProps["registerHandle"];
  onEditorDirtyChange: EditorStackProps["onDirtyChange"];
  onEditorCloseTab: EditorStackProps["onCloseTab"];
  registerPreviewHandle: PreviewStackProps["registerHandle"];
  onPreviewUrlChange: PreviewStackProps["onUrlChange"];
  onOpenCommitFile: GitHistoryStackProps["onOpenCommitFile"];
  onGitHistorySearchHandle: GitHistoryStackProps["onSearchHandle"];
  piCwd: string | null;
  piWorkspace: WorkspaceEnv;
};

/**
 * Stacks every tab-kind surface absolutely on top of each other and toggles
 * visibility off the active tab, so panes keep their mounted state (editor
 * scroll, ...) when switching tabs. Renders an empty state when no tabs are open.
 */
export function WorkspaceSurface({
  tabs,
  activeId,
  activeTab,
  registerEditorHandle,
  onEditorDirtyChange,
  onEditorCloseTab,
  registerPreviewHandle,
  onPreviewUrlChange,
  onOpenCommitFile,
  onGitHistorySearchHandle,
  piCwd,
  piWorkspace,
}: Props) {
  const kind = activeTab?.kind;
  const isEditorTab = kind === "editor";
  const isPreviewTab = kind === "preview";
  const isMarkdownTab = kind === "markdown";
  const isHtmlPreviewTab = kind === "html";
  const isMediaTab = kind === "image" || kind === "pdf";
  const isGitDiffTab = kind === "git-diff" || kind === "git-commit-file";
  const isGitHistoryTab = kind === "git-history";
  const isHttpClientTab = kind === "http-client";
  const isPiTab = kind === "pi";
  const hasPiTab = tabs.some((t) => t.kind === "pi");

  return (
    <div className="relative h-full min-h-0">
      {tabs.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-3 pt-2 pb-2 text-center text-muted-foreground">
          <p className="text-sm font-medium">No files open</p>
          <p className="text-xs">
            Open a file from the explorer, or press Cmd+E to create one.
          </p>
        </div>
      ) : null}
      <div
        className={cn(
          "absolute inset-0 px-3 pt-2 pb-2",
          !isEditorTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isEditorTab}
      >
        <EditorStack
          tabs={tabs}
          activeId={activeId}
          registerHandle={registerEditorHandle}
          onDirtyChange={onEditorDirtyChange}
          onCloseTab={onEditorCloseTab}
        />
      </div>
      <div
        className={cn(
          "absolute inset-0 px-3 pt-2 pb-2",
          !isPreviewTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isPreviewTab}
      >
        <PreviewStack
          tabs={tabs}
          activeId={activeId}
          registerHandle={registerPreviewHandle}
          onUrlChange={onPreviewUrlChange}
        />
      </div>
      <div
        className={cn(
          "absolute inset-0 px-3 pt-2 pb-2",
          !isMarkdownTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isMarkdownTab}
      >
        <MarkdownStack tabs={tabs} activeId={activeId} />
      </div>
      <div
        className={cn(
          "absolute inset-0 px-3 pt-2 pb-2",
          !isHtmlPreviewTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isHtmlPreviewTab}
      >
        <HtmlPreviewStack tabs={tabs} activeId={activeId} />
      </div>
      <div
        className={cn(
          "absolute inset-0 px-3 pt-2 pb-2",
          !isMediaTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isMediaTab}
      >
        <MediaPreviewStack tabs={tabs} activeId={activeId} />
      </div>
      <div
        className={cn(
          "absolute inset-0 px-3 pt-2 pb-2",
          !isGitDiffTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isGitDiffTab}
      >
        <GitDiffStack tabs={tabs} activeId={activeId} />
      </div>
      <div
        className={cn(
          "absolute inset-0",
          !isGitHistoryTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isGitHistoryTab}
      >
        <GitHistoryStack
          tabs={tabs}
          activeId={activeId}
          onOpenCommitFile={onOpenCommitFile}
          onSearchHandle={onGitHistorySearchHandle}
        />
      </div>
      <div
        className={cn(
          "absolute inset-0",
          !isHttpClientTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isHttpClientTab}
      >
        <HttpClientStack tabs={tabs} activeId={activeId} />
      </div>
      {hasPiTab ? (
        <div
          className={cn(
            "absolute inset-0",
            !isPiTab && "invisible pointer-events-none",
          )}
          aria-hidden={!isPiTab}
        >
          <PiPanel cwd={piCwd} workspace={piWorkspace} />
        </div>
      ) : null}
    </div>
  );
}
