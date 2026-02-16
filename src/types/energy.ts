import { z } from "zod";

// Focus capacity types
export const FocusCapacitySchema = z.enum([
  "deepWork",
  "lightWork",
  "physical",
  "creative",
]);
export type FocusCapacity = z.infer<typeof FocusCapacitySchema>;

// Energy check-in
export const EnergyCheckInSchema = z.object({
  id: z.string().uuid(),
  date: z.string(), // YYYY-MM-DD
  energyLevel: z.number().min(1).max(5),
  focusCapacity: z.array(FocusCapacitySchema),
  sleepQuality: z.number().min(1).max(4).nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EnergyCheckIn = z.infer<typeof EnergyCheckInSchema>;

// Create check-in request
export const CreateCheckInRequestSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  energyLevel: z.number().min(1).max(5),
  focusCapacity: z.array(FocusCapacitySchema),
  sleepQuality: z.number().min(1).max(4).optional(),
  notes: z.string().optional(),
});
export type CreateCheckInRequest = z.infer<typeof CreateCheckInRequestSchema>;

// Update check-in request
export const UpdateCheckInRequestSchema = z.object({
  energyLevel: z.number().min(1).max(5).optional(),
  focusCapacity: z.array(FocusCapacitySchema).optional(),
  sleepQuality: z.number().min(1).max(4).optional(),
  notes: z.string().optional(),
});
export type UpdateCheckInRequest = z.infer<typeof UpdateCheckInRequestSchema>;

// Energy pattern (computed)
export const EnergyPatternSchema = z.object({
  dayOfWeekAverages: z.record(z.string(), z.number()),
  currentStreak: z.number(),
  typicalLowDays: z.array(z.string()),
  typicalHighDays: z.array(z.string()),
});
export type EnergyPattern = z.infer<typeof EnergyPatternSchema>;
