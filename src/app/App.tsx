import type { SearchAddon } from "@xterm/addon-search";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getLaunchDir } from "@/lib/launchDir";
import { native } from "@/lib/native";
import { quoteShellArg } from "@/lib/shellQuote";
import { useZoom } from "@/lib/useZoom";
import { AgentNotificationsBridge } from "@/modules/agents";
import {
  CommandPalette,
  createCommandPaletteActions,
} from "@/modules/command-palette";
import {
  type EditorPaneHandle,
  NewEditorDialog,
  useEditorFileSync,
} from "@/modules/editor";
import { FileExplorer, type FileExplorerHandle } from "@/modules/explorer";
import type { GitHistorySearchHandle } from "@/modules/git-history";
import {
  Header,
  type SearchInlineHandle,
  type SearchTarget,
} from "@/modules/header";
import { PiPanel } from "@/modules/pi-agent";
import { PetOverlayBridge } from "@/modules/pi-agent/PetOverlayBridge";
import type { PreviewPaneHandle } from "@/modules/preview";
import { usePreviewAnnotateDraftStore } from "@/modules/preview-annotate";
import { SearchPanel } from "@/modules/search";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { setLastProjectRoot } from "@/modules/settings/store";
import {
  type ShortcutHandlers,
  type ShortcutId,
  ShortcutsDialog,
  useGlobalShortcuts,
} from "@/modules/shortcuts";
import {
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SidebarRail,
  useRightPanel,
  useSidebarPanel,
} from "@/modules/sidebar";
import {
  SourceControlPanel,
  useSourceControlContext,
} from "@/modules/source-control";
import { StatusBar } from "@/modules/statusbar";
import { useTabs, useWindowTitle, useWorkspaceCwd } from "@/modules/tabs";
import {
  clearFocusedTerminal,
  clearSession,
  disposeSession,
  leafHasForegroundProcess,
  leafIds,
  respawnSession,
  type TerminalPaneHandle,
  useTerminalFileDrop,
  writeToSession,
} from "@/modules/terminal";
import {
  MAX_DOCK_PANES,
  TerminalDockHeader,
  TerminalDockView,
  useTerminalDock,
  useTerminalDockPanel,
} from "@/modules/terminal-dock";
import { ThemeProvider, useThemeFileEditing } from "@/modules/theme";
import { UpdaterDialog } from "@/modules/updater";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import { CloseDialogs } from "./components/CloseDialogs";
import { WorkspaceSurface } from "./components/WorkspaceSurface";
import { useTabCloseGuards } from "./hooks/useTabCloseGuards";
import { useWorkspaceSwitcher } from "./hooks/useWorkspaceSwitcher";

