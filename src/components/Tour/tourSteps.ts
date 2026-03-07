export interface TourStep {
  /** CSS selector or data-tour attribute value to highlight */
  target: string;
  title: string;
  description: string;
  /** Tooltip placement relative to the highlighted element */
  placement: "top" | "bottom" | "left" | "right";
}

export const tourSteps: TourStep[] = [
  {
    target: "[data-tour='sidebar']",
    title: "Sidebar",
    description:
      "This is your sidebar. It shows your notebooks, pages, and quick-access tools. You can collapse it for more space.",
    placement: "right",
  },
  {
    target: "[data-tour='search']",
    title: "Search",
    description:
      "Quickly find any page across all your notebooks. You can also press Ctrl+K (or Cmd+K) to open the command palette.",
    placement: "bottom",
  },
  {
    target: "[data-tour='notebook-list']",
    title: "Notebooks",
    description:
      "Your notebooks live here. Each notebook can have sections and folders to organize your pages.",
    placement: "right",
  },
  {
    target: "[data-tour='tool-buttons']",
    title: "Quick Tools",
    description:
      "Access your tools here: inbox, daily notes, AI chat, and more. You can pin your favorites for quick access.",
    placement: "top",
  },
  {
    target: "[data-tour='editor']",
    title: "Editor",
    description:
      "This is where you write. Type '/' to see available block types like headings, lists, and checklists. Your changes save automatically.",
    placement: "left",
  },
  {
    target: "[data-tour='none']",
    title: "You're all set!",
    description:
      "Start writing and exploring. When you're ready for more power, open Settings and enable Expert Mode to unlock collaboration, actions, graph view, plugins, and more. You can replay this tour anytime from the command palette (Ctrl+K).",
    placement: "bottom",
  },
];
