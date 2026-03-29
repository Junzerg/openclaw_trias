import { it, describe, expect } from 'vitest';
import { EventAction, EmotionType, DebateEventSchema } from '../src/schemas/events';
import { ActSchema } from '../src/schemas/act';
import { VerdictSchema, ViolationType } from '../src/schemas/verdict';
import { MessageType, AgentMessageSchema } from '../src/schemas/messages';

describe('Zod Schemas', () => {
  it('should parse DebateEvent correctly', () => {
    const data = {
      source_agent: 'Radical MP',
      action: EventAction.BRAWL,
      emotion: EmotionType.ANGRY,
      intensity: 0.8,
      round_number: 1,
      conflict_score: 85,
      statement: 'You are wrong!',
    };
    
    const parsed = DebateEventSchema.parse(data);
    expect(parsed.source_agent).toBe('Radical MP');
    expect(parsed.emotion).toBe(EmotionType.ANGRY);
    expect(parsed.intensity).toBe(0.8);
    expect(parsed.action).toBe(EventAction.BRAWL);
    // Defaults that are populated:
    expect(parsed.payload).toEqual({});
    expect(parsed.timestamp).toBeInstanceOf(Date);
  });

  it('should parse Act correctly', () => {
    const data = {
      act_id: 'act-123',
      title: 'Fix issue',
      summary: 'Fixing the bugs.',
      petition_origin: 'User needs fix.',
      steps: [
        {
          index: 0,
          description: 'Step 1',
          required_skill: 'CodeExecution',
          estimated_tokens: 1000,
          acceptance_criteria: 'Code passes tests',
        }
      ],
      total_estimated_tokens: 1000,
      debate_record: {
        total_rounds: 3,
        final_conflict_score: 20,
      },
      vote_record: {
        ayes: 2,
        nays: 0,
        result: 'passed',
      }
    };

    const parsed = ActSchema.parse(data);
    expect(parsed.act_id).toBe('act-123');
    expect(parsed.steps[0].tool_parameters).toEqual({});
    expect(parsed.steps[0].dependencies).toEqual([]);
    expect(parsed.debate_record.consensus_points).toEqual([]);
  });

  it('should parse Verdict correctly', () => {
    const data = {
      verdict_id: 'vd-456',
      act_id: 'act-123',
      constitutional: false,
      ruling: 'Did not follow instructions.',
      violation_type: ViolationType.DEVIATION_EXCEEDED,
    };
    
    const parsed = VerdictSchema.parse(data);
    expect(parsed.verdict_id).toBe('vd-456');
    expect(parsed.constitutional).toBe(false);
    expect(parsed.evidence).toEqual([]);
  });

  it('should parse AgentMessage correctly', () => {
    const data = {
      sender: 'President',
      content: 'I approve this act.',
      message_type: MessageType.ACT,
    };

    const parsed = AgentMessageSchema.parse(data);
    expect(parsed.sender).toBe('President');
    expect(parsed.message_id).toBeDefined();
    expect(parsed.timestamp).toBeInstanceOf(Date);
  });
});
