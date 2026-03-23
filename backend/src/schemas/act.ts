import { z } from 'zod';

export const ActStepSchema = z.object({
  index: z.number().min(0).describe('步骤编号'),
  description: z.string().describe('步骤描述'),
  required_skill: z.string().describe('所需 Skill 名称'),
  tool_parameters: z.record(z.string(), z.any()).default({}).describe('工具参数'),
  estimated_tokens: z.number().min(0).describe('预估 Token 消耗'),
  acceptance_criteria: z.string().describe('验收标准'),
  dependencies: z.array(z.number()).default([]).describe('依赖的步骤编号'),
});
export type ActStep = z.infer<typeof ActStepSchema>;

export const DebateRecordSchema = z.object({
  total_rounds: z.number().min(0).describe('辩论总轮次'),
  final_conflict_score: z.number().min(0.0).max(100.0).describe('最终分歧度评分'),
  consensus_points: z.array(z.string()).default([]).describe('共识要点列表'),
  remaining_concerns: z.array(z.string()).default([]).describe('遗留争议列表'),
});
export type DebateRecord = z.infer<typeof DebateRecordSchema>;

export const ActVoteRecordSchema = z.object({
  ayes: z.number().min(0).describe('赞成票数'),
  nays: z.number().min(0).describe('反对票数'),
  result: z.union([z.literal('passed'), z.literal('rejected')]).describe('表决结果'),
  voter_positions: z.record(z.string(), z.string()).default({}).describe("各角色投票立场 {角色名: 'aye'/'nay'}"),
});
export type ActVoteRecord = z.infer<typeof ActVoteRecordSchema>;

export const ActSchema = z.object({
  act_id: z.string().describe('法案唯一 ID'),
  title: z.string().describe('法案标题'),
  summary: z.string().describe('法案摘要'),
  petition_origin: z.string().describe('原始选民请愿内容'),
  steps: z.array(ActStepSchema).min(1).describe('执行步骤列表'),
  total_estimated_tokens: z.number().min(0).describe('总预估 Token'),
  debate_record: DebateRecordSchema.describe('辩论记录摘要'),
  vote_record: ActVoteRecordSchema.describe('表决记录'),
  created_at: z.date().default(() => new Date()).describe('创建时间'),
});
export type Act = z.infer<typeof ActSchema>;

export const SignOrVetoSchema = z.union([z.literal('sign'), z.literal('veto')]);
export type SignOrVeto = z.infer<typeof SignOrVetoSchema>;

export const VetoNoticeSchema = z.object({
  act_id: z.string().describe('被否决的法案 ID'),
  reason: z.string().describe('否决总述'),
  specific_issues: z.array(z.string()).min(1).describe('具体问题列表'),
  suggestion: z.string().optional().describe('修改建议'),
});
export type VetoNotice = z.infer<typeof VetoNoticeSchema>;

export const ExecutionTaskSchema = z.object({
  task_id: z.string().describe('任务唯一 ID'),
  act_id: z.string().describe('所属法案 ID'),
  step: ActStepSchema.describe('对应的法案步骤'),
  assigned_to: z.string().describe('被分派的部长角色名'),
});
export type ExecutionTask = z.infer<typeof ExecutionTaskSchema>;

export const TaskResultSchema = z.object({
  task_id: z.string().describe('任务 ID'),
  step_index: z.number().min(0).describe('步骤编号'),
  status: z.union([z.literal('success'), z.literal('failed'), z.literal('skipped')]).describe('执行状态'),
  output: z.string().default('').describe('执行输出'),
  tokens_consumed: z.number().min(0).default(0).describe('消耗 Token 数'),
  error: z.string().optional().describe('错误信息'),
});
export type TaskResult = z.infer<typeof TaskResultSchema>;

export const ExecutionReportSchema = z.object({
  act_id: z.string().describe('法案 ID'),
  overall_status: z.union([z.literal('completed'), z.literal('partial'), z.literal('failed')]).describe('整体执行状态'),
  task_results: z.array(TaskResultSchema).describe('各步骤执行结果'),
  total_tokens_consumed: z.number().min(0).describe('总 Token 消耗'),
  execution_time_seconds: z.number().min(0.0).describe('总执行时间（秒）'),
});
export type ExecutionReport = z.infer<typeof ExecutionReportSchema>;
