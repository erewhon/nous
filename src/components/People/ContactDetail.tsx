import type { Contact, ContactActivity } from "../../types/contact";

interface ContactDetailProps {
  contact: Contact;
  activities: ContactActivity[];
  onDelete: () => void;
}

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  if (isToday) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

function ActivityIcon({ type }: { type: string }) {
  const iconStyle = { color: "var(--color-text-muted)" };

  switch (type) {
    case "message":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case "call":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      );
    case "missedCall":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-error)" }}>
          <line x1="1" y1="1" x2="23" y2="23" />
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
          <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
          <path d="M1.44 9a16 16 0 0 1 2.15-1.17" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <line x1="12" y1="20" x2="12.01" y2="20" />
        </svg>
      );
    case "faceTimeAudio":
    case "faceTimeVideo":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
          <polygon points="23 7 16 12 23 17 23 7" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
      );
    default:
      return null;
  }
}

function DirectionArrow({ direction }: { direction: string }) {
  if (direction === "outgoing") {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-info)" }}>
        <line x1="7" y1="17" x2="17" y2="7" />
        <polyline points="7 7 17 7 17 17" />
      </svg>
    );
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-success)" }}>
      <line x1="17" y1="7" x2="7" y2="17" />
      <polyline points="17 17 7 17 7 7" />
    </svg>
  );
}

export function ContactDetail({
  contact,
  activities,
  onDelete,
}: ContactDetailProps) {
  return (
    <div className="flex h-full flex-col">
      {/* Contact header */}
      <div
        className="border-b px-4 py-3"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-medium"
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
          <div className="min-w-0 flex-1">
            <h3
              className="font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              {contact.name}
            </h3>
            <div
              className="flex flex-wrap gap-x-3 text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              {contact.phoneNumbers.map((p, i) => (
                <span key={i}>{p}</span>
              ))}
              {contact.emails.map((e, i) => (
                <span key={i}>{e}</span>
              ))}
            </div>
          </div>
          <button
            onClick={onDelete}
            className="rounded p-1 transition-colors hover:bg-red-500/20"
            style={{ color: "var(--color-text-muted)" }}
            title="Delete contact"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>

        {/* Tags */}
        {contact.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {contact.tags.map((tag, i) => (
              <span
                key={i}
                className="rounded-full px-2 py-0.5 text-[10px]"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  color: "var(--color-text-secondary)",
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Notes */}
        {contact.notes && (
          <p
            className="mt-2 text-xs"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {contact.notes}
          </p>
        )}
      </div>

      {/* Activity timeline */}
      <div className="flex-1 overflow-y-auto">
        {activities.length === 0 ? (
          <div
            className="px-4 py-8 text-center text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            No activity recorded
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
            {activities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start gap-2.5 px-4 py-2.5"
              >
                <div className="mt-0.5 flex items-center gap-1">
                  <DirectionArrow direction={activity.direction} />
                  <ActivityIcon type={activity.activityType} />
                </div>
                <div className="min-w-0 flex-1">
                  {activity.preview && (
                    <p
                      className="text-sm leading-snug"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      {activity.preview}
                    </p>
                  )}
                  <div
                    className="flex items-center gap-2 text-[11px]"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    <span>{formatTimestamp(activity.timestamp)}</span>
                    {activity.durationSeconds != null &&
                      activity.durationSeconds > 0 && (
                        <span>{formatDuration(activity.durationSeconds)}</span>
                      )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
