import { useState, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  NotebookMeta,
  PageSummary,
  FolderSummary,
  SectionSummary,
} from "../store";

interface PageListProps {
  meta: NotebookMeta;
  /** e.g. "/notebook/abc123" or "/shared/xyz789" */
  basePath: string;
}

export function PageList({ meta, basePath }: PageListProps) {
  const [query, setQuery] = useState("");
  const allPages = meta.pageSummaries?.filter((p) => !p.isArchived) || [];
  const folders = meta.folders?.filter((f) => !f.isArchived) || [];
  const sections = (meta.sections || []).sort(
    (a, b) => a.position - b.position,
  );

  const isSearching = query.length > 0;

  const searchResults = useMemo(() => {
    if (!isSearching) return [];
    const q = query.toLowerCase();
    return allPages
      .filter((p) => (p.title || "").toLowerCase().includes(q))
      .sort((a, b) => {
        // Exact prefix match first
        const aTitle = (a.title || "").toLowerCase();
        const bTitle = (b.title || "").toLowerCase();
        const aPrefix = aTitle.startsWith(q) ? 0 : 1;
        const bPrefix = bTitle.startsWith(q) ? 0 : 1;
        if (aPrefix !== bPrefix) return aPrefix - bPrefix;
        return aTitle.localeCompare(bTitle);
      });
  }, [query, allPages, isSearching]);

  if (allPages.length === 0) {
    return (
      <div className="empty-state">
        <h3>No pages</h3>
        <p>This notebook is empty.</p>
      </div>
    );
  }

  const showSearchBar = allPages.length > 5;

  return (
    <div>
      {showSearchBar && (
        <div className="search-bar">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter pages..."
            className="search-input"
          />
          {query && (
            <button
              className="search-clear"
              onClick={() => setQuery("")}
            >
              &times;
            </button>
          )}
        </div>
      )}

      {isSearching ? (
        <SearchResults
          results={searchResults}
          query={query}
          folders={folders}
          sections={sections}
          basePath={basePath}
        />
      ) : sections.length > 0 ? (
        <SectionedPageList
          pages={allPages}
          folders={folders}
          sections={sections}
          basePath={basePath}
        />
      ) : (
        <FolderTreePageList
          pages={allPages}
          folders={folders}
          sectionId={null}
          basePath={basePath}
        />
      )}
    </div>
  );
}

// ─── Search results ───────────────────────────────────────────────────────────

