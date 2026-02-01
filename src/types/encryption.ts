import { z } from "zod";

// Encryption level: none, notebook, or library
export const EncryptionLevelSchema = z.enum(["none", "notebook", "library"]);
export type EncryptionLevel = z.infer<typeof EncryptionLevelSchema>;

// Encryption configuration stored with notebooks/libraries
export const EncryptionConfigSchema = z.object({
  enabled: z.boolean(),
  level: EncryptionLevelSchema,
  salt: z.string(),
  verificationHash: z.string(),
  algorithmVersion: z.number().int(),
  encryptedAt: z.string().datetime(),
  passwordHint: z.string().optional(),
});
export type EncryptionConfig = z.infer<typeof EncryptionConfigSchema>;

// Result of an unlock operation
export const UnlockResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});
export type UnlockResult = z.infer<typeof UnlockResultSchema>;

// Encryption statistics
export const EncryptionStatsSchema = z.object({
  unlockedNotebooks: z.number().int().nonnegative(),
  unlockedLibraries: z.number().int().nonnegative(),
  autoLockTimeoutSecs: z.number().int().positive(),
});
export type EncryptionStats = z.infer<typeof EncryptionStatsSchema>;

// Request to enable encryption
export interface EnableEncryptionRequest {
  password: string;
  passwordHint?: string;
}

// Request to change password
export interface ChangePasswordRequest {
  oldPassword: string;
  newPassword: string;
  newHint?: string;
}
