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
    <div className="guest-sidebar">
      <div className="guest-sidebar-header">
        Pages ({pages.length})
      </div>

      <div className="guest-sidebar-list">
        {rootPages.map((page) => (
          <button
            key={page.id}
            className={`guest-sidebar-page ${page.id === currentPageId ? "active" : ""}`}
            onClick={() => onSelectPage(page.id)}
          >
            {page.title || "Untitled"}
          </button>
        ))}

        {[...grouped.entries()].map(([folderId, folderPages]) => {
          const folderName = folderPages[0]?.folderName || "Folder";
          return (
            <div key={folderId}>
              <div className="guest-sidebar-folder">{folderName}</div>
              {folderPages.map((page) => (
                <button
                  key={page.id}
                  className={`guest-sidebar-page indented ${page.id === currentPageId ? "active" : ""}`}
                  onClick={() => onSelectPage(page.id)}
                >
                  {page.title || "Untitled"}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