function SearchResults({
  results,
  query,
  folders,
  sections,
  basePath,
}: {
  results: PageSummary[];
  query: string;
  folders: FolderSummary[];
  sections: SectionSummary[];
  basePath: string;
}) {
  if (results.length === 0) {
    return (
      <div className="empty-state" style={{ padding: "40px 24px" }}>
        <h3>No matches</h3>
        <p>No pages match &ldquo;{query}&rdquo;</p>
      </div>
    );
  }

  const folderMap = new Map(folders.map((f) => [f.id, f]));
  const sectionMap = new Map(sections.map((s) => [s.id, s]));

  return (
    <div className="page-list">
      {results.map((page) => {
        const breadcrumbs: string[] = [];
        if (page.sectionId) {
          const s = sectionMap.get(page.sectionId);
          if (s) breadcrumbs.push(s.name);
        }
        if (page.folderId) {
          const f = folderMap.get(page.folderId);
          if (f) breadcrumbs.push(f.name);
        }

        return (
          <Link
            key={page.id}
            to={`${basePath}/page/${page.id}`}
            className="page-item"
          >
            <div className="title">{page.title || "Untitled"}</div>
            <div className="search-meta">
              {breadcrumbs.length > 0 && (
                <span className="breadcrumb">{breadcrumbs.join(" / ")}</span>
              )}
              {page.updatedAt && (
                <span className="updated">{formatDate(page.updatedAt)}</span>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ─── Sectioned view (tabs at top) ─────────────────────────────────────────────

function SectionedPageList({
  pages,
  folders,
  sections,
  basePath,
}: {
  pages: PageSummary[];
  folders: FolderSummary[];
  sections: SectionSummary[];
  basePath: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get("section");
  const initialSection = sectionParam && sections.some((s) => s.id === sectionParam)
    ? sectionParam
    : sections[0]?.id ?? null;
  const [activeSection, setActiveSectionState] = useState<string | null>(initialSection);

  const setActiveSection = (id: string | null) => {
    setActiveSectionState(id);
    if (id && id !== sections[0]?.id) {
      setSearchParams({ section: id }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  };

  // Pages/folders not assigned to any section
  const unsectionedPages = pages.filter((p) => !p.sectionId);
  const unsectionedFolders = folders.filter((f) => !f.sectionId);
  const hasUnsectioned = unsectionedPages.length > 0;

  return (
    <div>
      <div className="section-tabs">
        {sections.map((s) => (
          <button
            key={s.id}
            className={`section-tab ${activeSection === s.id ? "active" : ""}`}
            onClick={() => setActiveSection(s.id)}
            style={
              activeSection === s.id && s.color
                ? { borderBottomColor: s.color }
                : undefined
            }
          >
            {s.color && (
              <span
                className="section-dot"
                style={{ background: s.color }}
              />
            )}
            {s.name}
          </button>
        ))}
        {hasUnsectioned && (
          <button
            className={`section-tab ${activeSection === null ? "active" : ""}`}
            onClick={() => setActiveSection(null)}
          >
            Other
          </button>
        )}
      </div>

      {activeSection === null ? (
        <FolderTreePageList
          pages={unsectionedPages}
          folders={unsectionedFolders}
          sectionId={null}
          basePath={basePath}
        />
      ) : (
        <FolderTreePageList
          pages={pages.filter((p) => p.sectionId === activeSection)}
          folders={folders.filter((f) => f.sectionId === activeSection)}
          sectionId={activeSection}
          basePath={basePath}
        />
      )}
    </div>
  );
}

// ─── Folder tree within a section (or root) ───────────────────────────────────

function FolderTreePageList({
  pages,
  folders,
  sectionId: _sectionId,
  basePath,
}: {
  pages: PageSummary[];
  folders: FolderSummary[];
  sectionId: string | null;
  basePath: string;
}) {
  const sorted = [...pages].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );

  // Root-level folders (no parent)
  const rootFolders = folders
    .filter((f) => !f.parentId)
    .sort((a, b) => a.position - b.position);

  // Pages not in any folder
  const loosePage = sorted.filter((p) => !p.folderId && !p.parentPageId);

  // Subpages (parentPageId set, no folder)
  const subpageMap = new Map<string, PageSummary[]>();
  for (const p of sorted) {
    if (p.parentPageId && !p.folderId) {
      const arr = subpageMap.get(p.parentPageId) || [];
      arr.push(p);
      subpageMap.set(p.parentPageId, arr);
    }
  }

  return (
    <div className="page-list">
      {rootFolders.map((folder) => (
        <FolderNode
          key={folder.id}
          folder={folder}
          allFolders={folders}
          allPages={sorted}
          subpageMap={subpageMap}
          basePath={basePath}
          depth={0}
        />
      ))}
      {loosePage.map((page) => (
        <PageItem
          key={page.id}
          page={page}
          basePath={basePath}
          subpages={subpageMap.get(page.id)}
          depth={0}
        />
      ))}
    </div>
  );
}

// ─── Folder node (recursive for nested folders) ──────────────────────────────

function FolderNode({
  folder,
  allFolders,
  allPages,
  subpageMap,
  basePath,
  depth,
}: {
  folder: FolderSummary;
  allFolders: FolderSummary[];
  allPages: PageSummary[];
  subpageMap: Map<string, PageSummary[]>;
  basePath: string;
  depth: number;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const childFolders = allFolders
    .filter((f) => f.parentId === folder.id)
    .sort((a, b) => a.position - b.position);

  const folderPages = allPages
    .filter((p) => p.folderId === folder.id && !p.parentPageId);

  const pageCount =
    folderPages.length +
    childFolders.reduce(
      (sum, cf) =>
        sum + allPages.filter((p) => p.folderId === cf.id).length,
      0,
    );

  return (
    <div style={{ marginLeft: depth > 0 ? 12 : 0 }}>
      <button
        className="folder-header"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className={`folder-chevron ${collapsed ? "collapsed" : ""}`}>
          &#9662;
        </span>
        {folder.color && (
          <span
            className="folder-dot"
            style={{ background: folder.color }}
          />
        )}
        <span className="folder-name">{folder.name}</span>
        <span className="folder-count">{pageCount}</span>
      </button>

      {!collapsed && (
        <>
          {childFolders.map((cf) => (
            <FolderNode
              key={cf.id}
              folder={cf}
              allFolders={allFolders}
              allPages={allPages}
              subpageMap={subpageMap}
              basePath={basePath}
              depth={depth + 1}
            />
          ))}
          {folderPages.map((page) => (
            <PageItem
              key={page.id}
              page={page}
              basePath={basePath}
              subpages={subpageMap.get(page.id)}
              depth={depth + 1}
            />
          ))}
        </>
      )}
    </div>
  );
}

// ─── Page item ────────────────────────────────────────────────────────────────

function PageItem({
  page,
  basePath,
  subpages,
  depth,
}: {
  page: PageSummary;
  basePath: string;
  subpages?: PageSummary[];
  depth: number;
}) {
  return (
    <>
      <Link
        to={`${basePath}/page/${page.id}`}
        className="page-item"
        style={{ paddingLeft: 16 + depth * 12 }}
      >
        <div className="title">{page.title || "Untitled"}</div>
        {page.updatedAt && (
          <div className="updated">{formatDate(page.updatedAt)}</div>
        )}
      </Link>
      {subpages?.map((sub) => (
        <Link
          key={sub.id}
          to={`${basePath}/page/${sub.id}`}
          className="page-item subpage"
          style={{ paddingLeft: 16 + (depth + 1) * 12 }}
        >
          <div className="title">{sub.title || "Untitled"}</div>
          {sub.updatedAt && (
            <div className="updated">{formatDate(sub.updatedAt)}</div>
          )}
        </Link>
      ))}
    </>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffDays = Math.floor(
      (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (diffDays === 0)
      return d.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  } catch {
    return iso;
  }
}
