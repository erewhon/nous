export interface DateRange {
  startDate: string; // "YYYY-MM-DD"
  endDate: string;   // "YYYY-MM-DD"
  label: string;
}

export function getWeekRange(): DateRange {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7)); // Go to Monday
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    startDate: toDateStr(monday),
    endDate: toDateStr(sunday),
    label: "This Week",
  };
}

export function getLastWeekRange(): DateRange {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const lastMonday = new Date(now);
  lastMonday.setDate(now.getDate() - ((dayOfWeek + 6) % 7) - 7);
  const lastSunday = new Date(lastMonday);
  lastSunday.setDate(lastMonday.getDate() + 6);

  return {
    startDate: toDateStr(lastMonday),
    endDate: toDateStr(lastSunday),
    label: "Last Week",
  };
}

export function getMonthRange(): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return {
    startDate: toDateStr(start),
    endDate: toDateStr(end),
    label: "This Month",
  };
}

export function getLastMonthRange(): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);

  return {
    startDate: toDateStr(start),
    endDate: toDateStr(end),
    label: "Last Month",
  };
}

export type SummaryStyle = "concise" | "detailed" | "bullets" | "narrative";

export function buildRollupPrompt(
  style: SummaryStyle,
  dateRange: DateRange,
  customPrompt?: string
): string {
  const base = `Summarize the following daily journal entries from ${dateRange.label} (${dateRange.startDate} to ${dateRange.endDate}).`;

  const styleInstructions: Record<SummaryStyle, string> = {
    concise: "Provide a brief 2-3 sentence summary of key themes and accomplishments.",
    detailed: "Provide a detailed summary covering main topics, accomplishments, challenges, and patterns observed.",
    bullets: "Summarize as a bullet-point list organized by theme (accomplishments, challenges, insights, goals).",
    narrative: "Write a cohesive narrative summary that tells the story of this period, highlighting growth and patterns.",
  };

  let prompt = `${base}\n\n${styleInstructions[style]}`;

  if (customPrompt) {
    prompt += `\n\nAdditional instructions: ${customPrompt}`;
  }

  return prompt;
}

function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
