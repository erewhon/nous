import { z } from "zod";

// ===== Schedule Types =====

export const DailyScheduleSchema = z.object({
  type: z.literal("daily"),
  time: z.string(), // HH:MM format
  skipWeekends: z.boolean().default(false),
});

export const WeeklyScheduleSchema = z.object({
  type: z.literal("weekly"),
  days: z.array(z.string()),
  time: z.string(),
});

export const MonthlyScheduleSchema = z.object({
  type: z.literal("monthly"),
  dayOfMonth: z.number().min(1).max(31),
  time: z.string(),
});

export const ScheduleSchema = z.discriminatedUnion("type", [
  DailyScheduleSchema,
  WeeklyScheduleSchema,
  MonthlyScheduleSchema,
]);

export type Schedule = z.infer<typeof ScheduleSchema>;

// ===== Trigger Types =====

export const ManualTriggerSchema = z.object({
  type: z.literal("manual"),
});

export const AiChatTriggerSchema = z.object({
  type: z.literal("aiChat"),
  keywords: z.array(z.string()),
});

export const ScheduledTriggerSchema = z.object({
  type: z.literal("scheduled"),
  schedule: ScheduleSchema,
});

export const ActionTriggerSchema = z.discriminatedUnion("type", [
  ManualTriggerSchema,
  AiChatTriggerSchema,
  ScheduledTriggerSchema,
]);

export type ActionTrigger = z.infer<typeof ActionTriggerSchema>;

// ===== Notebook Target =====

export const NotebookTargetCurrentSchema = z.object({
  type: z.literal("current"),
});

export const NotebookTargetByIdSchema = z.object({
  type: z.literal("byId"),
  id: z.string(),
});

export const NotebookTargetByNameSchema = z.object({
  type: z.literal("byName"),
  name: z.string(),
});

export const NotebookTargetSchema = z.discriminatedUnion("type", [
  NotebookTargetCurrentSchema,
  NotebookTargetByIdSchema,
  NotebookTargetByNameSchema,
]);

export type NotebookTarget = z.infer<typeof NotebookTargetSchema>;

// ===== Page Selector =====

export const PageSelectorSchema = z.object({
  notebook: NotebookTargetSchema.optional(),
  titlePattern: z.string().optional(),
  withTags: z.array(z.string()).default([]),
  withoutTags: z.array(z.string()).default([]),
  createdWithinDays: z.number().optional(),
  updatedWithinDays: z.number().optional(),
  archivedOnly: z.boolean().default(false),
  inFolder: z.string().optional(),
});

export type PageSelector = z.infer<typeof PageSelectorSchema>;

// ===== Page Destination =====

export const PageDestinationSchema = z.object({
  notebook: NotebookTargetSchema,
  folderName: z.string().optional(),
});

export type PageDestination = z.infer<typeof PageDestinationSchema>;

// ===== Summary Output =====

export const SummaryOutputNewPageSchema = z.object({
  type: z.literal("newPage"),
  notebookTarget: NotebookTargetSchema,
  titleTemplate: z.string(),
});

export const SummaryOutputPrependSchema = z.object({
  type: z.literal("prependToPage"),
  pageSelector: PageSelectorSchema,
});

export const SummaryOutputResultSchema = z.object({
  type: z.literal("result"),
});

export const SummaryOutputSchema = z.discriminatedUnion("type", [
  SummaryOutputNewPageSchema,
  SummaryOutputPrependSchema,
  SummaryOutputResultSchema,
]);

export type SummaryOutput = z.infer<typeof SummaryOutputSchema>;

// ===== Step Condition =====

export const StepConditionPagesExistSchema = z.object({
  type: z.literal("pagesExist"),
  selector: PageSelectorSchema,
});

export const StepConditionDayOfWeekSchema = z.object({
  type: z.literal("dayOfWeek"),
  days: z.array(z.string()),
});

export const StepConditionVariableEqualsSchema = z.object({
  type: z.literal("variableEquals"),
  name: z.string(),
  value: z.string(),
});

export const StepConditionVariableNotEmptySchema = z.object({
  type: z.literal("variableNotEmpty"),
  name: z.string(),
});

export const StepConditionSchema = z.discriminatedUnion("type", [
  StepConditionPagesExistSchema,
  StepConditionDayOfWeekSchema,
  StepConditionVariableEqualsSchema,
  StepConditionVariableNotEmptySchema,
]);

export type StepCondition = z.infer<typeof StepConditionSchema>;

// ===== Step Types =====

