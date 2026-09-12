import type { ComponentProps, ReactNode } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
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
  secondaryId: number | null;
  activeTab: Tab | undefined;
  registerEditorHandle: EditorStackProps["registerHandle"];
  onEditorDirtyChange: EditorStackProps["onDirtyChange"];
  onEditorCloseTab: EditorStackProps["onCloseTab"];
  onCloseSplit: () => void;
  registerPreviewHandle: PreviewStackProps["registerHandle"];
  onPreviewUrlChange: PreviewStackProps["onUrlChange"];
  onOpenCommitFile: GitHistoryStackProps["onOpenCommitFile"];
  onGitHistorySearchHandle: GitHistoryStackProps["onSearchHandle"];
  piCwd: string | null;
  piWorkspace: WorkspaceEnv;
};

/**
 * One tab-kind surface: absolutely stacked, toggled visible off the active tab
 * so panes keep their mounted state (editor scroll, ...) across switches. The
 * error boundary sits inside the visibility wrapper so a crashed (and hidden)
 * pane stays hidden instead of drawing its fallback over the active tab.
 */
function TabPane({
  visible,
  padded = true,
  label,
  resetKey,
  children,
}: {
  visible: boolean;
  padded?: boolean;
  label: string;
  resetKey: unknown;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "absolute inset-0",
        padded && "px-3 pt-2 pb-2",
        !visible && "invisible pointer-events-none",
      )}
      aria-hidden={!visible}
    >
      <ErrorBoundary label={label} resetKey={resetKey} inline>
        {children}
      </ErrorBoundary>
    </div>
  );
}

export function WorkspaceSurface({
  tabs,
  activeId,
  secondaryId,
  activeTab,
  registerEditorHandle,
  onEditorDirtyChange,
  onEditorCloseTab,
  onCloseSplit,
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
      <TabPane visible={isEditorTab} label="Editor" resetKey={activeId}>
        <EditorStack
          tabs={tabs}
          activeId={activeId}
          secondaryId={secondaryId}
          onCloseSplit={onCloseSplit}
          registerHandle={registerEditorHandle}
          onDirtyChange={onEditorDirtyChange}
          onCloseTab={onEditorCloseTab}
        />
      </TabPane>
      <TabPane visible={isPreviewTab} label="Preview" resetKey={activeId}>
        <PreviewStack
          tabs={tabs}
          activeId={activeId}
          registerHandle={registerPreviewHandle}
          onUrlChange={onPreviewUrlChange}
        />
      </TabPane>
      <TabPane visible={isMarkdownTab} label="Markdown" resetKey={activeId}>
        <MarkdownStack tabs={tabs} activeId={activeId} />
      </TabPane>
      <TabPane visible={isHtmlPreviewTab} label="HTML preview" resetKey={activeId}>
        <HtmlPreviewStack tabs={tabs} activeId={activeId} />
      </TabPane>
      <TabPane visible={isMediaTab} label="Media" resetKey={activeId}>
        <MediaPreviewStack tabs={tabs} activeId={activeId} />
      </TabPane>
      <TabPane visible={isGitDiffTab} label="Diff" resetKey={activeId}>
        <GitDiffStack tabs={tabs} activeId={activeId} />
      </TabPane>
      <TabPane
        visible={isGitHistoryTab}
        padded={false}
        label="Git history"
        resetKey={activeId}
      >
        <GitHistoryStack
          tabs={tabs}
          activeId={activeId}
          onOpenCommitFile={onOpenCommitFile}
          onSearchHandle={onGitHistorySearchHandle}
        />
      </TabPane>
      <TabPane
        visible={isHttpClientTab}
        padded={false}
        label="HTTP client"
        resetKey={activeId}
      >
        <HttpClientStack tabs={tabs} activeId={activeId} />
      </TabPane>
      {hasPiTab ? (
        <TabPane visible={isPiTab} padded={false} label="Pi" resetKey={activeId}>
          <PiPanel cwd={piCwd} workspace={piWorkspace} />
        </TabPane>
      ) : null}
    </div>
  );
}
