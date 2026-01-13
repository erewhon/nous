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
];

export const useTemplateStore = create<TemplateStore>()(
  persist(
    (set) => ({
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
