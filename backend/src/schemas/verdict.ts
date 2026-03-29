import { z } from 'zod';

export enum ViolationType {
  BLACKLIST_COMMAND = 'blacklist_command',
  RESOURCE_EXCEEDED = 'resource_exceeded',
  DEADLINE_EXCEEDED = 'deadline_exceeded',
  FILE_ACCESS_VIOLATION = 'file_access_violation',
  DEVIATION_EXCEEDED = 'deviation_exceeded',
  INFINITE_LOOP = 'infinite_loop',
}

export const RuleCheckResultSchema = z.object({
  passed: z.boolean().describe('是否通过校验'),
  rule_name: z.string().describe('规则名称'),
  violation_detail: z.string().optional().describe('违规详情（通过时为 undefined）'),
});
export type RuleCheckResult = z.infer<typeof RuleCheckResultSchema>;

export const DeviationResultSchema = z.object({
  score: z.number().min(0.0).max(1.0).describe('偏离度评分 0~1'),
  passed: z.boolean().describe('score <= max_score 时为 true'),
  explanation: z.string().describe('评估说明'),
  reason: z.string().optional().describe('LLM 生成的详细偏离原因/摘要'),
});
export type DeviationResult = z.infer<typeof DeviationResultSchema>;

export const ProcessReviewResultSchema = z.object({
  passed: z.boolean().describe('所有检查均通过则为 true'),
  checks: z.array(RuleCheckResultSchema).default([]).describe('各项检查结果'),
  violations: z.array(z.string()).default([]).describe('违规摘要列表'),
});
export type ProcessReviewResult = z.infer<typeof ProcessReviewResultSchema>;

export const ResultReviewResultSchema = z.object({
  deviation: DeviationResultSchema.describe('偏离度评估'),
  passed: z.boolean().describe('偏离度未超限则为 true'),
});
export type ResultReviewResult = z.infer<typeof ResultReviewResultSchema>;

export const VerdictSchema = z.object({
  verdict_id: z.string().describe('判决唯一 ID'),
  act_id: z.string().describe('关联的法案 ID'),
  constitutional: z.boolean().describe('true 合宪，false 违宪'),
  ruling: z.string().describe('判决摘要'),
  violation_type: z.nativeEnum(ViolationType).optional().describe('违宪类型（合宪时为 undefined）'),
  evidence: z.array(z.string()).default([]).describe('证据列表'),
  process_review: ProcessReviewResultSchema.optional().describe('过程审查结果'),
  result_review: ResultReviewResultSchema.optional().describe('结果审查结果'),
  remediation: z.string().optional().describe('补救建议'),
  created_at: z.date().default(() => new Date()).describe('创建时间'),
});
export type Verdict = z.infer<typeof VerdictSchema>;

export const KillReportSchema = z.object({
  verdict: VerdictSchema.describe('触发熔断的判决'),
  killed_processes: z.array(z.string()).default([]).describe('已终止的进程列表'),
  rollback_success: z.boolean().describe('状态回滚是否成功'),
  judgment_document: z.string().describe('完整判决书文本'),
});
export type KillReport = z.infer<typeof KillReportSchema>;
