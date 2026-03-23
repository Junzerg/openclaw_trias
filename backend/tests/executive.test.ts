import { describe, it, expect, vi, beforeEach } from 'vitest';
import { President } from '../src/agents/executive/president';
import { SecretaryOfEngineering } from '../src/agents/executive/sec-engineering';
import { SecretaryOfState } from '../src/agents/executive/sec-state';
import { ExecutionEngine } from '../src/agents/executive/engine';
import { Act, ActStep } from '../src/schemas/act';
import { EventAction } from '../src/schemas/events';

describe('Executive Branch Task 1.6', () => {

  const mockAdapter = {
    callLLM: vi.fn(),
  } as any;

  const mockBus = {
    publish: vi.fn().mockResolvedValue(undefined),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Kahn Topological Sort & Task Execution Pipeline', () => {
    // 5 mock nodes:
    // 0: A (independent) -> depends on [] -> Level 0
    // 1: B (independent) -> depends on [] -> Level 0
    // 2: C -> depends on [0] (A) -> Level 1
    // 3: D -> depends on [0, 1] (A, B) -> Level 1
    // 4: E -> depends on [2, 3] (C, D) -> Level 2
    const complexSteps: ActStep[] = [
      {
        index: 0, description: 'Task A', required_skill: 'CodeExecution',
        tool_parameters: {}, estimated_tokens: 10, acceptance_criteria: '', dependencies: []
      },
      {
        index: 1, description: 'Task B', required_skill: 'Search',
        tool_parameters: {}, estimated_tokens: 15, acceptance_criteria: '', dependencies: []
      },
      {
        index: 2, description: 'Task C', required_skill: 'CodeExecution',
        tool_parameters: {}, estimated_tokens: 20, acceptance_criteria: '', dependencies: [0]
      },
      {
        index: 3, description: 'Task D', required_skill: 'Search',
        tool_parameters: {}, estimated_tokens: 5, acceptance_criteria: '', dependencies: [0, 1]
      },
      {
        index: 4, description: 'Task E', required_skill: 'CodeExecution',
        tool_parameters: {}, estimated_tokens: 10, acceptance_criteria: '', dependencies: [2, 3]
      }
    ];

    it('should resolve correct layers using Kahn algorithm', () => {
      const engine = new ExecutionEngine({});
      // testing private method via any
      const levels = (engine as any)._topologicalSort(complexSteps);
      
      expect(levels.length).toBe(3);
      expect(levels[0].map((s: any) => s.index).sort()).toEqual([0, 1]);
      expect(levels[1].map((s: any) => s.index).sort()).toEqual([2, 3]);
      expect(levels[2].map((s: any) => s.index).sort()).toEqual([4]);
    });

    it('should throw an error if cyclic dependency is detected', () => {
      const engine = new ExecutionEngine({});
      const cyclicSteps: ActStep[] = [
        { index: 0, description: 'Task A', required_skill: 'CodeExecution', tool_parameters: {}, estimated_tokens: 10, acceptance_criteria: '', dependencies: [1] },
        { index: 1, description: 'Task B', required_skill: 'CodeExecution', tool_parameters: {}, estimated_tokens: 10, acceptance_criteria: '', dependencies: [0] }
      ];
      expect(() => {
        (engine as any)._topologicalSort(cyclicSteps);
      }).toThrowError('检测到循环依赖');
    });

    it('should summarize an execution report using mock executors', async () => {
      const secEng = new SecretaryOfEngineering(mockAdapter, mockBus);
      const secState = new SecretaryOfState(mockAdapter, mockBus);

      const cabinet = {
        'CodeExecution': secEng,
        'Search': secState,
      };

      const engine = new ExecutionEngine(cabinet);
      const act: Act = {
        act_id: 'test-act-001',
        title: 'Test Act',
        summary: '',
        petition_origin: '',
        total_estimated_tokens: 60,
        steps: complexSteps,
        debate_record: { total_rounds: 0, final_conflict_score: 0, consensus_points: [], remaining_concerns: [] },
        vote_record: { ayes: 10, nays: 0, result: 'passed', voter_positions: {} },
        created_at: new Date()
      };

      const report = await engine.executeAct(act);
      expect(report.overall_status).toBe('completed');
      expect(report.task_results.length).toBe(5);
      expect(report.total_tokens_consumed).toBe(60);
      
      const engSuccesses = report.task_results.filter(r => r.status === 'success');
      expect(engSuccesses.length).toBe(5);
    });

    it('should propagate Failures to downstream tasks marking them as Skipped', async () => {
      const secEng = new SecretaryOfEngineering(mockAdapter, mockBus);
      const secState = new SecretaryOfState(mockAdapter, mockBus);
      
      vi.spyOn(secEng, 'executeTask').mockImplementation(async (task) => {
        if (task.step.index === 0) {
          return {
            task_id: task.task_id,
            step_index: task.step.index,
            status: 'failed',
            error: 'Failed to build table',
            tokens_consumed: 0,
            output: ''
          };
        }
        return {
          task_id: task.task_id,
          step_index: task.step.index,
          status: 'success',
          output: 'ok',
          tokens_consumed: 10,
        };
      });

      vi.spyOn(secState, 'executeTask').mockImplementation(async (task) => {
        return {
          task_id: task.task_id,
          step_index: task.step.index,
          status: 'success',
          output: 'ok',
          tokens_consumed: 15,
        };
      });

      const cabinet = {
        'CodeExecution': secEng,
        'Search': secState,
      };

      const act: Act = {
        act_id: 'test-act-fail',
        title: 'Fail Act',
        summary: '',
        petition_origin: '',
        total_estimated_tokens: 60,
        steps: complexSteps,
        debate_record: { total_rounds: 0, final_conflict_score: 0, consensus_points: [], remaining_concerns: [] },
        vote_record: { ayes: 10, nays: 0, result: 'passed', voter_positions: {} },
        created_at: new Date()
      };

      const engine = new ExecutionEngine(cabinet);
      const report = await engine.executeAct(act);

      expect(report.overall_status).toBe('partial');
      
      const r0 = report.task_results.find(r => r.step_index === 0);
      expect(r0!.status).toBe('failed');

      const r1 = report.task_results.find(r => r.step_index === 1);
      expect(r1!.status).toBe('success');

      const r2 = report.task_results.find(r => r.step_index === 2);
      expect(r2!.status).toBe('skipped');
      const r3 = report.task_results.find(r => r.step_index === 3);
      expect(r3!.status).toBe('skipped');

      const r4 = report.task_results.find(r => r.step_index === 4);
      expect(r4!.status).toBe('skipped');
    });
  });

  describe('President & Secretary event emissions', () => {
    it('President should call LLM and emit SIGN_ACT when approved', async () => {
      const president = new President(mockAdapter, mockBus);

      mockAdapter.callLLM.mockResolvedValueOnce({ content: '[SIGN]', tokens: 10 });

      const emitSpy = vi.spyOn(president, 'emitEvent');

      const act: Act = {
        act_id: 'act-111', title: 'A Good Act', summary: '', petition_origin: '',
        total_estimated_tokens: 1000, 
        steps: [
          { index: 0, description: '', required_skill: 'CodeExecution', tool_parameters: {}, estimated_tokens: 100, acceptance_criteria: '', dependencies: [] }
        ],
        debate_record: {} as any, vote_record: {} as any, created_at: new Date()
      };

      const vetoResult = await president.evaluateAct(act);
      expect(vetoResult).toBeNull();

      expect(emitSpy).toHaveBeenCalledWith(
        EventAction.SIGN_ACT,
        expect.objectContaining({ act_id: 'act-111' }),
        undefined,
        'act-111'
      );
    });

    it('President should emit VETO if LLM decides to veto', async () => {
      const president = new President(mockAdapter, mockBus);

      mockAdapter.callLLM.mockResolvedValueOnce({ content: '[VETO: Too dangerous]', tokens: 10 });

      const emitSpy = vi.spyOn(president, 'emitEvent');

      const act: Act = {
        act_id: 'act-112', title: 'A Bad Act', summary: '', petition_origin: '',
        total_estimated_tokens: 1000, 
        steps: [
          { index: 0, description: '', required_skill: 'CodeExecution', tool_parameters: {}, estimated_tokens: 100, acceptance_criteria: '', dependencies: [] }
        ],
        debate_record: {} as any, vote_record: {} as any, created_at: new Date()
      };

      const vetoResult = await president.evaluateAct(act);
      expect(vetoResult).not.toBeNull();
      expect(vetoResult!.specific_issues[0]).toContain('Too dangerous');

      expect(emitSpy).toHaveBeenCalledWith(
        EventAction.VETO,
        expect.objectContaining({ veto_notice: vetoResult }),
        undefined,
        'act-112'
      );
    });

    it('President should VETO immediately when act contains a non-whitelisted required_skill (Skill Unavailable)', async () => {
      const president = new President(mockAdapter, mockBus);

      // LLM should NOT even be called — the skill check is a code-level pre-filter
      const emitSpy = vi.spyOn(president, 'emitEvent');

      const act: Act = {
        act_id: 'act-veto-skill', title: 'Doomsday Act', summary: '', petition_origin: '',
        total_estimated_tokens: 1000,
        steps: [
          { index: 0, description: '使用末日量子武器消灭黑客', required_skill: 'Doomsday_Quantum_Weapon', tool_parameters: {}, estimated_tokens: 100, acceptance_criteria: '', dependencies: [] }
        ],
        debate_record: {} as any, vote_record: {} as any, created_at: new Date()
      };

      const vetoResult = await president.evaluateAct(act);

      // Must VETO — the skill is not in the whitelist
      expect(vetoResult).not.toBeNull();
      expect(vetoResult!.specific_issues.length).toBeGreaterThan(0);
      expect(vetoResult!.specific_issues[0]).toContain("Doomsday_Quantum_Weapon");
      expect(vetoResult!.specific_issues[0]).toContain("不可用");

      // LLM should NOT have been called — the issue was caught at code level
      expect(mockAdapter.callLLM).not.toHaveBeenCalled();

      // VETO event should have been emitted
      expect(emitSpy).toHaveBeenCalledWith(
        EventAction.VETO,
        expect.objectContaining({ veto_notice: vetoResult }),
        undefined,
        'act-veto-skill'
      );
    });

    it('SecretaryOfEngineering should emit TOOL_CALL running and success', async () => {
      const sec = new SecretaryOfEngineering(mockAdapter, mockBus);
      const emitSpy = vi.spyOn(sec, 'emitEvent');

      const task: any = {
        task_id: 'task-10', act_id: 'act-xx',
        step: { index: 0, description: 'desc', required_skill: 'CodeExecution', tool_parameters: {}, estimated_tokens: 10, acceptance_criteria: '', dependencies: [] },
        assigned_to: 'sec_engineering'
      };

      const res = await sec.executeTask(task);
      expect(res.status).toBe('success');

      expect(emitSpy).toHaveBeenCalledWith(
        EventAction.TOOL_CALL,
        expect.objectContaining({ status: 'running', step_index: 0, tool_name: 'CodeExecution' }),
        undefined,
        'task-10'
      );

      expect(emitSpy).toHaveBeenCalledWith(
        EventAction.TOOL_CALL,
        expect.objectContaining({ status: 'success', step_index: 0, tool_name: 'CodeExecution' }),
        undefined,
        'task-10'
      );
    });
  });

});
