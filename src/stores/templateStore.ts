import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EditorData } from "../types/page";

export interface PageTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  content: EditorData;
  isBuiltIn: boolean;
  sourcePageId?: string; // ID of the page this template was created from
}

interface TemplateState {
  templates: PageTemplate[];
  showTemplateDialog: boolean;
  pendingNotebookId: string | null;
}

interface TemplateActions {
  addTemplate: (template: Omit<PageTemplate, "id" | "isBuiltIn">) => void;
  updateTemplate: (id: string, updates: Partial<PageTemplate>) => void;
  deleteTemplate: (id: string) => void;
  openTemplateDialog: (notebookId: string) => void;
  closeTemplateDialog: () => void;
  getTemplateForPage: (pageId: string) => PageTemplate | undefined;
}

type TemplateStore = TemplateState & TemplateActions;

// Built-in templates
const builtInTemplates: PageTemplate[] = [
  {
    id: "blank",
    name: "Blank Page",
    description: "Start with an empty page",
    icon: "file",
    isBuiltIn: true,
    content: {
      time: Date.now(),
      version: "2.28.2",
      blocks: [],
    },
  },
  {
    id: "meeting-notes",
    name: "Meeting Notes",
    description: "Template for capturing meeting discussions",
    icon: "users",
    isBuiltIn: true,
    content: {
      time: Date.now(),
      version: "2.28.2",
      blocks: [
        {
          id: "meeting-header",
          type: "header",
          data: { text: "Meeting Notes", level: 1 },
        },
        {
          id: "meeting-meta",
          type: "paragraph",
          data: { text: "<b>Date:</b> " },
        },
        {
          id: "meeting-attendees",
          type: "paragraph",
          data: { text: "<b>Attendees:</b> " },
        },
        {
          id: "agenda-header",
          type: "header",
          data: { text: "Agenda", level: 2 },
        },
        {
          id: "agenda-list",
          type: "list",
          data: { style: "unordered", items: ["Topic 1", "Topic 2", "Topic 3"] },
        },
        {
          id: "discussion-header",
          type: "header",
          data: { text: "Discussion Notes", level: 2 },
        },
        {
          id: "discussion-content",
          type: "paragraph",
          data: { text: "" },
        },
        {
          id: "action-header",
          type: "header",
          data: { text: "Action Items", level: 2 },
        },
        {
          id: "action-list",
          type: "checklist",
          data: {
            items: [
              { text: "Action item 1", checked: false },
              { text: "Action item 2", checked: false },
            ],
          },
        },
        {
          id: "next-header",
          type: "header",
          data: { text: "Next Steps", level: 2 },
        },
        {
          id: "next-content",
          type: "paragraph",
          data: { text: "" },
        },
      ],
    },
  },
  {
    id: "daily-journal",
    name: "Daily Journal",
    description: "Template for daily reflections and planning",
    icon: "calendar",
    isBuiltIn: true,
    content: {
      time: Date.now(),
      version: "2.28.2",
      blocks: [
        {
          id: "journal-header",
          type: "header",
          data: { text: new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }), level: 1 },
        },
        {
          id: "gratitude-header",
          type: "header",
          data: { text: "Gratitude", level: 2 },
        },
        {
          id: "gratitude-content",
          type: "paragraph",
          data: { text: "What am I grateful for today?" },
        },
        {
          id: "goals-header",
          type: "header",
          data: { text: "Today's Goals", level: 2 },
        },
        {
          id: "goals-list",
          type: "checklist",
          data: {
            items: [
              { text: "Goal 1", checked: false },
              { text: "Goal 2", checked: false },
              { text: "Goal 3", checked: false },
            ],
          },
        },
        {
          id: "notes-header",
          type: "header",
          data: { text: "Notes & Thoughts", level: 2 },
        },
        {
          id: "notes-content",
          type: "paragraph",
          data: { text: "" },
        },
        {
          id: "reflection-header",
          type: "header",
          data: { text: "End of Day Reflection", level: 2 },
        },
        {
          id: "reflection-content",
          type: "paragraph",
          data: { text: "What went well? What could be improved?" },
        },
      ],
    },
  },
  {
    id: "project",
    name: "Project",
    description: "Template for project planning and tracking",
    icon: "folder",
    isBuiltIn: true,
    content: {
      time: Date.now(),
      version: "2.28.2",
      blocks: [
        {
          id: "project-header",
          type: "header",
          data: { text: "Project Name", level: 1 },
        },
        {
          id: "overview-header",
          type: "header",
          data: { text: "Overview", level: 2 },
        },
        {
          id: "overview-content",
          type: "paragraph",
          data: { text: "Brief description of the project and its goals." },
        },
        {
          id: "objectives-header",
          type: "header",
          data: { text: "Objectives", level: 2 },
        },
        {
          id: "objectives-list",
          type: "list",
          data: { style: "unordered", items: ["Objective 1", "Objective 2", "Objective 3"] },
        },
        {
          id: "timeline-header",
          type: "header",
          data: { text: "Timeline", level: 2 },
        },
        {
          id: "timeline-content",
          type: "paragraph",
          data: { text: "<b>Start Date:</b> \n<b>Target Completion:</b> " },
        },
        {
          id: "tasks-header",
          type: "header",
          data: { text: "Tasks", level: 2 },
        },
        {
          id: "tasks-list",
          type: "checklist",
          data: {
            items: [
              { text: "Task 1", checked: false },
              { text: "Task 2", checked: false },
              { text: "Task 3", checked: false },
            ],
          },
        },
        {
          id: "resources-header",
          type: "header",
          data: { text: "Resources & Links", level: 2 },
        },
        {
          id: "resources-list",
          type: "list",
          data: { style: "unordered", items: ["Resource 1", "Resource 2"] },
        },
        {
          id: "notes-header",
          type: "header",
          data: { text: "Notes", level: 2 },
        },
        {
          id: "notes-content",
          type: "paragraph",
          data: { text: "" },
        },
      ],
    },
  },
  {
    id: "reading-notes",
    name: "Reading Notes",
    description: "Template for book or article notes",
    icon: "book",
    isBuiltIn: true,
    content: {
      time: Date.now(),
      version: "2.28.2",
      blocks: [
        {
          id: "reading-header",
          type: "header",
          data: { text: "Book/Article Title", level: 1 },
        },
        {
          id: "meta-content",
          type: "paragraph",
          data: { text: "<b>Author:</b> \n<b>Published:</b> \n<b>Source:</b> " },
        },
        {
          id: "summary-header",
          type: "header",
          data: { text: "Summary", level: 2 },
        },
        {
          id: "summary-content",
          type: "paragraph",
          data: { text: "Brief summary of the main ideas." },
        },
        {
          id: "key-header",
          type: "header",
          data: { text: "Key Takeaways", level: 2 },
        },
        {
          id: "key-list",
          type: "list",
          data: { style: "unordered", items: ["Takeaway 1", "Takeaway 2", "Takeaway 3"] },
        },
        {
          id: "quotes-header",
          type: "header",
          data: { text: "Notable Quotes", level: 2 },
        },
        {
          id: "quotes-content",
          type: "quote",
          data: { text: "Add memorable quotes here...", caption: "" },
        },
        {
          id: "thoughts-header",
          type: "header",
          data: { text: "My Thoughts", level: 2 },
        },
        {
          id: "thoughts-content",
          type: "paragraph",
          data: { text: "" },
        },
        {
          id: "connections-header",
          type: "header",
          data: { text: "Connections", level: 2 },
        },
        {
          id: "connections-content",
          type: "paragraph",
          data: { text: "How does this connect to other ideas or notes?" },
        },
      ],
    },
  },
  // Agile Results Templates
  {
    id: "agile-results-daily",
    name: "Daily Outcomes",
    description: "Agile Results template for three daily outcomes",
    icon: "target",
    isBuiltIn: true,
    content: {
      time: Date.now(),
      version: "2.28.2",
      blocks: [
        {
          id: "daily-header",
          type: "header",
          data: { text: "Daily Outcomes", level: 1 },
        },
        {
          id: "daily-intro",
          type: "paragraph",
          data: { text: "Focus on <b>three key outcomes</b> that will make today a success." },
        },
        {
          id: "outcomes-header",
          type: "header",
          data: { text: "Three Outcomes for Today", level: 2 },
        },
        {
          id: "outcomes-list",
          type: "checklist",
          data: {
            items: [
              { text: "Outcome 1: ", checked: false },
              { text: "Outcome 2: ", checked: false },
              { text: "Outcome 3: ", checked: false },
            ],
          },
        },
        {
          id: "energy-header",
          type: "header",
          data: { text: "Energy Management", level: 2 },
        },
        {
          id: "energy-content",
          type: "paragraph",
          data: { text: "<b>Morning (high energy):</b> \n<b>Afternoon (focus time):</b> \n<b>Evening (wind down):</b> " },
        },
        {
          id: "wins-header",
          type: "header",
          data: { text: "Daily Wins", level: 2 },
        },
        {
          id: "wins-list",
          type: "list",
          data: { style: "unordered", items: [""] },
        },
        {
          id: "lessons-header",
          type: "header",
          data: { text: "Lessons Learned", level: 2 },
        },
        {
          id: "lessons-content",
          type: "paragraph",
          data: { text: "" },
        },
      ],
    },
  },
  {
    id: "agile-results-weekly",
    name: "Weekly Outcomes",
    description: "Agile Results template for weekly planning",
    icon: "calendar",
    isBuiltIn: true,
    content: {
      time: Date.now(),
      version: "2.28.2",
      blocks: [
        {
          id: "weekly-header",
          type: "header",
          data: { text: "Weekly Outcomes", level: 1 },
        },
        {
          id: "weekly-intro",
          type: "paragraph",
          data: { text: "Set <b>three key outcomes</b> for the week that align with your monthly and yearly goals." },
        },
        {
          id: "week-outcomes-header",
          type: "header",
          data: { text: "Three Outcomes for This Week", level: 2 },
        },
        {
          id: "week-outcomes-list",
          type: "checklist",
          data: {
            items: [
              { text: "Outcome 1: ", checked: false },
              { text: "Outcome 2: ", checked: false },
              { text: "Outcome 3: ", checked: false },
            ],
          },
        },
        {
          id: "mon-header",
          type: "header",
          data: { text: "Monday", level: 3 },
        },
        {
          id: "mon-content",
          type: "checklist",
          data: { items: [{ text: "", checked: false }] },
        },
        {
          id: "tue-header",
          type: "header",
          data: { text: "Tuesday", level: 3 },
        },
        {
          id: "tue-content",
          type: "checklist",
          data: { items: [{ text: "", checked: false }] },
        },
        {
          id: "wed-header",
          type: "header",
          data: { text: "Wednesday", level: 3 },
        },
        {
          id: "wed-content",
          type: "checklist",
          data: { items: [{ text: "", checked: false }] },
        },
        {
          id: "thu-header",
          type: "header",
          data: { text: "Thursday", level: 3 },
        },
        {
          id: "thu-content",
          type: "checklist",
          data: { items: [{ text: "", checked: false }] },
        },
        {
          id: "fri-header",
          type: "header",
          data: { text: "Friday", level: 3 },
        },
        {
          id: "fri-content",
          type: "checklist",
          data: { items: [{ text: "", checked: false }] },
        },
        {
          id: "reflection-header",
          type: "header",
          data: { text: "Weekly Reflection", level: 2 },
        },
        {
          id: "reflection-content",
          type: "paragraph",
          data: { text: "<b>What went well:</b> \n<b>What to improve:</b> \n<b>Key learnings:</b> " },
        },
      ],
    },
  },
  {
    id: "agile-results-monthly",
    name: "Monthly Outcomes",
    description: "Agile Results template for monthly planning",
    icon: "calendar",
    isBuiltIn: true,
    content: {
      time: Date.now(),
      version: "2.28.2",
      blocks: [
        {
          id: "monthly-header",
          type: "header",
          data: { text: "Monthly Outcomes", level: 1 },
        },
        {
          id: "monthly-intro",
          type: "paragraph",
          data: { text: "Set <b>three key outcomes</b> for this month that support your yearly goals." },
        },
        {
          id: "month-outcomes-header",
          type: "header",
          data: { text: "Three Outcomes for This Month", level: 2 },
        },
        {
          id: "month-outcomes-list",
          type: "checklist",
          data: {
            items: [
              { text: "Outcome 1: ", checked: false },
              { text: "Outcome 2: ", checked: false },
              { text: "Outcome 3: ", checked: false },
            ],
          },
        },
        {
          id: "week1-header",
          type: "header",
          data: { text: "Week 1 Focus", level: 3 },
        },
        {
          id: "week1-content",
          type: "paragraph",
          data: { text: "" },
        },
        {
          id: "week2-header",
          type: "header",
          data: { text: "Week 2 Focus", level: 3 },
        },
        {
          id: "week2-content",
          type: "paragraph",
          data: { text: "" },
        },
        {
          id: "week3-header",
          type: "header",
          data: { text: "Week 3 Focus", level: 3 },
        },
        {
          id: "week3-content",
          type: "paragraph",
          data: { text: "" },
        },
        {
          id: "week4-header",
          type: "header",
          data: { text: "Week 4 Focus", level: 3 },
        },
        {
          id: "week4-content",
          type: "paragraph",
          data: { text: "" },
        },
        {
          id: "month-reflection-header",
          type: "header",
          data: { text: "Monthly Review", level: 2 },
        },
        {
          id: "month-wins",
          type: "paragraph",
          data: { text: "<b>Wins:</b> " },
        },
        {
          id: "month-lessons",
          type: "paragraph",
          data: { text: "<b>Lessons:</b> " },
        },
        {
          id: "month-next",
          type: "paragraph",
          data: { text: "<b>Next month focus:</b> " },
        },
      ],
    },
  },
  {
    id: "daily-reflection",
    name: "Daily Reflection",
    description: "End of day review and reflection",
    icon: "sun",
    isBuiltIn: true,
    content: {
      time: Date.now(),
      version: "2.28.2",
      blocks: [
        {
          id: "reflection-header",
          type: "header",
          data: { text: "Daily Reflection", level: 1 },
        },
        {
          id: "wins-header",
          type: "header",
          data: { text: "Three Wins Today", level: 2 },
        },
        {
          id: "wins-list",
          type: "list",
          data: { style: "ordered", items: ["", "", ""] },
        },
        {
          id: "learned-header",
          type: "header",
          data: { text: "What I Learned", level: 2 },
        },
        {
          id: "learned-content",
          type: "paragraph",
          data: { text: "" },
        },
        {
          id: "improve-header",
          type: "header",
          data: { text: "What Could Have Gone Better", level: 2 },
        },
        {
          id: "improve-content",
          type: "paragraph",
          data: { text: "" },
        },
        {
          id: "tomorrow-header",
          type: "header",
          data: { text: "Focus for Tomorrow", level: 2 },
        },
        {
          id: "tomorrow-content",
          type: "paragraph",
          data: { text: "" },
        },
        {
          id: "gratitude-header",
          type: "header",
          data: { text: "Gratitude", level: 2 },
        },
        {
          id: "gratitude-content",
          type: "paragraph",
          data: { text: "What am I grateful for today?" },
        },
      ],
    },
  },
  {
    id: "weekly-review",
    name: "Weekly Review",
    description: "Friday Review template for weekly retrospective",
    icon: "calendar",
    isBuiltIn: true,
    content: {
      time: Date.now(),
      version: "2.28.2",
      blocks: [
        {
          id: "review-header",
          type: "header",
          data: { text: "Friday Review", level: 1 },
        },
        {
          id: "review-intro",
          type: "paragraph",
          data: { text: "Take time to reflect on the week and prepare for the next." },
        },
        {
          id: "accomplished-header",
          type: "header",
          data: { text: "What I Accomplished", level: 2 },
        },
        {
          id: "accomplished-list",
          type: "list",
          data: { style: "unordered", items: ["", "", ""] },
        },
        {
          id: "wins-header",
          type: "header",
          data: { text: "Wins of the Week", level: 2 },
        },
        {
          id: "wins-list",
          type: "list",
          data: { style: "ordered", items: ["", "", ""] },
        },
        {
          id: "challenges-header",
          type: "header",
          data: { text: "Challenges & Obstacles", level: 2 },
        },
        {
          id: "challenges-content",
          type: "paragraph",
          data: { text: "" },
        },
        {
          id: "lessons-header",
          type: "header",
          data: { text: "Lessons Learned", level: 2 },
        },
        {
          id: "lessons-content",
          type: "paragraph",
          data: { text: "" },
        },
        {
          id: "next-week-header",
          type: "header",
          data: { text: "Focus for Next Week", level: 2 },
        },
        {
          id: "next-week-list",
          type: "checklist",
          data: {
            items: [
              { text: "", checked: false },
              { text: "", checked: false },
              { text: "", checked: false },
            ],
          },
        },
        {
          id: "gratitude-header",
          type: "header",
          data: { text: "Gratitude", level: 2 },
        },
        {
          id: "gratitude-content",
          type: "paragraph",
          data: { text: "What am I grateful for this week?" },
        },
      ],
    },
  },
];

