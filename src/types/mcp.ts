import { z } from "zod";

// MCP Server Configuration Schema
export const MCPServerConfigSchema = z.object({
  name: z.string().min(1, "Server name is required"),
  command: z.string().min(1, "Command is required"),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(true),
  timeoutSeconds: z.number().int().positive().default(30),
});

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;

// MCP Servers Configuration (collection of servers)
export const MCPServersConfigSchema = z.object({
  servers: z.array(MCPServerConfigSchema).default([]),
});

export type MCPServersConfig = z.infer<typeof MCPServersConfigSchema>;

// MCP Tool Schema (tool definition from a running server)
export const MCPToolSchema = z.object({
  serverName: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  inputSchema: z.record(z.string(), z.unknown()),
});

export type MCPTool = z.infer<typeof MCPToolSchema>;

// MCP Tool Result Schema
export const MCPToolResultSchema = z.object({
  serverName: z.string(),
  toolName: z.string(),
  success: z.boolean(),
  content: z.unknown().nullable(),
  error: z.string().nullable(),
});

export type MCPToolResult = z.infer<typeof MCPToolResultSchema>;

// Helper function to create a default server config
export function createDefaultServerConfig(): MCPServerConfig {
  return {
    name: "",
    command: "",
    args: [],
    env: {},
    enabled: true,
    timeoutSeconds: 30,
  };
}

// Helper function to validate server config
export function validateServerConfig(config: unknown): MCPServerConfig | null {
  const result = MCPServerConfigSchema.safeParse(config);
  return result.success ? result.data : null;
}
