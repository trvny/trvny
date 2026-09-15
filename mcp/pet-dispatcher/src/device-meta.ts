import { z } from "zod";

export const deviceMetaSchema = z.object({
  deviceId: z.string().min(1).max(128),
  transport: z.literal("cloudflare-queues-http-pull"),
  protocol: z.literal(1),
  updatedAt: z.string().datetime(),
  repositories: z.array(z.string().min(1).max(128)).max(128),
  workspaces: z.array(z.string().min(1).max(128)).max(128),
  directTools: z.array(z.string().min(1).max(128)).max(128),
  localTools: z.array(z.string().min(1).max(128)).max(256).default([]),
  activeSessions: z.number().int().min(0),
  activeProcesses: z.number().int().min(0),
  sandbox: z.object({
    supported: z.boolean(),
    processGuard: z.string().min(1),
    networkDefault: z.string().min(1),
    isolationTier: z.string().nullable().optional(),
  }).passthrough(),
}).strict();

export type DeviceMeta = z.infer<typeof deviceMetaSchema>;