export const useTemplateStore = create<TemplateStore>()(
  persist(
    (set, get) => ({
      templates: builtInTemplates,
      showTemplateDialog: false,
      pendingNotebookId: null,

      addTemplate: (template) => {
        const newTemplate: PageTemplate = {
          ...template,
          id: crypto.randomUUID(),
          isBuiltIn: false,
        };
        set((state) => ({
          templates: [...state.templates, newTemplate],
        }));
      },

      updateTemplate: (id, updates) => {
        set((state) => ({
          templates: state.templates.map((t) =>
            t.id === id && !t.isBuiltIn ? { ...t, ...updates } : t
          ),
        }));
      },

      deleteTemplate: (id) => {
        set((state) => ({
          templates: state.templates.filter((t) => t.id !== id || t.isBuiltIn),
        }));
      },

      openTemplateDialog: (notebookId) => {
        set({ showTemplateDialog: true, pendingNotebookId: notebookId });
      },

      closeTemplateDialog: () => {
        set({ showTemplateDialog: false, pendingNotebookId: null });
      },

      getTemplateForPage: (pageId) => {
        return get().templates.find((t) => t.sourcePageId === pageId);
      },
    }),
    {
      name: "katt-templates",
      partialize: (state) => ({
        // Only persist custom templates
        templates: state.templates.filter((t) => !t.isBuiltIn),
      }),
      merge: (persisted, current) => {
        const persistedState = persisted as Partial<TemplateState>;
        const customTemplates = persistedState.templates || [];
        return {
          ...current,
          templates: [...builtInTemplates, ...customTemplates],
        };
      },
    }
  )
);
