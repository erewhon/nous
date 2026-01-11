import { useLinkStore } from "../../stores/linkStore";
import { usePageStore } from "../../stores/pageStore";

interface BacklinksPanelProps {
  pageTitle: string;
  notebookId: string;
}

export function BacklinksPanel({ pageTitle, notebookId }: BacklinksPanelProps) {
  const { getBacklinks } = useLinkStore();
  const { selectPage, pages } = usePageStore();

  const backlinks = getBacklinks(pageTitle);

  const handleBacklinkClick = (sourcePageId: string) => {
    // Verify the page exists and is in the same notebook
    const page = pages.find(
      (p) => p.id === sourcePageId && p.notebookId === notebookId
    );
    if (page) {
      selectPage(sourcePageId);
    }
  };

  if (backlinks.length === 0) {
    return null;
  }

  return (
    <div className="mt-8 border-t border-[--color-border] pt-6">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-[--color-text-secondary]">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 17H7A5 5 0 0 1 7 7h2" />
          <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
        Backlinks ({backlinks.length})
      </h3>
      <ul className="space-y-2">
        {backlinks.map((backlink) => (
          <li key={backlink.sourcePageId}>
            <button
              onClick={() => handleBacklinkClick(backlink.sourcePageId)}
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-[--color-text-secondary] transition-colors hover:bg-[--color-bg-secondary] hover:text-[--color-text-primary]"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14,2 14,8 20,8" />
              </svg>
              <span className="truncate">{backlink.sourcePageTitle}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
