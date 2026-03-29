import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CyberGovernment } from '../src/government';
import { BillState } from '../src/bus/state-machine';
import { randomUUID } from 'node:crypto';
import { resolve } from 'path';

// Load config from project root
const configDir = resolve(__dirname, '../../config');

describe('CyberGovernment Orchestrator', () => {
  let gov: CyberGovernment;

  beforeEach(() => {
    gov = new CyberGovernment(configDir);
    // Suppress console logs during tests to keep output clean
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should run a successful pipeline (PETITION -> DELIVERED) with no vetoes', async () => {
    // 1. Mock Speaker debate to pass instantly
    vi.spyOn(gov.speaker, 'moderateDebate').mockResolvedValue({
      final_proposal: "Implement a TODO app",
      debates: []
    } as any);
    
    // Mock speaker.callVote to pass
    vi.spyOn(gov.speaker, 'callVote').mockResolvedValue({
      proposal: "Implement a TODO app",
      records: [],
      ayes: 2,
      nays: 0,
      passed: true
    } as any);

    // Mock Speaker generateAct
    vi.spyOn(gov.speaker, 'generateAct').mockResolvedValue({
      act_id: randomUUID(),
      title: "TODO App Act",
      summary: "Implement a TODO App",
      steps: [],
      total_estimated_tokens: 100
    } as any);

    // 2. Mock President evaluateAct to sign (return null)
    vi.spyOn(gov.president, 'evaluateAct').mockResolvedValue(null);

    // 3. Mock ExecutionEngine to return a success report
    vi.spyOn(gov.executionEngine, 'executeAct').mockResolvedValue({
      act_id: randomUUID(),
      overall_status: 'completed',
      task_results: [],
      total_tokens_consumed: 100,
      execution_time_seconds: 10
    } as any);

    // 4. Mock ChiefJustice reviewResult to return constitutional true
    vi.spyOn(gov.chiefJustice, 'reviewResult').mockResolvedValue({
      verdict_id: randomUUID(),
      act_id: randomUUID(),
      constitutional: true,
      ruling: "All looks good"
    } as any);

    // Also just let issueJudgment return a mock event
    vi.spyOn(gov.chiefJustice, 'issueJudgment').mockResolvedValue({
      payload: {}
    } as any);

    const petition = "I want a TODO app";
    const result = await gov.receivePetition(petition);
    
    expect(result).toContain("已交付");
    expect(result).toContain("All looks good");
  });

  it('should handle President Veto and retry pipeline (PETITION -> VETOED -> DRAFTING)', async () => {
    // We want the logic to retry once, so we mock President to veto the first time, then sign the second time
    let attempt = 0;
    
    vi.spyOn(gov.speaker, 'moderateDebate').mockResolvedValue({ final_proposal: "Test", debates: [] } as any);
    vi.spyOn(gov.speaker, 'callVote').mockResolvedValue({ passed: true, proposal: "Test", records: [], ayes: 2, nays: 0 } as any);
    vi.spyOn(gov.speaker, 'generateAct').mockResolvedValue({ act_id: randomUUID(), title: "Test Act", steps: [], total_estimated_tokens: 100, summary: "" } as any);

    vi.spyOn(gov.president, 'evaluateAct').mockImplementation(async () => {
      attempt++;
      if (attempt === 1) {
        return { act_id: randomUUID(), reason: "Too risky", specific_issues: [], suggestion: "Fix it" };
      }
      return null; // Sign on second attempt
    });

    vi.spyOn(gov.executionEngine, 'executeAct').mockResolvedValue({ overall_status: 'completed', total_tokens_consumed: 100 } as any);
    vi.spyOn(gov.chiefJustice, 'reviewResult').mockResolvedValue({ constitutional: true, ruling: "OK" } as any);
    vi.spyOn(gov.chiefJustice, 'issueJudgment').mockResolvedValue({ payload: {} } as any);

    // maxRetries = 2
    const result = await gov.receivePetition("Test petition", 2);
    
    expect(attempt).toBe(2);
    expect(result).toContain("已交付");
  });

  it('should handle ChiefJustice Unconstitutional and retry pipeline', async () => {
    vi.spyOn(gov.speaker, 'moderateDebate').mockResolvedValue({ final_proposal: "Test", debates: [] } as any);
    vi.spyOn(gov.speaker, 'callVote').mockResolvedValue({ passed: true, proposal: "Test", records: [], ayes: 2, nays: 0 } as any);
    vi.spyOn(gov.speaker, 'generateAct').mockResolvedValue({ act_id: randomUUID(), title: "Test Act", steps: [], total_estimated_tokens: 100, summary: "" } as any);
    vi.spyOn(gov.president, 'evaluateAct').mockResolvedValue(null);
    vi.spyOn(gov.executionEngine, 'executeAct').mockResolvedValue({ overall_status: 'completed', total_tokens_consumed: 100 } as any);

    let attempt = 0;
    vi.spyOn(gov.chiefJustice, 'reviewResult').mockImplementation(async () => {
      attempt++;
      if (attempt === 1) {
        return { constitutional: false, ruling: "Bad design" } as any;
      }
      return { constitutional: true, ruling: "Good design" } as any;
    });
    vi.spyOn(gov.chiefJustice, 'issueJudgment').mockResolvedValue({ payload: {} } as any);

    const result = await gov.receivePetition("Test petition", 2);
    
    expect(attempt).toBe(2);
    expect(result).toContain("已交付");
    expect(result).toContain("Good design");
  });

  it('should exhaust maxRetries if vetoed repeatedly', async () => {
    vi.spyOn(gov.speaker, 'moderateDebate').mockResolvedValue({ final_proposal: "Test", debates: [] } as any);
    vi.spyOn(gov.speaker, 'callVote').mockResolvedValue({ passed: true, proposal: "Test", records: [], ayes: 2, nays: 0 } as any);
    vi.spyOn(gov.speaker, 'generateAct').mockResolvedValue({ act_id: randomUUID(), title: "Test Act", steps: [], total_estimated_tokens: 100, summary: "" } as any);

    // ALWAYS VETO
    vi.spyOn(gov.president, 'evaluateAct').mockResolvedValue({ act_id: randomUUID(), reason: "Too risky", specific_issues: [], suggestion: "" });

    const result = await gov.receivePetition("Test petition", 2);
    
    expect(result).toContain("次重试后仍未通过");
  });
});
