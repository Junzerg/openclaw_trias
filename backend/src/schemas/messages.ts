import { z } from 'zod';
import { randomUUID } from 'node:crypto';

export enum MessageType {
  PETITION = 'petition',
  PROPOSAL = 'proposal',
  CRITIQUE = 'critique',
  REBUTTAL = 'rebuttal',
  VOTE = 'vote',
  ACT = 'act',
  VETO_NOTICE = 'veto_notice',
  EXECUTION_RESULT = 'execution_result',
  JUDGMENT = 'judgment',
  SYSTEM = 'system',
}

export const AgentMessageSchema = z.object({
  sender: z.string(),
  receiver: z.string().nullish().describe('接收方 Agent 角色名（null 表示广播）'),
  content: z.string(),
  message_type: z.nativeEnum(MessageType),
  message_id: z.string().uuid().default(() => randomUUID()),
  metadata: z.record(z.string(), z.any()).default({}),
  timestamp: z.date().default(() => new Date()),
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;
