/**
 * REST API 请求/响应 Zod Schema — 翻译自 Python schemas.py + routes.py 的 Pydantic 模型。
 */

import { z } from 'zod';

// ─── 请求模型 ───

export const PetitionRequestSchema = z.object({
  prompt: z.string().trim().min(1, '选民请愿内容不能为空'),
});
export type PetitionRequest = z.infer<typeof PetitionRequestSchema>;

// ─── 响应模型 ───

export const PetitionResponseSchema = z.object({
  task_id: z.string(),
  status: z.string(),
  message: z.string(),
});
export type PetitionResponse = z.infer<typeof PetitionResponseSchema>;

export const TaskStatusResponseSchema = z.object({
  task_id: z.string(),
  petition: z.string(),
  status: z.string(),
  bill_state: z.string(),
  result: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string(),
});
export type TaskStatusResponse = z.infer<typeof TaskStatusResponseSchema>;

export const TaskSummarySchema = z.object({
  task_id: z.string(),
  petition: z.string(),
  status: z.string(),
  bill_state: z.string(),
  created_at: z.string(),
});
export type TaskSummary = z.infer<typeof TaskSummarySchema>;

export const TaskListResponseSchema = z.object({
  total: z.number().int().min(0).default(0),
  offset: z.number().int().min(0),
  limit: z.number().int().min(1),
  tasks: z.array(TaskSummarySchema),
});
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;

export const ActResponseSchema = z.object({
  task_id: z.string(),
  act: z.record(z.string(), z.any()),
  created_at: z.string(),
});
export type ActResponse = z.infer<typeof ActResponseSchema>;

export const DebateRoundSchema = z.object({
  round_number: z.number().int().min(1),
  radical_statement: z.string().default(''),
  conservative_statement: z.string().default(''),
  conflict_score: z.number().default(0.0),
  speaker_intervention: z.string().optional(),
});
export type DebateRound = z.infer<typeof DebateRoundSchema>;

export const DebateResponseSchema = z.object({
  task_id: z.string(),
  rounds: z.array(DebateRoundSchema).default([]),
  conflict_score_curve: z.array(z.number()).default([]),
  token_events: z.array(z.record(z.string(), z.any())).optional(),
});
export type DebateResponse = z.infer<typeof DebateResponseSchema>;

export const VerdictResponseSchema = z.object({
  task_id: z.string(),
  constitutional: z.boolean(),
  ruling: z.string(),
  evidence: z.array(z.string()).default([]),
  created_at: z.string(),
});
export type VerdictResponse = z.infer<typeof VerdictResponseSchema>;
