import { z } from 'zod';

export enum EventAction {
  PROPOSE = 'propose',
  BRAWL = 'brawl',
  ORDER = 'order',
  VOTE_PASSED = 'vote_passed',
  SIGN_ACT = 'sign_act',
  VETO = 'veto',
  TOOL_CALL = 'tool_call',
  CONSTITUTIONAL = 'constitutional',
  UNCONSTITUTIONAL = 'unconstitutional',
  STATE_CHANGE = 'state_change',
  LLM_THINKING = 'llm_thinking',
  TOKEN_USAGE = 'token_usage',
}

export enum EmotionType {
  NEUTRAL = 'neutral',
  PASSIONATE = 'passionate',
  ANGRY = 'angry',
  CONFIDENT = 'confident',
  WORRIED = 'worried',
  TRIUMPHANT = 'triumphant',
  STERN = 'stern',
}

export const BaseEventSchema = z.object({
  timestamp: z.date().default(() => new Date()),
  source_agent: z.string().describe('发出事件的 Agent 角色名'),
  target_agent: z.string().nullish().describe('目标 Agent（如有）'),
  action: z.nativeEnum(EventAction).describe('事件动作类型'),
  emotion: z.nativeEnum(EmotionType).default(EmotionType.NEUTRAL),
  intensity: z.number().min(0.0).max(1.0).default(0.5).describe('情绪强度 0~1'),
  payload: z.record(z.string(), z.any()).default({}).describe('自由扩展字段'),
  task_id: z.string().optional().describe('关联的任务 ID'),
});
export type BaseEvent = z.infer<typeof BaseEventSchema>;

export const DebateEventSchema = BaseEventSchema.extend({
  round_number: z.number().min(1).describe('当前辩论轮次'),
  conflict_score: z.number().min(0.0).max(100.0).describe('辩论分歧度'),
  statement: z.string().describe('发言内容'),
});
export type DebateEvent = z.infer<typeof DebateEventSchema>;

export const VoteEventSchema = BaseEventSchema.extend({
  action: z.literal(EventAction.VOTE_PASSED).default(EventAction.VOTE_PASSED),
  ayes: z.number().min(0).describe('赞成票数'),
  nays: z.number().min(0).describe('反对票数'),
  result: z.union([z.literal('passed'), z.literal('rejected')]).describe('passed 或 rejected'),
});
export type VoteEvent = z.infer<typeof VoteEventSchema>;

export const VetoEventSchema = BaseEventSchema.extend({
  action: z.literal(EventAction.VETO).default(EventAction.VETO),
  reason: z.string().describe('否决原因'),
});
export type VetoEvent = z.infer<typeof VetoEventSchema>;

export const ExecutionEventSchema = BaseEventSchema.extend({
  tool_name: z.string().describe('调用的工具/Skill 名称'),
  step_index: z.number().min(0).describe('执行步骤索引'),
  status: z.union([z.literal('running'), z.literal('success'), z.literal('failed')]).describe('running / success / failed'),
});
export type ExecutionEvent = z.infer<typeof ExecutionEventSchema>;

export const JudgmentEventSchema = BaseEventSchema.extend({
  violation_type: z.string().optional().describe('违宪类型'),
  ruling: z.string().describe('判决摘要'),
  reason: z.string().describe('原因说明'),
  traceback: z.string().optional().describe('执行追溯/上下文'),
  evidence: z.array(z.string()).default([]).describe('证据列表'),
});
export type JudgmentEvent = z.infer<typeof JudgmentEventSchema>;

export const TokenUsageEventSchema = BaseEventSchema.extend({
  action: z.literal(EventAction.TOKEN_USAGE).default(EventAction.TOKEN_USAGE),
  payload: z.object({
    branch: z.union([z.literal('legislative'), z.literal('executive'), z.literal('judicial')]).describe('三权分支'),
    tokens_used: z.number().min(0).describe('本次消耗 Token'),
    cumulative: z.number().min(0).describe('该分支累计消耗 Token'),
  }),
});
export type TokenUsageEvent = z.infer<typeof TokenUsageEventSchema>;
