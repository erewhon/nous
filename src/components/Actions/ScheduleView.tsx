import type { ScheduledActionInfo, Schedule } from "../../types/action";

interface ScheduleViewProps {
  scheduledActions: ScheduledActionInfo[];
  onRunNow: (actionId: string) => void;
}

type TimeGroup = "Today" | "Tomorrow" | "This Week" | "Later";

function getTimeGroup(date: Date): TimeGroup {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const endOfWeek = new Date(today);
  endOfWeek.setDate(endOfWeek.getDate() + (7 - today.getDay()));

  if (date < tomorrow) return "Today";
  if (date < new Date(tomorrow.getTime() + 86400000)) return "Tomorrow";
  if (date < endOfWeek) return "This Week";
  return "Later";
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs < 0) return "overdue";

  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "in less than a minute";
  if (diffMins < 60) return `in ${diffMins} minute${diffMins !== 1 ? "s" : ""}`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `in ${diffHours} hour${diffHours !== 1 ? "s" : ""}`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "tomorrow";
  if (diffDays < 7) return `in ${diffDays} days`;

  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

const DAY_NAMES: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

function describeSchedule(schedule: Schedule): string {
  switch (schedule.type) {
    case "daily":
      return schedule.skipWeekends
        ? `Weekdays at ${schedule.time}`
        : `Daily at ${schedule.time}`;
    case "weekly": {
      const days = schedule.days.map((d) => DAY_NAMES[d.toLowerCase()] ?? d).join(", ");
      return `${days} at ${schedule.time}`;
    }
    case "monthly":
      return `Monthly on the ${ordinal(schedule.dayOfMonth)} at ${schedule.time}`;
  }
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function ScheduleView({ scheduledActions, onRunNow }: ScheduleViewProps) {
  if (scheduledActions.length === 0) {
    return (
      <div className="py-12 text-center">
        <div
          className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full"
          style={{ backgroundColor: "var(--color-bg-tertiary)" }}
        >
          <IconClock />
        </div>
        <p style={{ color: "var(--color-text-muted)" }}>No scheduled actions</p>
        <p
          className="mt-1 text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          Add a schedule trigger in the action editor to see upcoming runs here
        </p>
      </div>
    );
  }

  const sorted = [...scheduledActions].sort(
    (a, b) => new Date(a.nextRun).getTime() - new Date(b.nextRun).getTime()
  );

  // Group by time period
  const groups = new Map<TimeGroup, ScheduledActionInfo[]>();
  for (const item of sorted) {
    const group = getTimeGroup(new Date(item.nextRun));
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(item);
  }

  const groupOrder: TimeGroup[] = ["Today", "Tomorrow", "This Week", "Later"];
  const activeGroups = groupOrder.filter((g) => groups.has(g));

  // If only one group or few items, render flat
  const useGroups = activeGroups.length > 1;

  return (
    <div className="space-y-4">
      {useGroups ? (
        activeGroups.map((groupName) => (
          <div key={groupName}>
            <h3
              className="mb-2 text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-text-muted)" }}
            >
              {groupName}
            </h3>
            <div className="space-y-2">
              {groups.get(groupName)!.map((item) => (
                <ScheduleRow key={item.actionId} item={item} onRunNow={onRunNow} />
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="space-y-2">
          {sorted.map((item) => (
            <ScheduleRow key={item.actionId} item={item} onRunNow={onRunNow} />
          ))}
        </div>
      )}
    </div>
  );
}

function ScheduleRow({
  item,
  onRunNow,
}: {
  item: ScheduledActionInfo;
  onRunNow: (actionId: string) => void;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors"
      style={{
        borderColor: "var(--color-border)",
        backgroundColor: "var(--color-bg-secondary)",
        opacity: item.enabled ? 1 : 0.5,
      }}
    >
      {/* Enabled indicator */}
      <div
        className="h-2 w-2 flex-shrink-0 rounded-full"
        style={{
          backgroundColor: item.enabled
            ? "var(--color-accent)"
            : "var(--color-text-muted)",
        }}
      />

      {/* Action info */}
      <div className="min-w-0 flex-1">
        <div
          className="truncate text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          {item.actionName}
        </div>
        <div
          className="text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          {describeSchedule(item.schedule)}
        </div>
      </div>

      {/* Next run time */}
      <div className="flex-shrink-0 text-right">
        <div
          className="text-sm"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {formatTime(item.nextRun)}
        </div>
        <div
          className="text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          {formatRelativeTime(item.nextRun)}
        </div>
      </div>

      {/* Run now button */}
      <button
        onClick={() => onRunNow(item.actionId)}
        className="flex-shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
        style={{
          backgroundColor: "var(--color-bg-tertiary)",
          color: "var(--color-text-secondary)",
        }}
        title="Run now"
      >
        <IconPlay />
      </button>
    </div>
  );
}

function IconClock() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "var(--color-text-muted)" }}
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}
