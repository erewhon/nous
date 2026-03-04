/**
 * Sidebar for multi-page guest editor.
 * Shows page list grouped by folder, highlights current page.
 */

interface ManifestPage {
  id: string;
  title: string;
  folderId?: string | null;
  folderName?: string | null;
  sectionId?: string | null;
}

interface GuestSidebarProps {
  pages: ManifestPage[];
  currentPageId: string | null;
  onSelectPage: (pageId: string) => void;
}

export function GuestSidebar({ pages, currentPageId, onSelectPage }: GuestSidebarProps) {
  // Group pages by folder
  const grouped = new Map<string, ManifestPage[]>();
  const rootPages: ManifestPage[] = [];

  for (const page of pages) {
    if (page.folderId) {
      const group = grouped.get(page.folderId) ?? [];
      group.push(page);
      grouped.set(page.folderId, group);
    } else {
      rootPages.push(page);
    }
  }

  return (
    <div style={{
      width: 240,
      minWidth: 240,
      borderRight: "1px solid #333",
      backgroundColor: "#141425",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "0.75rem 1rem",
        borderBottom: "1px solid #333",
        fontSize: "0.75rem",
        fontWeight: 600,
        color: "#e0e0e0",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}>
        Pages ({pages.length})
      </div>

      {/* Page list */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "0.5rem 0",
      }}>
        {/* Root pages */}
        {rootPages.map((page) => (
          <PageItem
            key={page.id}
            page={page}
            isActive={page.id === currentPageId}
            onClick={() => onSelectPage(page.id)}
          />
        ))}

        {/* Grouped pages */}
        {[...grouped.entries()].map(([folderId, folderPages]) => {
          // Get folder name from any page in the group
          const folderName = folderPages[0]?.folderName || "Folder";
          return (
          <div key={folderId}>
            <div style={{
              padding: "0.5rem 1rem 0.25rem",
              fontSize: "0.65rem",
              fontWeight: 600,
              color: "#666",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}>
              {folderName}
            </div>
            {folderPages.map((page) => (
              <PageItem
                key={page.id}
                page={page}
                isActive={page.id === currentPageId}
                onClick={() => onSelectPage(page.id)}
                indent
              />
            ))}
          </div>
          );
        })}
      </div>
    </div>
  );
}

function PageItem({
  page,
  isActive,
  onClick,
  indent = false,
}: {
  page: ManifestPage;
  isActive: boolean;
  onClick: () => void;
  indent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: `0.375rem ${indent ? "1.5rem" : "1rem"}`,
        fontSize: "0.8rem",
        color: isActive ? "#e0e0e0" : "#999",
        backgroundColor: isActive ? "rgba(59, 130, 246, 0.15)" : "transparent",
        border: "none",
        cursor: "pointer",
        borderLeft: isActive ? "2px solid #3b82f6" : "2px solid transparent",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          (e.target as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.05)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          (e.target as HTMLElement).style.backgroundColor = "transparent";
        }
      }}
    >
      {page.title || "Untitled"}
    </button>
  );
}
