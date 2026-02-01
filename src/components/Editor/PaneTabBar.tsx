import { useCallback, useState } from "react";
import { usePageStore, type PaneTab } from "../../stores/pageStore";

interface PaneTabBarProps {
  paneId: string;
  tabs: PaneTab[];
  activePageId: string | null;
}

export function PaneTabBar({ paneId, tabs, activePageId }: PaneTabBarProps) {
  const {
    selectTabInPane,
    closeTabInPane,
    closeOtherTabsInPane,
    closeAllTabsInPane,
    pinTabInPane,
    unpinTabInPane,
  } = usePageStore();

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
  } | null>(null);

  const handleTabClick = useCallback(
    (pageId: string) => {
      selectTabInPane(paneId, pageId);
    },
    [paneId, selectTabInPane]
  );

  const handleTabClose = useCallback(
    (e: React.MouseEvent, pageId: string) => {
      e.stopPropagation();
      closeTabInPane(paneId, pageId);
    },
    [paneId, closeTabInPane]
  );

  const handleMiddleClick = useCallback(
    (e: React.MouseEvent, pageId: string) => {
      if (e.button === 1) {
        e.preventDefault();
        closeTabInPane(paneId, pageId);
      }
    },
    [paneId, closeTabInPane]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, tabId });
    },
    []
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  if (tabs.length === 0) {
    return null;
  }

  return (
    <>
      <div
        className="flex items-center border-b"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        <div
          className="flex flex-1 items-center gap-0.5 overflow-x-auto px-2 py-1"
          style={{ scrollbarWidth: "thin" }}
        >
          {tabs.map((tab) => (
            <Tab
              key={tab.pageId}
              tab={tab}
              isActive={tab.pageId === activePageId}
              onClick={() => handleTabClick(tab.pageId)}
              onClose={(e) => handleTabClose(e, tab.pageId)}
              onMiddleClick={(e) => handleMiddleClick(e, tab.pageId)}
              onContextMenu={(e) => handleContextMenu(e, tab.pageId)}
            />
          ))}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <TabContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          tabId={contextMenu.tabId}
          isPinned={tabs.find((t) => t.pageId === contextMenu.tabId)?.isPinned || false}
          onClose={closeContextMenu}
          onCloseTab={() => {
            closeTabInPane(paneId, contextMenu.tabId);
            closeContextMenu();
          }}
          onCloseOthers={() => {
            closeOtherTabsInPane(paneId, contextMenu.tabId);
            closeContextMenu();
          }}
          onCloseAll={() => {
            closeAllTabsInPane(paneId);
            closeContextMenu();
          }}
          onPin={() => {
            pinTabInPane(paneId, contextMenu.tabId);
            closeContextMenu();
          }}
          onUnpin={() => {
            unpinTabInPane(paneId, contextMenu.tabId);
            closeContextMenu();
          }}
        />
      )}
    </>
  );
}

interface TabProps {
  tab: PaneTab;
  isActive: boolean;
  onClick: () => void;
  onClose: (e: React.MouseEvent) => void;
  onMiddleClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function Tab({
  tab,
  isActive,
  onClick,
  onClose,
  onMiddleClick,
  onContextMenu,
}: TabProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className="group flex items-center gap-1 rounded-t-md px-3 py-1.5 cursor-pointer transition-colors"
      style={{
        backgroundColor: isActive
          ? "var(--color-bg-primary)"
          : isHovered
            ? "var(--color-bg-tertiary)"
            : "transparent",
        borderBottom: isActive ? "2px solid var(--color-accent)" : "2px solid transparent",
        marginBottom: "-1px",
      }}
      onClick={onClick}
      onMouseDown={onMiddleClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Pin indicator */}
      {tab.isPinned && (
        <span
          className="flex h-3 w-3 items-center justify-center"
          style={{ color: "var(--color-accent)" }}
        >
          <IconPin />
        </span>
      )}

      {/* Tab title */}
      <span
        className="max-w-32 truncate text-sm"
        style={{
          color: isActive
            ? "var(--color-text-primary)"
            : "var(--color-text-secondary)",
        }}
        title={tab.title}
      >
        {tab.title || "Untitled"}
      </span>

      {/* Close button */}
      {!tab.isPinned && (
        <button
          onClick={onClose}
          className="ml-1 flex h-4 w-4 items-center justify-center rounded opacity-0 transition-opacity hover:bg-[--color-bg-tertiary] group-hover:opacity-100"
          style={{
            color: "var(--color-text-muted)",
            opacity: isHovered ? 1 : 0,
          }}
          title="Close tab"
        >
          <IconClose />
        </button>
      )}
    </div>
  );
}

interface TabContextMenuProps {
  x: number;
  y: number;
  tabId: string;
  isPinned: boolean;
  onClose: () => void;
  onCloseTab: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
  onPin: () => void;
  onUnpin: () => void;
}

function TabContextMenu({
  x,
  y,
  isPinned,
  onClose,
  onCloseTab,
  onCloseOthers,
  onCloseAll,
  onPin,
  onUnpin,
}: TabContextMenuProps) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50" onClick={onClose} />

      {/* Menu */}
      <div
        className="fixed z-50 min-w-40 rounded-lg border py-1 shadow-lg"
        style={{
          left: x,
          top: y,
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        {isPinned ? (
          <ContextMenuItem onClick={onUnpin}>
            <IconUnpin />
            Unpin tab
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onClick={onPin}>
            <IconPin />
            Pin tab
          </ContextMenuItem>
        )}

        <div
          className="my-1 h-px"
          style={{ backgroundColor: "var(--color-border)" }}
        />

        <ContextMenuItem onClick={onCloseTab}>
          <IconClose />
          Close
        </ContextMenuItem>
        <ContextMenuItem onClick={onCloseOthers}>
          <IconCloseOthers />
          Close others
        </ContextMenuItem>
        <ContextMenuItem onClick={onCloseAll}>
          <IconCloseAll />
          Close all
        </ContextMenuItem>
      </div>
    </>
  );
}

function ContextMenuItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-[--color-bg-tertiary]"
      style={{ color: "var(--color-text-secondary)" }}
    >
      {children}
    </button>
  );
}

// Icons
function IconClose() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconPin() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </svg>
  );
}

function IconUnpin() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="2" y1="2" x2="22" y2="22" />
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h12" />
      <path d="M15 9.34V6h1a2 2 0 0 0 0-4H7.89" />
    </svg>
  );
}

function IconCloseOthers() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="7" height="7" />
      <line x1="14" y1="6" x2="21" y2="6" />
      <line x1="6" y1="14" x2="6" y2="21" />
    </svg>
  );
}

function IconCloseAll() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}