export default function App() {
  const {
    tabs,
    activeId,
    setActiveId,
    secondaryId,
    setSecondaryId,
    openFileTab,
    pinTab,
    newPreviewTab,
    newHttpClientTab,
    newMarkdownTab,
    newHtmlPreviewTab,
    newImageTab,
    newPdfTab,
    openGitDiffTab,
    openCommitHistoryTab,
    openCommitFileDiffTab,
    newPiTab,
    closeTab,
    updateTab,
    selectByIndex,
    toggleSplitEditor,
    closeSplit,
    resetWorkspace,
  } = useTabs();

  const dock = useTerminalDock(getLaunchDir() ?? undefined);
  const { dockRef, dockOpen, toggleDock, openDock, handleDockResize } =
    useTerminalDockPanel(true);

  // Mirror `tabs` into a ref so callbacks scheduled with `setTimeout`
  // (e.g. cdInNewTab) read the latest pane state instead of a stale closure.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const searchAddons = useRef<Map<number, SearchAddon>>(new Map());
  const [activeSearchAddon, setActiveSearchAddon] =
    useState<SearchAddon | null>(null);
  const searchInlineRef = useRef<SearchInlineHandle | null>(null);
  const terminalRefs = useRef<Map<number, TerminalPaneHandle>>(new Map());
  const editorRefs = useRef<Map<number, EditorPaneHandle>>(new Map());
  const previewRefs = useRef<Map<number, PreviewPaneHandle>>(new Map());
  const [activeEditorHandle, setActiveEditorHandle] =
    useState<EditorPaneHandle | null>(null);
  const [gitHistoryHandle, setGitHistoryHandle] =
    useState<GitHistorySearchHandle | null>(null);
  const { zoomIn, zoomOut, zoomReset } = useZoom();
  useTerminalFileDrop();
  const explorerRef = useRef<FileExplorerHandle>(null);

  // Drives session disposal off the dock's pane tree, not React lifecycles --
  // split/unsplit re-mount components but the leaf is still live.
  const liveLeavesRef = useRef<Set<number>>(new Set());

  const clearWorkspaceState = useCallback(() => {
    for (const id of liveLeavesRef.current) disposeSession(id);
    searchAddons.current.clear();
    terminalRefs.current.clear();
    editorRefs.current.clear();
    previewRefs.current.clear();
    setActiveSearchAddon(null);
    setActiveEditorHandle(null);
  }, []);

  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const setWorkspaceEnv = useWorkspaceEnvStore((s) => s.setEnv);
  const { home, launchCwd, launchCwdResolved, switchWorkspace } =
    useWorkspaceSwitcher({
      tabsRef,
      workspaceEnv,
      setWorkspaceEnv,
      resetWorkspace,
      resetDock: dock.resetDock,
      clearWorkspaceState,
    });

  const {
    sidebarRef,
    sidebarWidthRef,
    sidebarView,
    persistSidebarView,
    toggleSidebar,
    cycleSidebarView,
    persistSidebarWidth,
    toggleExplorerFocus,
  } = useSidebarPanel(explorerRef);
  const {
    rightPanelRef,
    rightPanelOpen,
    toggleRightPanel,
    openRightPanel,
    closeRightPanel,
    handleRightPanelResize,
  } = useRightPanel();

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [newEditorOpen, setNewEditorOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [pendingDockPaneClose, setPendingDockPaneClose] = useState<
    number | null
  >(null);

  const activeTab = tabs.find((t) => t.id === activeId);
  const isEditorTab = activeTab?.kind === "editor";
  const isGitHistoryTab = activeTab?.kind === "git-history";
  // Pi has a single global session -- only ever one live surface for it, so
  // opening it as a full tab suppresses (and reclaims focus from) the side panel.
  const piTab = tabs.find((t) => t.kind === "pi");

  const onNewPi = useCallback(() => {
    closeRightPanel();
    newPiTab();
  }, [closeRightPanel, newPiTab]);

  const onTogglePiPanel = useCallback(() => {
    if (piTab) {
      setActiveId(piTab.id);
      return;
    }
    toggleRightPanel();
  }, [piTab, setActiveId, toggleRightPanel]);

  useEditorFileSync({ tabs, tabsRef, editorRefs });
  useThemeFileEditing({ tabsRef, openFileTab });

  const { explorerRoot } = useWorkspaceCwd(dock.activeCwd, launchCwd ?? home);

  useWindowTitle(activeTab, explorerRoot);

  // Remember the last project root so relaunching without an explicit CLI
  // dir (Start Menu, Dock, taskbar) resumes here instead of at home.
  useEffect(() => {
    if (explorerRoot && explorerRoot !== home) void setLastProjectRoot(explorerRoot);
  }, [explorerRoot, home]);

  useEffect(() => {
    setActiveSearchAddon(searchAddons.current.get(dock.activeLeafId) ?? null);
    setActiveEditorHandle(editorRefs.current.get(activeId) ?? null);
  }, [activeId, dock.activeLeafId]);

  // An annotation draft from a web preview should surface in the Pi chat
  // composer: open the right panel when one is staged.
  useEffect(
    () =>
      usePreviewAnnotateDraftStore.subscribe((state) => {
        if (state.pending) openRightPanel();
      }),
    [openRightPanel],
  );

  const handleSearchReady = useCallback(
    (leafId: number, addon: SearchAddon) => {
      searchAddons.current.set(leafId, addon);
      if (leafId === dock.activeLeafId) setActiveSearchAddon(addon);
    },
    [dock.activeLeafId],
  );

  const disposeTab = useCallback(
    (id: number) => {
      editorRefs.current.delete(id);
      previewRefs.current.delete(id);
      closeTab(id);
    },
    [closeTab],
  );

  const {
    pendingCloseTab,
    pendingDeleteTabs,
    handleClose,
    confirmClose,
    cancelClose,
    confirmDeleteClose,
    cancelDeleteClose,
    handlePathDeleted,
  } = useTabCloseGuards({ tabs, disposeTab });

  const closeDockPaneGuarded = useCallback(
    async (leafId: number) => {
      const running = await leafHasForegroundProcess(leafId);
      if (running) {
        setPendingDockPaneClose(leafId);
        return;
      }
      dock.closePane(leafId);
    },
    [dock],
  );

  const confirmDockPaneClose = useCallback(() => {
    if (pendingDockPaneClose !== null) dock.closePane(pendingDockPaneClose);
    setPendingDockPaneClose(null);
  }, [pendingDockPaneClose, dock]);

  const cancelDockPaneClose = useCallback(() => {
    setPendingDockPaneClose(null);
  }, []);

  useEffect(() => {
    const live = new Set(leafIds(dock.tree));
    for (const id of liveLeavesRef.current) {
      if (!live.has(id)) disposeSession(id);
    }
    liveLeavesRef.current = live;
    for (const k of [...terminalRefs.current.keys()])
      if (!live.has(k)) terminalRefs.current.delete(k);
    for (const k of [...searchAddons.current.keys()])
      if (!live.has(k)) searchAddons.current.delete(k);
  }, [dock.tree]);

  const cycleTab = useCallback(
    (delta: 1 | -1) => {
      if (tabs.length < 2) return;
      const idx = tabs.findIndex((t) => t.id === activeId);
      const nextIdx = (idx + delta + tabs.length) % tabs.length;
      setActiveId(tabs[nextIdx].id);
    },
    [tabs, activeId, setActiveId],
  );

  // Selecting the tab shown in the secondary pane swaps the two panes so the
  // clicked tab becomes primary. Any other tab just moves the primary slot.
  const handleSelectTab = useCallback(
    (id: number) => {
      if (secondaryId !== null && id === secondaryId) {
        setActiveId(id);
        setSecondaryId(activeId);
        return;
      }
      setActiveId(id);
    },
    [secondaryId, activeId, setActiveId, setSecondaryId],
  );

  const sendCd = useCallback(
    (path: string) => {
      openDock();
      writeToSession(dock.activeLeafId, `cd ${quoteShellArg(path)}\r`);
      terminalRefs.current.get(dock.activeLeafId)?.focus();
    },
    [dock.activeLeafId, openDock],
  );

  const cdInNewTab = useCallback(
    (path: string) => {
      openDock();
      const leafId =
        dock.paneCount < MAX_DOCK_PANES
          ? dock.splitActive("row")
          : dock.activeLeafId;
      if (leafId === null) return;
      setTimeout(() => {
        writeToSession(leafId, `cd ${quoteShellArg(path)}\r`);
        terminalRefs.current.get(leafId)?.focus();
      }, 80);
    },
    [dock, openDock],
  );

  const handleOpenFile = useCallback(
    (path: string, pin?: boolean) => {
      if (/\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i.test(path)) {
        newImageTab(path);
        return;
      }
      if (/\.pdf$/i.test(path)) {
        newPdfTab(path);
        return;
      }
      openFileTab(path, pin ?? false);
    },
    [openFileTab, newImageTab, newPdfTab],
  );

  const handleOpenSearchResult = useCallback(
    (path: string, line: number) => {
      const id = openFileTab(path, true);
      if (id == null) return;
      // ponytail: file content loads async (fs_read_file invoke), so the
      // CodeMirror view may not be mounted yet. Poll briefly until gotoLine
      // reports success; upgrade to an onReady callback if this proves flaky.
      let attempts = 0;
      const tryGoto = () => {
        const ok = editorRefs.current.get(id)?.gotoLine(line) ?? false;
        if (ok) return;
        attempts += 1;
        if (attempts < 15) setTimeout(tryGoto, 100);
      };
      tryGoto();
    },
    [openFileTab],
  );

  const handlePathRenamed = useCallback(
    (from: string, to: string) => {
      for (const t of tabs) {
        if (
          t.kind !== "editor" &&
          t.kind !== "markdown" &&
          t.kind !== "html" &&
          t.kind !== "image" &&
          t.kind !== "pdf"
        ) {
          continue;
        }
        if (t.path === from) {
          const i = to.lastIndexOf("/");
          updateTab(t.id, { path: to, title: i === -1 ? to : to.slice(i + 1) });
        } else if (t.path.startsWith(`${from}/`)) {
          const suffix = t.path.slice(from.length);
          const newPath = `${to}${suffix}`;
          const i = newPath.lastIndexOf("/");
          updateTab(t.id, {
            path: newPath,
            title: i === -1 ? newPath : newPath.slice(i + 1),
          });
        }
      }
    },
    [tabs, updateTab],
  );

  const activeFilePath = (() => {
    if (activeTab?.kind === "editor") return activeTab.path;
    if (
      activeTab?.kind === "markdown" ||
      activeTab?.kind === "html" ||
      activeTab?.kind === "image" ||
      activeTab?.kind === "pdf"
    ) {
      return activeTab.path;
    }
    if (activeTab?.kind === "git-diff") {
      if (/^([A-Za-z]:|\/|\\)/.test(activeTab.path)) return activeTab.path;
      const root = activeTab.repoRoot.replace(/[\\/]+$/, "");
      const rel = activeTab.path.replace(/^[\\/]+/, "");
      return `${root}/${rel}`;
    }
    if (activeTab?.kind === "git-commit-file") {
      const root = activeTab.repoRoot.replace(/[\\/]+$/, "");
      const rel = activeTab.path.replace(/^[\\/]+/, "");
      return `${root}/${rel}`;
    }
    return null;
  })();
  const explorerActiveFilePath =
    activeTab?.kind === "editor" ||
    activeTab?.kind === "markdown" ||
    activeTab?.kind === "html" ||
    activeTab?.kind === "image" ||
    activeTab?.kind === "pdf"
      ? activeTab.path
      : null;
  const { sourceControl, toggleSourceControl, openGitGraphFromContext } =
    useSourceControlContext({
      activeTab,
      tabs,
      explorerRoot,
      launchCwd,
      launchCwdResolved,
      home,
      sidebarView,
      cycleSidebarView,
      openCommitHistoryTab,
    });

  const openPreviewTab = useCallback(
    (url: string) => {
      const id = newPreviewTab(url);
      if (!url) {
        setTimeout(() => previewRefs.current.get(id)?.focusAddressBar(), 0);
      }
      return id;
    },
    [newPreviewTab],
  );

  const openHttpClient = useCallback(
    (url = "") => newHttpClientTab(url),
    [newHttpClientTab],
  );

  const openMarkdownPreview = useCallback(
    (path: string) => {
      newMarkdownTab(path);
    },
    [newMarkdownTab],
  );

  const openHtmlPreview = useCallback(
    (path: string) => {
      newHtmlPreviewTab(path);
    },
    [newHtmlPreviewTab],
  );

  const splitDock = useCallback(
    (dir: "row" | "col") => {
      if (!dockOpen) {
        openDock();
        return;
      }
      dock.splitActive(dir);
    },
    [dockOpen, openDock, dock],
  );

  const handleCloseTabOrPane = useCallback(() => {
    const el = document.activeElement as HTMLElement | null;
    const inDock = !!el?.closest?.("[data-terminal-dock]");
    if (inDock) {
      if (dock.paneCount > 1) {
        void closeDockPaneGuarded(dock.activeLeafId);
      } else {
        toggleDock();
      }
      return;
    }
    handleClose(activeId);
  }, [activeId, dock, toggleDock, closeDockPaneGuarded, handleClose]);

  const [zenMode, setZenMode] = useState(false);

  const shortcutHandlers = useMemo<ShortcutHandlers>(
    () => ({
      "commandPalette.open": () => setCommandPaletteOpen(true),
      "tab.newPreview": () => openPreviewTab(""),
      "tab.newHttpClient": () => openHttpClient(),
      "tab.newEditor": () => setNewEditorOpen(true),
      "tab.close": handleCloseTabOrPane,
      "tab.next": () => cycleTab(1),
      "tab.prev": () => cycleTab(-1),
      "tab.selectByIndex": (e) => selectByIndex(parseInt(e.key, 10) - 1),
      "pane.splitRight": () => splitDock("row"),
      "pane.splitDown": () => splitDock("col"),
      "pane.focusNext": () => dock.focusNext(1),
      "pane.focusPrev": () => dock.focusNext(-1),
      "pane.source": toggleSourceControl,
      "terminal.clear": () => {
        clearFocusedTerminal();
      },
      "terminal.toggle": toggleDock,
      "search.focus": () => searchInlineRef.current?.focus(),
      "shortcuts.open": () => setShortcutsOpen((v) => !v),
      "settings.open": () => void openSettingsWindow(),
      "sidebar.toggle": toggleSidebar,
      "explorer.focus": toggleExplorerFocus,
      "view.zoomIn": zoomIn,
      "view.zoomOut": zoomOut,
      "view.zoomReset": zoomReset,
      "view.zenMode": () => setZenMode((v) => !v),
      "editor.undo": () => editorRefs.current.get(activeId)?.undo(),
      "editor.redo": () => editorRefs.current.get(activeId)?.redo(),
      "editor.split": () => {
        if (!toggleSplitEditor()) {
          toast("Open a second file to split the editor");
        }
      },
    }),
    [
      activeId,
      cycleTab,
      handleCloseTabOrPane,
      openPreviewTab,
      openHttpClient,
      selectByIndex,
      splitDock,
      dock,
      toggleSourceControl,
      toggleDock,
      toggleSidebar,
      toggleExplorerFocus,
      toggleSplitEditor,
      zoomIn,
      zoomOut,
      zoomReset,
    ],
  );

  const shortcutsDisabled = useCallback(
    (id: ShortcutId, e: KeyboardEvent) => {
      if (id === "editor.undo" || id === "editor.redo") {
        return activeTab?.kind !== "editor";
      }
      if (id === "editor.split") {
        const editors = tabs.filter((t) => t.kind === "editor").length;
        return secondaryId === null && editors < 2;
      }
      if (id === "terminal.clear") {
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        return !(target as HTMLElement | null)?.closest?.(".xterm");
      }
      if (id === "sidebar.toggle") {
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        const inTerminal = !!(target as HTMLElement | null)?.closest?.(
          ".xterm",
        );
        return inTerminal && !e.shiftKey;
      }
      return false;
    },
    [activeTab, tabs, secondaryId],
  );

  useGlobalShortcuts(shortcutHandlers, { isDisabled: shortcutsDisabled });

  const registerTerminalHandle = useCallback(
    (leafId: number, h: TerminalPaneHandle | null) => {
      if (h) terminalRefs.current.set(leafId, h);
      else terminalRefs.current.delete(leafId);
    },
    [],
  );

  const registerEditorHandle = useCallback(
    (id: number, h: EditorPaneHandle | null) => {
      if (h) editorRefs.current.set(id, h);
      else editorRefs.current.delete(id);
      if (id === activeId) setActiveEditorHandle(h);
    },
    [activeId],
  );

  const registerPreviewHandle = useCallback(
    (id: number, h: PreviewPaneHandle | null) => {
      if (h) previewRefs.current.set(id, h);
      else previewRefs.current.delete(id);
    },
    [],
  );

  const handlePreviewUrl = useCallback(
    (id: number, url: string) => updateTab(id, { url }),
    [updateTab],
  );

  const handleDockCwd = useCallback(
    (leafId: number, cwd: string) => {
      dock.setLeafCwd(leafId, cwd);
    },
    [dock],
  );

  const handleDockFocusLeaf = useCallback(
    (leafId: number) => dock.focusPane(leafId),
    [dock],
  );

  const openFolder = useCallback(async () => {
    const picked = await native.pickFolder(
      "Open Folder",
      explorerRoot ?? home ?? undefined,
    );
    if (!picked) return;
    try {
      await native.workspaceAuthorize(picked);
    } catch {
      /* non-fatal */
    }
    resetWorkspace();
    dock.resetDock(picked);
  }, [explorerRoot, home, resetWorkspace, dock]);

  const onActivateAgent = useCallback(
    (leafId: number) => {
      openDock();
      dock.focusPane(leafId);
    },
    [openDock, dock],
  );

  const handleDockLeafExit = useCallback(
    (leafId: number, _code: number) => {
      if (leafIds(dock.tree).length === 1) {
        void respawnSession(leafId, dock.activeCwd ?? undefined);
      } else {
        dock.closePane(leafId);
      }
    },
    [dock],
  );

  const handleEditorDirty = useCallback(
    (id: number, dirty: boolean) => updateTab(id, { dirty }),
    [updateTab],
  );

  const searchTarget = useMemo<SearchTarget>(() => {
    if (isEditorTab && activeEditorHandle)
      return {
        kind: "editor",
        handle: activeEditorHandle,
        focus: () => activeEditorHandle.focus(),
      };
    if (isGitHistoryTab && gitHistoryHandle)
      return {
        kind: "git-history",
        handle: gitHistoryHandle,
        focus: () => {},
      };
    if (dockOpen && activeSearchAddon)
      return {
        kind: "terminal",
        addon: activeSearchAddon,
        focus: () => terminalRefs.current.get(dock.activeLeafId)?.focus(),
      };
    return null;
  }, [
    isEditorTab,
    isGitHistoryTab,
    dockOpen,
    activeSearchAddon,
    activeEditorHandle,
    gitHistoryHandle,
    dock.activeLeafId,
  ]);

  const commandPaletteActions = useMemo(
    () =>
      commandPaletteOpen
        ? createCommandPaletteActions({
            tabs,
            activeId,
            searchTarget,
            explorerRoot,
            home,
            dockOpen,
            dockPaneCount: dock.paneCount,
            openFolder,
            openNewEditor: () => setNewEditorOpen(true),
            openNewPreview: () => openPreviewTab(""),
            closeActiveTabOrPane: handleCloseTabOrPane,
            nextTab: () => cycleTab(1),
            previousTab: () => cycleTab(-1),
            toggleDock,
            splitPaneRight: () => splitDock("row"),
            splitPaneDown: () => splitDock("col"),
            focusNextPane: () => dock.focusNext(1),
            focusPreviousPane: () => dock.focusNext(-1),
            editorSplitActive: secondaryId !== null,
            toggleEditorSplit: () => void toggleSplitEditor(),
            focusSearch: () => searchInlineRef.current?.focus(),
            focusExplorerSearch: () => explorerRef.current?.focusSearch(),
            toggleSidebar,
            openSettings: () => void openSettingsWindow(),
            openShortcuts: () => setShortcutsOpen(true),
          })
        : [],
    [
      commandPaletteOpen,
      tabs,
      activeId,
      secondaryId,
      toggleSplitEditor,
      searchTarget,
      explorerRoot,
      home,
      dockOpen,
      dock,
      openFolder,
      openPreviewTab,
      handleCloseTabOrPane,
      cycleTab,
      toggleDock,
      splitDock,
      toggleSidebar,
    ],
  );

  const activeCwd = dock.activeCwd;

  return (
    <ThemeProvider>
      <TooltipProvider>
        <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
          {!zenMode && (
            <Header
              tabs={tabs}
              activeId={activeId}
              onSelect={handleSelectTab}
              onNewPreview={() => openPreviewTab("")}
              onNewEditor={() => setNewEditorOpen(true)}
              onNewGitGraph={openGitGraphFromContext}
              onNewHttpClient={() => openHttpClient()}
              onNewPi={onNewPi}
              onClose={handleClose}
              onPin={pinTab}
              onToggleSidebar={toggleSidebar}
              onTogglePiPanel={onTogglePiPanel}
              piPanelOpen={rightPanelOpen || activeTab?.kind === "pi"}
              onToggleDock={toggleDock}
              dockOpen={dockOpen}
              onSplitDock={splitDock}
              canSplitDock={dock.paneCount < MAX_DOCK_PANES}
              onActivateAgent={onActivateAgent}
              onOpenFolder={openFolder}
              onOpenSettings={() => void openSettingsWindow()}
              searchTarget={searchTarget}
              searchRef={searchInlineRef}
            />
          )}

          <main className="zoom-content flex min-h-0 flex-1 flex-col">
            <ResizablePanelGroup
              orientation="horizontal"
              className="min-h-0 flex-1"
            >
              <ResizablePanel
                id="sidebar"
                panelRef={sidebarRef}
                defaultSize={`${sidebarWidthRef.current}px`}
                minSize={`${SIDEBAR_MIN_WIDTH}px`}
                maxSize={`${SIDEBAR_MAX_WIDTH}px`}
                collapsible
                collapsedSize={0}
                onResize={(size) => {
                  if (size.inPixels > 0) persistSidebarWidth(size.inPixels);
                }}
              >
                <div className="flex h-full min-h-0 flex-col border-r border-border/60 bg-card">
                  <div className="min-h-0 flex-1">
                    <ErrorBoundary
                      label="Sidebar"
                      resetKey={sidebarView}
                      inline
                    >
                      {sidebarView === "explorer" ? (
                        <FileExplorer
                          ref={explorerRef}
                          rootPath={explorerRoot}
                          activeFilePath={explorerActiveFilePath}
                          onOpenFile={handleOpenFile}
                          onPathRenamed={handlePathRenamed}
                          onPathDeleted={handlePathDeleted}
                          onRevealInTerminal={cdInNewTab}
                          onOpenMarkdownPreview={openMarkdownPreview}
                          onOpenHtmlPreview={openHtmlPreview}
                        />
                      ) : sidebarView === "search" ? (
                        <SearchPanel
                          rootPath={explorerRoot}
                          onOpenResult={handleOpenSearchResult}
                        />
                      ) : (
                        <SourceControlPanel
                          open
                          sourceControl={sourceControl}
                          onOpenDiff={openGitDiffTab}
                          onOpenGitGraph={openGitGraphFromContext}
                          onOpenFile={handleOpenFile}
                        />
                      )}
                    </ErrorBoundary>
                  </div>
                  <SidebarRail
                    activeView={sidebarView}
                    onSelectView={persistSidebarView}
                    changedCount={sourceControl.changedCount}
                  />
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel id="workspace" defaultSize="78%" minSize="30%">
                <ResizablePanelGroup orientation="vertical" className="h-full">
                  <ResizablePanel id="editor-area" minSize="20%">
                    <div className="relative h-full min-h-0">
                      <ErrorBoundary label="Editor" resetKey={activeId} inline>
                        <WorkspaceSurface
                          tabs={tabs}
                          activeId={activeId}
                          secondaryId={secondaryId}
                          activeTab={activeTab}
                          registerEditorHandle={registerEditorHandle}
                          onEditorDirtyChange={handleEditorDirty}
                          onEditorCloseTab={disposeTab}
                          onCloseSplit={closeSplit}
                          registerPreviewHandle={registerPreviewHandle}
                          onPreviewUrlChange={handlePreviewUrl}
                          onOpenCommitFile={openCommitFileDiffTab}
                          onGitHistorySearchHandle={setGitHistoryHandle}
                          piCwd={explorerRoot}
                          piWorkspace={workspaceEnv}
                        />
                      </ErrorBoundary>
                    </div>
                  </ResizablePanel>
                  {dockOpen ? <ResizableHandle withHandle /> : null}
                  <ResizablePanel
                    id="terminal-dock"
                    panelRef={dockRef}
                    defaultSize="260px"
                    minSize="120px"
                    maxSize="720px"
                    collapsible
                    collapsedSize={0}
                    onResize={(size) => handleDockResize(size.inPixels)}
                  >
                    <div className="flex h-full min-h-0 flex-col border-t border-border/60 bg-card">
                      <ErrorBoundary label="Terminal" inline>
                        {dockOpen ? (
                          <>
                            <TerminalDockHeader
                              cwd={dock.activeCwd}
                              canSplit={dock.paneCount < MAX_DOCK_PANES}
                              onSplit={dock.splitActive}
                              onClear={() => clearSession(dock.activeLeafId)}
                              onHide={toggleDock}
                            />
                            <div className="min-h-0 flex-1 px-3 pt-2 pb-2">
                              <TerminalDockView
                                tree={dock.tree}
                                activeLeafId={dock.activeLeafId}
                                paneCount={dock.paneCount}
                                registerHandle={registerTerminalHandle}
                                onSearchReady={handleSearchReady}
                                onCwd={handleDockCwd}
                                onExit={handleDockLeafExit}
                                onFocusLeaf={handleDockFocusLeaf}
                                onClosePane={(leafId) =>
                                  void closeDockPaneGuarded(leafId)
                                }
                              />
                            </div>
                          </>
                        ) : null}
                      </ErrorBoundary>
                    </div>
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ResizablePanel>
              {rightPanelOpen ? <ResizableHandle withHandle /> : null}
              <ResizablePanel
                id="pi-panel"
                panelRef={rightPanelRef}
                defaultSize="0px"
                minSize={`${RIGHT_PANEL_MIN_WIDTH}px`}
                maxSize={`${RIGHT_PANEL_MAX_WIDTH}px`}
                collapsible
                collapsedSize={0}
                onResize={(size) => handleRightPanelResize(size.inPixels)}
              >
                <div className="h-full min-h-0 border-l border-border/60 bg-card">
                  {rightPanelOpen && !piTab ? (
                    <ErrorBoundary label="Pi" inline>
                      <PiPanel cwd={explorerRoot} workspace={workspaceEnv} />
                    </ErrorBoundary>
                  ) : null}
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </main>

          {!zenMode && (
            <StatusBar
              cwd={activeCwd}
              filePath={activeFilePath}
              home={home}
              onCd={sendCd}
              onWorkspaceChange={switchWorkspace}
            />
          )}

          <AgentNotificationsBridge
            dockTree={dock.tree}
            dockOpen={dockOpen}
            dockActiveLeafId={dock.activeLeafId}
            onActivate={onActivateAgent}
          />
          <PetOverlayBridge />
          <Toaster position="bottom-right" />

          <CommandPalette
            open={commandPaletteOpen}
            onOpenChange={setCommandPaletteOpen}
            actions={commandPaletteActions}
            workspaceRoot={explorerRoot}
            onOpenFile={handleOpenFile}
          />

          <ShortcutsDialog
            open={shortcutsOpen}
            onOpenChange={setShortcutsOpen}
          />

          <NewEditorDialog
            open={newEditorOpen}
            onOpenChange={setNewEditorOpen}
            rootPath={explorerRoot ?? home}
            onCreated={(path) => openFileTab(path)}
          />

          <UpdaterDialog />

          <CloseDialogs
            tabs={tabs}
            pendingCloseTab={pendingCloseTab}
            onCancelClose={cancelClose}
            onConfirmClose={confirmClose}
            pendingDockPaneClose={pendingDockPaneClose}
            onCancelDockPaneClose={cancelDockPaneClose}
            onConfirmDockPaneClose={confirmDockPaneClose}
            pendingDeleteTabs={pendingDeleteTabs}
            onCancelDeleteClose={cancelDeleteClose}
            onConfirmDeleteClose={confirmDeleteClose}
          />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );
}