export const CreatePageFromTemplateStepSchema = z.object({
  type: z.literal("createPageFromTemplate"),
  templateId: z.string(),
  notebookTarget: NotebookTargetSchema,
  titleTemplate: z.string(),
  folderName: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export const CreateNotebookStepSchema = z.object({
  type: z.literal("createNotebook"),
  name: z.string(),
  notebookType: z.string().optional(),
});

export const CreateFolderStepSchema = z.object({
  type: z.literal("createFolder"),
  notebookTarget: NotebookTargetSchema,
  name: z.string(),
  parentFolderName: z.string().optional(),
});

export const MovePagesStepSchema = z.object({
  type: z.literal("movePages"),
  source: PageSelectorSchema,
  destination: PageDestinationSchema,
});

export const ArchivePagesStepSchema = z.object({
  type: z.literal("archivePages"),
  selector: PageSelectorSchema,
});

export const ManageTagsStepSchema = z.object({
  type: z.literal("manageTags"),
  selector: PageSelectorSchema,
  addTags: z.array(z.string()).default([]),
  removeTags: z.array(z.string()).default([]),
});

export const SearchAndProcessStepSchema: z.ZodType<SearchAndProcessStep> = z.lazy(() =>
  z.object({
    type: z.literal("searchAndProcess"),
    query: z.string(),
    processSteps: z.array(ActionStepSchema),
    limit: z.number().optional(),
  })
);

export const AiSummarizeStepSchema = z.object({
  type: z.literal("aiSummarize"),
  selector: PageSelectorSchema,
  outputTarget: SummaryOutputSchema,
  customPrompt: z.string().optional(),
});

export const CarryForwardItemsStepSchema = z.object({
  type: z.literal("carryForwardItems"),
  sourceSelector: PageSelectorSchema,
  destination: NotebookTargetSchema,
  titleTemplate: z.string(),
  templateId: z.string().optional(),
});

export const DelayStepSchema = z.object({
  type: z.literal("delay"),
  seconds: z.number(),
});

export const SetVariableStepSchema = z.object({
  type: z.literal("setVariable"),
  name: z.string(),
  value: z.string(),
});

export const ConditionalStepSchema: z.ZodType<ConditionalStep> = z.lazy(() =>
  z.object({
    type: z.literal("conditional"),
    condition: StepConditionSchema,
    thenSteps: z.array(ActionStepSchema),
    elseSteps: z.array(ActionStepSchema).default([]),
  })
);

// Interface for recursive types
interface SearchAndProcessStep {
  type: "searchAndProcess";
  query: string;
  processSteps: ActionStep[];
  limit?: number;
}

interface ConditionalStep {
  type: "conditional";
  condition: StepCondition;
  thenSteps: ActionStep[];
  elseSteps: ActionStep[];
}

export const ActionStepSchema: z.ZodType<ActionStep> = z.lazy(() =>
  z.discriminatedUnion("type", [
    CreatePageFromTemplateStepSchema,
    CreateNotebookStepSchema,
    CreateFolderStepSchema,
    MovePagesStepSchema,
    ArchivePagesStepSchema,
    ManageTagsStepSchema,
    z.object({
      type: z.literal("searchAndProcess"),
      query: z.string(),
      processSteps: z.array(ActionStepSchema),
      limit: z.number().optional(),
    }),
    AiSummarizeStepSchema,
    CarryForwardItemsStepSchema,
    DelayStepSchema,
    SetVariableStepSchema,
    z.object({
      type: z.literal("conditional"),
      condition: StepConditionSchema,
      thenSteps: z.array(ActionStepSchema),
      elseSteps: z.array(ActionStepSchema).default([]),
    }),
  ])
);

export type ActionStep = z.infer<typeof CreatePageFromTemplateStepSchema>
  | z.infer<typeof CreateNotebookStepSchema>
  | z.infer<typeof CreateFolderStepSchema>
  | z.infer<typeof MovePagesStepSchema>
  | z.infer<typeof ArchivePagesStepSchema>
  | z.infer<typeof ManageTagsStepSchema>
  | SearchAndProcessStep
  | z.infer<typeof AiSummarizeStepSchema>
  | z.infer<typeof CarryForwardItemsStepSchema>
  | z.infer<typeof DelayStepSchema>
  | z.infer<typeof SetVariableStepSchema>
  | ConditionalStep;

// ===== Variable Types =====

export const VariableTypeSchema = z.enum([
  "userInput",
  "currentDate",
  "currentDateFormatted",
  "dayOfWeek",
  "weekNumber",
  "monthName",
  "year",
  "currentNotebook",
]);

export type VariableType = z.infer<typeof VariableTypeSchema>;

export const ActionVariableSchema = z.object({
  name: z.string(),
  description: z.string(),
  defaultValue: z.string().optional(),
  variableType: VariableTypeSchema,
});

export type ActionVariable = z.infer<typeof ActionVariableSchema>;

// ===== Action Category =====

export const ActionCategorySchema = z.enum([
  "agileResults",
  "dailyRoutines",
  "weeklyReviews",
  "organization",
  "custom",
]);

export type ActionCategory = z.infer<typeof ActionCategorySchema>;

// ===== Action Definition =====

export const ActionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string().optional(),
  category: ActionCategorySchema.default("custom"),
  triggers: z.array(ActionTriggerSchema),
  steps: z.array(ActionStepSchema),
  enabled: z.boolean().default(true),
  isBuiltIn: z.boolean().default(false),
  variables: z.array(ActionVariableSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRun: z.string().optional(),
  nextRun: z.string().optional(),
});

export type Action = z.infer<typeof ActionSchema>;

// ===== Execution Result =====

export const ActionExecutionResultSchema = z.object({
  actionId: z.string(),
  actionName: z.string(),
  startedAt: z.string(),
  completedAt: z.string(),
  success: z.boolean(),
  stepsCompleted: z.number(),
  stepsTotal: z.number(),
  createdPages: z.array(z.string()).default([]),
  createdNotebooks: z.array(z.string()).default([]),
  modifiedPages: z.array(z.string()).default([]),
  errors: z.array(z.string()).default([]),
});

export type ActionExecutionResult = z.infer<typeof ActionExecutionResultSchema>;

// ===== Scheduled Action Info =====

export const ScheduledActionInfoSchema = z.object({
  actionId: z.string(),
  actionName: z.string(),
  nextRun: z.string(),
  schedule: ScheduleSchema,
  enabled: z.boolean(),
});

export type ScheduledActionInfo = z.infer<typeof ScheduledActionInfoSchema>;

// ===== Action Update =====

export const ActionUpdateSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  category: ActionCategorySchema.optional(),
  triggers: z.array(ActionTriggerSchema).optional(),
  steps: z.array(ActionStepSchema).optional(),
  enabled: z.boolean().optional(),
  variables: z.array(ActionVariableSchema).optional(),
});

