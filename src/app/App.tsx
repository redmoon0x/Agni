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
import { AgentDock, AgentsSidebar } from "@/modules/agent-panel";
import { useAgentTabStatus } from "@/modules/agent-panel/lib/agentTabStatus";
import { forgetAgentTab } from "@/modules/agent-panel/lib/agentTabStatus";
import { planAgentSessionRestore } from "@/modules/agent-panel/lib/agentSessions";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import {
  acpSessionKey,
  disposeAcpSession,
} from "@/modules/acp-agent/session/registry";
import type { AcpAgentId } from "@/modules/acp-agent/lib/agent";
import { stopPi } from "@/modules/pi-agent/store";
import { PetOverlayBridge } from "@/modules/pi-agent/PetOverlayBridge";
import {
  registerTerminalDockOpener,
  RUN_IN_DOCK_EVENT,
  RUN_IN_DOCK_RESULT_EVENT,
  runInDockTerminalLocal,
} from "@/modules/terminal-dock/lib/dockBridge";
import { emit, listen } from "@tauri-apps/api/event";
import type { PreviewPaneHandle } from "@/modules/preview";
import { usePreviewAnnotateDraftStore } from "@/modules/preview-annotate";
import { SearchPanel } from "@/modules/search";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import {
  type AgentPanelMode,
  setAgentPanelAgent,
  setAgentPanelMode,
  setAgentSessions,
  setLastProjectRoot,
} from "@/modules/settings/store";
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
import { usePreferencesStore } from "@/modules/settings/preferences";
import { agentLabel } from "@/modules/agent-panel/lib/installedAgents";
import { defaultProfileFor } from "@/modules/agent-panel/lib/profile";
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
    newAgentTab,
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

  // Settings is a separate webview: it asks this window to host sign-in
  // terminals. The opener makes sure the dock is expanded before writing.
  useEffect(() => {
    registerTerminalDockOpener(openDock);
    return () => registerTerminalDockOpener(null);
  }, [openDock]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ requestId: string; command: string }>(
      RUN_IN_DOCK_EVENT,
      (event) => {
        void (async () => {
          let ok = false;
          try {
            ok = await runInDockTerminalLocal(event.payload.command);
          } catch {
            ok = false;
          }
          await emit(RUN_IN_DOCK_RESULT_EVENT, {
            requestId: event.payload.requestId,
            ok,
          });
        })();
      },
    ).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

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
    openRightPanel,
    closeRightPanel,
    focusRightPanel,
    restoreRightPanelWidth,
    handleRightPanelResize,
  } = useRightPanel();

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [newEditorOpen, setNewEditorOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [pendingDockPaneClose, setPendingDockPaneClose] = useState<
    number | null
  >(null);

  const activeTab = tabs.find((t) => t.id === activeId);
  const contentTabs = tabs.filter((tab) => tab.kind !== "agent");
  const activeContentId = contentTabs.some((tab) => tab.id === activeId)
    ? activeId
    : (contentTabs[0]?.id ?? 0);
  const activeContentTab = contentTabs.find((tab) => tab.id === activeContentId);
  const isEditorTab = activeContentTab?.kind === "editor";
  const isGitHistoryTab = activeContentTab?.kind === "git-history";
  // Agent sessions live in the right dock; the centre holds content only.
  const agentTabs = useMemo(
    () => tabs.filter((tab) => tab.kind === "agent"),
    [tabs],
  );
  const [activeAgentTabId, setActiveAgentTabId] = useState<number | null>(null);
  const [restoredTabIds, setRestoredTabIds] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const agentProfiles = usePreferencesStore((s) => s.agentProfiles);
  const agentProfileDefaults = usePreferencesStore(
    (s) => s.agentDefaultProfile,
  );
  const preferencesHydrated = usePreferencesStore((s) => s.hydrated);
  const agentPanelMode = usePreferencesStore((s) => s.agentPanelMode);
  const agentFocus = agentPanelMode === "focus";
  // Only take the workspace when there is actually a session to show.
  const agentSurface = agentFocus && agentTabs.length > 0;
  const agentAttention = useAgentTabStatus(
    (s) => Object.values(s.tabs).filter((entry) => entry.unread > 0).length,
  );

  useEditorFileSync({ tabs, tabsRef, editorRefs });
  useThemeFileEditing({ tabsRef, openFileTab });

  const { explorerRoot } = useWorkspaceCwd(dock.activeCwd, launchCwd ?? home);

  const handleNewAgentTab = useCallback(
    (spec: Parameters<typeof newAgentTab>[0]) => {
      // Pi is a single process; focus its existing tab instead of fighting it.
      if (spec.agent === "pi") {
        const existing = agentTabs.find((tab) => tab.agent === "pi");
        if (existing) {
          setActiveAgentTabId(existing.id);
          openRightPanel();
          return existing.id;
        }
      }
      const profile = spec.profileId
        ? (agentProfiles.find((entry) => entry.id === spec.profileId) ?? null)
        : defaultProfileFor(agentProfiles, spec.agent, agentProfileDefaults);
      const id = newAgentTab({
        ...spec,
        focus: false,
        profileId: profile?.id ?? null,
        title: agentLabel(spec.agent),
      });
      setActiveAgentTabId(id);
      void setAgentPanelAgent(spec.agent);
      openRightPanel();
      return id;
    },
    [
      agentProfileDefaults,
      agentProfiles,
      agentTabs,
      newAgentTab,
      openRightPanel,
    ],
  );

  const revealAgentsView = useCallback(() => {
    sidebarRef.current?.expand();
    persistSidebarView("agents");
  }, [persistSidebarView, sidebarRef]);

  /** Opening content needs the editor back: dock the agent to the right. */
  const revealWorkspace = useCallback(() => {
    if (!agentSurface) return;
    usePreferencesStore.setState({ agentPanelMode: "dock" });
    void setAgentPanelMode("dock");
    openRightPanel();
  }, [agentSurface, openRightPanel]);

  const toggleAgentLayout = useCallback(() => {
    const next: AgentPanelMode = agentFocus ? "dock" : "focus";
    usePreferencesStore.setState({ agentPanelMode: next });
    void setAgentPanelMode(next);
    if (next === "dock") openRightPanel();
  }, [agentFocus, openRightPanel]);

  const onNewAgent = useCallback(() => {
    // The Agents list is the switcher; reveal it when the user asks for agents.
    openRightPanel();
    revealAgentsView();
  }, [openRightPanel, revealAgentsView]);

  const openAgentFromSidebar = useCallback(
    (agent: string, profileId?: string | null) => {
      // Keep the side-panel agent visible; this opens alongside it as a tab.
      handleNewAgentTab({
        agent,
        cwd: explorerRoot,
        workspace: workspaceEnv,
        profileId,
      });
    },
    [explorerRoot, handleNewAgentTab, workspaceEnv],
  );

  const onToggleTerminal = useCallback(() => {
    // The terminal lives in the workspace; bring it back when it is hidden.
    if (agentSurface) {
      usePreferencesStore.setState({ agentPanelMode: "dock" });
      void setAgentPanelMode("dock");
      openRightPanel();
      if (!dockOpen) toggleDock();
      return;
    }
    toggleDock();
  }, [agentSurface, dockOpen, openRightPanel, toggleDock]);

  // Resize the same mounted panel instead of moving its session tree between
  // surfaces. Unmounting it stops Pi and releases ACP processes.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (agentSurface) {
        openRightPanel();
        focusRightPanel();
      } else if (rightPanelOpen) {
        restoreRightPanelWidth();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [agentSurface, focusRightPanel, openRightPanel, restoreRightPanelWidth, rightPanelOpen]);

  const activateAgentTab = useCallback(
    (id: number) => {
      setActiveAgentTabId(id);
      openRightPanel();
      // Keep the header's agent icon in step with the active session.
      const tab = agentTabs.find((entry) => entry.id === id);
      if (tab) void setAgentPanelAgent(tab.agent);
      // Opening the session acknowledges its bell entry and unread badge.
      useAgentTabStatus.getState().clearUnread(id);
      useAgentStore.getState().finish(-id);
    },
    [agentTabs, openRightPanel],
  );

  const stopAgentSession = useCallback(
    (tab: (typeof agentTabs)[number]) => {
      forgetAgentTab(tab.id);
      if (tab.agent === "pi") {
        void stopPi();
        return;
      }
      void disposeAcpSession(
        acpSessionKey({
          agent: tab.agent as AcpAgentId,
          cwd: tab.cwd ?? "",
          workspace: tab.workspace,
          profileId: tab.profileId,
        }),
      );
    },
    [],
  );

  useWindowTitle(activeContentTab, explorerRoot);

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

  const closeAgentTab = useCallback(
    (id: number) => {
      const tab = agentTabs.find((entry) => entry.id === id);
      const remaining = agentTabs.filter((entry) => entry.id !== id);
      if (tab) stopAgentSession(tab);
      if (tab && remaining.length === 0) closeRightPanel();
      disposeTab(id);
      setActiveAgentTabId((current) =>
        current === id
          ? (remaining[remaining.length - 1]?.id ?? null)
          : current,
      );
    },
    [agentTabs, closeRightPanel, disposeTab, stopAgentSession],
  );

  /** Switch accounts by replacing this session tab (blocked mid-turn). */
  const switchAgentProfile = useCallback(
    (tab: (typeof agentTabs)[number], profileId: string) => {
      if ((tab.profileId ?? null) === profileId) return;
      const status =
        useAgentTabStatus.getState().tabs[tab.id]?.status ?? "idle";
      if (status === "working" || status === "waiting") {
        toast(
          "Wait for the current turn or stop the agent before switching accounts.",
        );
        return;
      }
      const id = handleNewAgentTab({
        agent: tab.agent,
        cwd: tab.cwd,
        workspace: tab.workspace,
        profileId,
        initialModel: tab.initialModel ?? null,
      });
      if (id !== tab.id) closeAgentTab(tab.id);
    },
    [closeAgentTab, handleNewAgentTab],
  );

  // Keep the dock's active session valid as tabs open and close.
  useEffect(() => {
    if (agentTabs.length === 0) {
      if (activeAgentTabId !== null) setActiveAgentTabId(null);
      return;
    }
    if (!agentTabs.some((tab) => tab.id === activeAgentTabId)) {
      setActiveAgentTabId(agentTabs[agentTabs.length - 1].id);
    }
  }, [activeAgentTabId, agentTabs]);

  // Restore the agent sessions from the previous launch (once, after hydration).
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!preferencesHydrated || restoredRef.current) return;
    restoredRef.current = true;
    const saved = usePreferencesStore.getState().agentSessions;
    if (saved.sessions.length === 0) return;
    const profiles = usePreferencesStore.getState().agentProfiles;
    const { records, dropped } = planAgentSessionRestore(saved, profiles);
    if (records.length === 0) return;
    const ids: number[] = [];
    const restored = new Set<number>();
    for (const record of records) {
      const id = newAgentTab({
        agent: record.agent,
        cwd: record.cwd,
        workspace: record.workspace,
        profileId: record.profileId,
        initialModel: record.initialModel,
        focus: false,
        title: agentLabel(record.agent),
      });
      ids.push(id);
      restored.add(id);
    }
    setRestoredTabIds(restored);
    const activeIndex = records.findIndex(
      (record) => record.key === saved.activeKey,
    );
    setActiveAgentTabId(
      ids[activeIndex >= 0 ? activeIndex : ids.length - 1] ?? null,
    );
    const activeRecord =
      records[activeIndex >= 0 ? activeIndex : ids.length - 1];
    if (activeRecord) void setAgentPanelAgent(activeRecord.agent);
    openRightPanel();
    revealAgentsView();
    if (dropped > 0) {
      toast(
        `Restored ${records.length} agent session${
          records.length === 1 ? "" : "s"
        }; ${dropped} could not be restored.`,
      );
    }
  }, [
    newAgentTab,
    openRightPanel,
    revealAgentsView,
    preferencesHydrated,
  ]);

  // Persist open agent sessions so the panel comes back after a restart.
  useEffect(() => {
    if (!preferencesHydrated || !restoredRef.current) return;
    const timer = window.setTimeout(() => {
      void setAgentSessions({
        sessions: agentTabs.map((tab) => ({
          key: tab.key,
          agent: tab.agent,
          profileId: tab.profileId ?? null,
          cwd: tab.cwd,
          workspace: tab.workspace,
          initialModel: tab.initialModel ?? null,
        })),
        activeKey:
          agentTabs.find((tab) => tab.id === activeAgentTabId)?.key ?? null,
      }).catch(() => {});
    }, 300);
    return () => window.clearTimeout(timer);
  }, [preferencesHydrated, agentTabs, activeAgentTabId]);

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
      revealWorkspace();
      if (secondaryId !== null && id === secondaryId) {
        setActiveId(id);
        setSecondaryId(activeId);
        return;
      }
      setActiveId(id);
    },
    [revealWorkspace, secondaryId, activeId, setActiveId, setSecondaryId],
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
      revealWorkspace();
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
    [openFileTab, newImageTab, newPdfTab, revealWorkspace],
  );

  const handleOpenSearchResult = useCallback(
    (path: string, line: number) => {
      revealWorkspace();
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
    [openFileTab, revealWorkspace],
  );

  const handleAgentOpenFile = useCallback(
    (path: string, line?: number) => {
      if (line !== undefined) {
        handleOpenSearchResult(path, line);
        return;
      }
      handleOpenFile(path, true);
    },
    [handleOpenFile, handleOpenSearchResult],
  );

  const handleAgentOpenDiff = useCallback(
    (path: string) => {
      if (!explorerRoot) return;
      revealWorkspace();
      openGitDiffTab({ path, repoRoot: explorerRoot, mode: "-" });
    },
    [explorerRoot, openGitDiffTab, revealWorkspace],
  );

  const handleAgentFanout = useCallback(
    (spec: {
      agent: string;
      cwd: string | null;
      workspace: typeof workspaceEnv;
      models: { model: string; prompt: string }[];
    }) => {
      for (const entry of spec.models) {
        handleNewAgentTab({
          agent: spec.agent,
          cwd: spec.cwd,
          workspace: spec.workspace,
          initialModel: entry.model,
          initialPrompt: entry.prompt,
        });
      }
    },
    [handleNewAgentTab],
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
      revealWorkspace();
      const id = newPreviewTab(url);
      if (!url) {
        setTimeout(() => previewRefs.current.get(id)?.focusAddressBar(), 0);
      }
      return id;
    },
    [newPreviewTab, revealWorkspace],
  );

  const openHttpClient = useCallback(
    (url = "") => {
      revealWorkspace();
      return newHttpClientTab(url);
    },
    [newHttpClientTab, revealWorkspace],
  );

  const openMarkdownPreview = useCallback(
    (path: string) => {
      revealWorkspace();
      newMarkdownTab(path);
    },
    [newMarkdownTab, revealWorkspace],
  );

  const openHtmlPreview = useCallback(
    (path: string) => {
      revealWorkspace();
      newHtmlPreviewTab(path);
    },
    [newHtmlPreviewTab, revealWorkspace],
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
      // Agent notifications use a negative leaf id; terminal ones are positive.
      if (leafId < 0) {
        const tabId = -leafId;
        setActiveAgentTabId(tabId);
        openRightPanel();
        useAgentTabStatus.getState().clearUnread(tabId);
        useAgentStore.getState().finish(leafId);
        return;
      }
      openDock();
      dock.focusPane(leafId);
    },
    [openDock, dock, openRightPanel],
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
            openAgentPanel: onNewAgent,
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
      onNewAgent,
    ],
  );

  const renderAgentDock = () => (
    <ErrorBoundary label="Agent" inline>
      <AgentDock
        tabs={agentTabs}
        activeId={activeAgentTabId}
        visible={agentSurface || rightPanelOpen}
        workspace={workspaceEnv}
        resumeTabIds={restoredTabIds}
        layoutMode={agentSurface ? "focus" : "dock"}
        onToggleLayout={toggleAgentLayout}
        onOpenFile={handleAgentOpenFile}
        onOpenDiff={handleAgentOpenDiff}
        onSwitchProfile={switchAgentProfile}
        onFanout={handleAgentFanout}
        onOpenAgent={openAgentFromSidebar}
        onBrowseAgents={onNewAgent}
      />
    </ErrorBoundary>
  );

  const activeCwd = dock.activeCwd;

  return (
    <ThemeProvider>
      <TooltipProvider>
        <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
          {!zenMode && (
            <Header
              tabs={contentTabs}
              activeId={activeContentId}
              onSelect={handleSelectTab}
              onNewPreview={() => openPreviewTab("")}
              onNewEditor={() => setNewEditorOpen(true)}
              onNewGitGraph={openGitGraphFromContext}
              onNewHttpClient={() => openHttpClient()}
              onNewAgent={onNewAgent}
              onClose={handleClose}
              onPin={pinTab}
              onToggleSidebar={toggleSidebar}
              onToggleDock={onToggleTerminal}
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
                      {sidebarView === "agents" ? (
                        <AgentsSidebar
                          cwd={explorerRoot}
                          workspace={workspaceEnv}
                          agentTabs={agentTabs}
                          activeTabId={activeAgentTabId}
                          onActivateTab={activateAgentTab}
                          onCloseTab={closeAgentTab}
                          onOpenAgent={openAgentFromSidebar}
                        />
                      ) : sidebarView === "explorer" ? (
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
                          onOpenDiff={(input) => {
                            revealWorkspace();
                            openGitDiffTab(input);
                          }}
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
                    agentAttention={agentAttention}
                  />
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel id="workspace-area" defaultSize="78%" minSize="30%">
                <ResizablePanelGroup orientation="horizontal" className="h-full">
                  <ResizablePanel
                    id="workspace"
                    minSize={agentSurface ? "0%" : "30%"}
                    className={agentSurface ? "invisible pointer-events-none" : undefined}
                  >
                <ResizablePanelGroup orientation="vertical" className="h-full">
                  <ResizablePanel id="editor-area" minSize="20%">
                    <div className="relative h-full min-h-0">
                      <ErrorBoundary label="Editor" resetKey={activeId} inline>
                        <WorkspaceSurface
                          tabs={contentTabs}
                          activeId={activeContentId}
                          secondaryId={secondaryId}
                          activeTab={activeContentTab}
                          registerEditorHandle={registerEditorHandle}
                          onEditorDirtyChange={handleEditorDirty}
                          onEditorCloseTab={disposeTab}
                          onCloseSplit={closeSplit}
                          registerPreviewHandle={registerPreviewHandle}
                          onPreviewUrlChange={handlePreviewUrl}
                          onOpenCommitFile={openCommitFileDiffTab}
                          onGitHistorySearchHandle={setGitHistoryHandle}
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
                  {!agentSurface && rightPanelOpen ? (
                    <ResizableHandle withHandle />
                  ) : null}
                  <ResizablePanel
                    id="pi-panel"
                    panelRef={rightPanelRef}
                    defaultSize="0px"
                    minSize={agentSurface ? "0%" : `${RIGHT_PANEL_MIN_WIDTH}px`}
                    maxSize={agentSurface ? "100%" : `${RIGHT_PANEL_MAX_WIDTH}px`}
                    collapsible
                    collapsedSize={0}
                    onResize={(size) => {
                      if (!agentSurface) handleRightPanelResize(size.inPixels);
                    }}
                  >
                    <div className="h-full min-h-0 border-l border-border/60 bg-card">
                      {renderAgentDock()}
                    </div>
                  </ResizablePanel>
                </ResizablePanelGroup>
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
