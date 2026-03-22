import { z } from 'zod';

// Judicial Rules
export const JudicialConfigSchema = z.object({
  blacklist_commands: z.array(z.string()),
  token_budget: z.object({
    max_per_task: z.number(),
    debate_budget: z.number(),
    execution_budget: z.number(),
    review_budget: z.number(),
  }),
  debate: z.object({
    max_rounds: z.number(),
    conflict_threshold: z.number(),
    consensus_threshold: z.number(),
    min_rounds: z.number(),
  }),
  deviation: z.object({
    max_score: z.number(),
  }),
});

// Security Sandbox
export const SecurityConfigSchema = z.object({
  sandbox_enabled: z.boolean(),
  allowed_file_extensions: z.array(z.string()),
  max_execution_time_seconds: z.number(),
  max_file_size_mb: z.number(),
  network_access: z.string(),
});

// RBAC
export const RbacConfigSchema = z.object({
  permissions: z.array(z.string()),
  role_permissions: z.record(z.string(), z.array(z.string())),
});

// Constitution (Root)
export const ConstitutionConfigSchema = z.object({
  version: z.string(),
  judicial: JudicialConfigSchema,
  security: SecurityConfigSchema,
  rbac: RbacConfigSchema,
});

export type JudicialConfig = z.infer<typeof JudicialConfigSchema>;
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;
export type RbacConfig = z.infer<typeof RbacConfigSchema>;
export type ConstitutionConfig = z.infer<typeof ConstitutionConfigSchema>;
