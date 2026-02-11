import type { Contact } from "../../types/contact";

interface ContactListProps {
  contacts: Contact[];
  selectedContactId: string | null;
  searchQuery: string;
  onSelect: (id: string) => void;
  onSearchChange: (query: string) => void;
}

function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

export function ContactList({
  contacts,
  selectedContactId,
  searchQuery,
  onSelect,
  onSearchChange,
}: ContactListProps) {
  const filtered = searchQuery
    ? contacts.filter(
        (c) =>
          c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.emails.some((e) =>
            e.toLowerCase().includes(searchQuery.toLowerCase())
          ) ||
          c.phoneNumbers.some((p) => p.includes(searchQuery))
      )
    : contacts;

  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="px-3 py-2">
        <input
          type="text"
          placeholder="Search contacts..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full rounded-md border px-2.5 py-1.5 text-sm outline-none"
          style={{
            backgroundColor: "var(--color-bg-primary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div
            className="px-4 py-8 text-center text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            {searchQuery ? "No matches" : "No contacts yet"}
          </div>
        ) : (
          filtered.map((contact) => (
            <button
              key={contact.id}
              onClick={() => onSelect(contact.id)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/5"
              style={{
                backgroundColor:
                  selectedContactId === contact.id
                    ? "var(--color-bg-tertiary)"
                    : undefined,
              }}
            >
              {/* Avatar */}
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium"
                style={{
                  backgroundColor: "var(--color-accent)",
                  color: "white",
                }}
              >
                {contact.name
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div
                  className="truncate text-sm font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {contact.name}
                </div>
                <div
                  className="truncate text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {contact.phoneNumbers[0] || contact.emails[0] || ""}
                </div>
              </div>

              {/* Time badge */}
              <span
                className="shrink-0 text-[10px]"
                style={{ color: "var(--color-text-muted)" }}
              >
                {formatRelativeTime(contact.lastContacted)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
