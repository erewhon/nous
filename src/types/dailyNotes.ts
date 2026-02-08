import { z } from "zod";

export const DailyNotesConfigSchema = z.object({
  enabled: z.boolean().default(true),
  templateId: z.string().nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
});

export type DailyNotesConfig = z.infer<typeof DailyNotesConfigSchema>;