export type ActionUpdate = z.infer<typeof ActionUpdateSchema>;

// ===== Helper Types =====

export interface ActionCategoryInfo {
  id: ActionCategory;
  name: string;
  icon: string;
  description: string;
}

export const ACTION_CATEGORIES: ActionCategoryInfo[] = [
  {
    id: "agileResults",
    name: "Agile Results",
    icon: "target",
    description: "Productivity workflows based on Agile Results methodology",
  },
  {
    id: "dailyRoutines",
    name: "Daily Routines",
    icon: "sun",
    description: "Actions for daily planning and reflection",
  },
  {
    id: "weeklyReviews",
    name: "Weekly Reviews",
    icon: "calendar",
    description: "Actions for weekly planning and review",
  },
  {
    id: "organization",
    name: "Organization",
    icon: "folder",
    description: "Actions for organizing and managing notes",
  },
  {
    id: "custom",
    name: "Custom",
    icon: "cog",
    description: "Your custom actions",
  },
];

// ===== Step Type Metadata =====

export interface StepTypeInfo {
  type: ActionStep["type"];
  name: string;
  description: string;
  icon: string;
}

export const STEP_TYPES: StepTypeInfo[] = [
  {
    type: "createPageFromTemplate",
    name: "Create Page from Template",
    description: "Create a new page using a template",
    icon: "file-plus",
  },
  {
    type: "createNotebook",
    name: "Create Notebook",
    description: "Create a new notebook",
    icon: "book-plus",
  },
  {
    type: "createFolder",
    name: "Create Folder",
    description: "Create a folder in a notebook",
    icon: "folder-plus",
  },
  {
    type: "movePages",
    name: "Move Pages",
    description: "Move pages matching criteria to a destination",
    icon: "file-export",
  },
  {
    type: "archivePages",
    name: "Archive Pages",
    description: "Archive pages matching criteria",
    icon: "archive",
  },
  {
    type: "manageTags",
    name: "Manage Tags",
    description: "Add or remove tags from pages",
    icon: "tag",
  },
  {
    type: "aiSummarize",
    name: "AI Summarize",
    description: "Generate AI summary of selected pages",
    icon: "sparkles",
  },
  {
    type: "carryForwardItems",
    name: "Carry Forward Items",
    description: "Copy incomplete checklist items to a new page",
    icon: "arrow-right",
  },
  {
    type: "delay",
    name: "Delay",
    description: "Wait before continuing to next step",
    icon: "clock",
  },
  {
    type: "conditional",
    name: "Conditional",
    description: "Execute steps based on a condition",
    icon: "git-branch",
  },
  {
    type: "setVariable",
    name: "Set Variable",
    description: "Set a variable for use in later steps",
    icon: "variable",
  },
];
