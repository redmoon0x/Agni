import type { SearchTarget } from "@/modules/header";
import type { ShortcutId } from "@/modules/shortcuts";
import { MAX_DOCK_PANES } from "@/modules/terminal-dock";
import type { Tab } from "@/modules/tabs";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  FileEditIcon,
  Folder01Icon,
  Globe02Icon,
  KeyboardIcon,
  LayoutTwoColumnIcon,
  LayoutTwoRowIcon,
  Search01Icon,
  Settings01Icon,
  SidebarLeftIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";

type CommandIcon = typeof TerminalIcon;

export type CommandPaletteActionGroup =
  | "General"
  | "Tabs"
  | "Panes"
  | "View"
  | "Search";

export type CommandPaletteAction = {
  id: string;
  label: string;
  group: CommandPaletteActionGroup;
  keywords: string[];
  icon: CommandIcon;
  shortcutId?: ShortcutId;
  disabledReason?: string;
  run: () => void;
  deferRun?: boolean;
};

export const COMMAND_PALETTE_ACTION_GROUPS: readonly CommandPaletteActionGroup[] =
  ["General", "Tabs", "Panes", "View", "Search"] as const;

export type CommandPaletteActionContext = {
  tabs: Tab[];
  activeId: number;
  searchTarget: SearchTarget;
  explorerRoot: string | null;
  home: string | null;
  dockOpen: boolean;
  dockPaneCount: number;
  openFolder: () => void;
  openNewEditor: () => void;
  openNewPreview: () => void;
  closeActiveTabOrPane: () => void;
  nextTab: () => void;
  previousTab: () => void;
  toggleDock: () => void;
  splitPaneRight: () => void;
  splitPaneDown: () => void;
  focusNextPane: () => void;
  focusPreviousPane: () => void;
  focusSearch: () => void;
  focusExplorerSearch: () => void;
  toggleSidebar: () => void;
  openSettings: () => void;
  openShortcuts: () => void;
};

export function createCommandPaletteActions(
  ctx: CommandPaletteActionContext,
): CommandPaletteAction[] {
  const onlyOneTab = ctx.tabs.length < 2;
  const noWorkspaceRoot = !ctx.explorerRoot && !ctx.home;
  const splitPaneDisabledReason =
    ctx.dockPaneCount >= MAX_DOCK_PANES ? "Pane limit" : undefined;
  const focusPaneDisabledReason =
    !ctx.dockOpen || ctx.dockPaneCount < 2 ? "Only one pane" : undefined;
  const closeDisabledReason = onlyOneTab ? "Last tab" : undefined;

  return [
    {
      id: "settings.open",
      label: "Open settings",
      group: "General",
      keywords: ["preferences", "config"],
      icon: Settings01Icon,
      shortcutId: "settings.open",
      run: ctx.openSettings,
      deferRun: true,
    },
    {
      id: "shortcuts.open",
      label: "Show keyboard shortcuts",
      group: "General",
      keywords: ["keys", "keybindings", "help"],
      icon: KeyboardIcon,
      shortcutId: "shortcuts.open",
      run: ctx.openShortcuts,
      deferRun: true,
    },
    {
      id: "workspace.openFolder",
      label: "Open folder",
      group: "General",
      keywords: ["open", "folder", "directory", "workspace", "browse"],
      icon: Folder01Icon,
      run: ctx.openFolder,
    },
    {
      id: "terminal.toggle",
      label: ctx.dockOpen ? "Hide terminal panel" : "Show terminal panel",
      group: "General",
      keywords: ["shell", "terminal", "panel", "dock"],
      icon: TerminalIcon,
      shortcutId: "terminal.toggle",
      run: ctx.toggleDock,
    },
    {
      id: "tab.newEditor",
      label: "New editor tab",
      group: "Tabs",
      keywords: ["file", "editor", "create"],
      icon: FileEditIcon,
      shortcutId: "tab.newEditor",
      disabledReason: noWorkspaceRoot ? "No workspace root" : undefined,
      run: ctx.openNewEditor,
      deferRun: true,
    },
    {
      id: "tab.newPreview",
      label: "New preview tab",
      group: "Tabs",
      keywords: ["browser", "web", "localhost"],
      icon: Globe02Icon,
      shortcutId: "tab.newPreview",
      run: ctx.openNewPreview,
    },
    {
      id: "tab.close",
      label: "Close tab or pane",
      group: "Tabs",
      keywords: ["close", "remove", "pane"],
      icon: Cancel01Icon,
      shortcutId: "tab.close",
      disabledReason: closeDisabledReason,
      run: ctx.closeActiveTabOrPane,
    },
    {
      id: "tab.next",
      label: "Next tab",
      group: "Tabs",
      keywords: ["switch", "right"],
      icon: ArrowRight01Icon,
      shortcutId: "tab.next",
      disabledReason: onlyOneTab ? "Only one tab" : undefined,
      run: ctx.nextTab,
    },
    {
      id: "tab.prev",
      label: "Previous tab",
      group: "Tabs",
      keywords: ["switch", "left"],
      icon: ArrowLeft01Icon,
      shortcutId: "tab.prev",
      disabledReason: onlyOneTab ? "Only one tab" : undefined,
      run: ctx.previousTab,
    },
    {
      id: "pane.splitRight",
      label: "Split terminal right",
      group: "Panes",
      keywords: ["terminal", "pane", "split", "right", "column"],
      icon: LayoutTwoColumnIcon,
      shortcutId: "pane.splitRight",
      disabledReason: splitPaneDisabledReason,
      run: ctx.splitPaneRight,
    },
    {
      id: "pane.splitDown",
      label: "Split terminal down",
      group: "Panes",
      keywords: ["terminal", "pane", "split", "down", "row"],
      icon: LayoutTwoRowIcon,
      shortcutId: "pane.splitDown",
      disabledReason: splitPaneDisabledReason,
      run: ctx.splitPaneDown,
    },
    {
      id: "pane.focusNext",
      label: "Focus next terminal pane",
      group: "Panes",
      keywords: ["terminal", "pane", "focus", "next"],
      icon: ArrowRight01Icon,
      shortcutId: "pane.focusNext",
      disabledReason: focusPaneDisabledReason,
      run: ctx.focusNextPane,
    },
    {
      id: "pane.focusPrev",
      label: "Focus previous terminal pane",
      group: "Panes",
      keywords: ["terminal", "pane", "focus", "previous"],
      icon: ArrowLeft01Icon,
      shortcutId: "pane.focusPrev",
      disabledReason: focusPaneDisabledReason,
      run: ctx.focusPreviousPane,
    },
    {
      id: "sidebar.toggle",
      label: "Toggle file explorer",
      group: "View",
      keywords: ["sidebar", "files", "explorer"],
      icon: SidebarLeftIcon,
      shortcutId: "sidebar.toggle",
      run: ctx.toggleSidebar,
    },
    {
      id: "explorer.search",
      label: "Search files",
      group: "Search",
      keywords: ["explorer", "workspace", "file search"],
      icon: Search01Icon,
      shortcutId: "explorer.search",
      disabledReason: ctx.explorerRoot ? undefined : "No workspace root",
      run: ctx.focusExplorerSearch,
      deferRun: true,
    },
    {
      id: "search.focus",
      label: "Focus search",
      group: "Search",
      keywords: ["find", "terminal", "editor"],
      icon: Search01Icon,
      shortcutId: "search.focus",
      disabledReason: ctx.searchTarget ? undefined : "No searchable view",
      run: ctx.focusSearch,
      deferRun: true,
    },
  ];
}
