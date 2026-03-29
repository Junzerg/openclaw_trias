/**
 * SecretaryOfState — Single-Phase LLM Delegation Tests
 *
 * Task 3.5: Validates the Search/WebBrowser LLM delegation pipeline,
 * prompt construction, empty-response handling, error handling, and event emissions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecretaryOfState } from '../src/agents/executive/sec-state';
import { EventAction } from '../src/schemas/events';

// ─── Shared Fixtures ─────────────────────────────────────────────────────────

function createMockAdapter() {
  return {
    callLLM: vi.fn(),
  } as any;
}

function createMockBus() {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function makeTask(overrides: Record<string, any> = {}): any {
  return {
    task_id: 'task-sec-001',
    act_id: 'act-001',
    step: {
      index: 0,
      description: '搜索 TypeScript 最新版本信息',
      required_skill: 'Search',
      tool_parameters: {},
      estimated_tokens: 100,
      acceptance_criteria: '返回版本号',
      dependencies: [],
    },
    assigned_to: 'sec_state',
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SecretaryOfState — Single-Phase LLM Delegation (Task 3.5)', () => {
  let mockAdapter: ReturnType<typeof createMockAdapter>;
  let mockBus: ReturnType<typeof createMockBus>;
  let sec: SecretaryOfState;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter = createMockAdapter();
    mockBus = createMockBus();
    sec = new SecretaryOfState(mockAdapter, mockBus);
  });

  // ── _buildTaskPrompt unit tests ───────────────────────────────────────

  describe('_buildTaskPrompt', () => {
    const baseStep = {
      index: 0,
      description: '测试任务描述',
      required_skill: 'Search',
      tool_parameters: {},
      estimated_tokens: 50,
      acceptance_criteria: '',
      dependencies: [],
    };

    it('should build Search prompt with role, task description and 2000-char limit', () => {
      const prompt = sec._buildTaskPrompt({ ...baseStep, required_skill: 'Search' });
      expect(prompt).toContain('国务卿');
      expect(prompt).toContain('搜索工具');
      expect(prompt).toContain('测试任务描述');
      expect(prompt).toContain('2000');
    });

    it('should build WebBrowser prompt with role and browser instructions', () => {
      const prompt = sec._buildTaskPrompt({ ...baseStep, required_skill: 'WebBrowser' });
      expect(prompt).toContain('国务卿');
      expect(prompt).toContain('浏览器工具');
      expect(prompt).toContain('测试任务描述');
    });

    it('should build default prompt for unknown skill', () => {
      const prompt = sec._buildTaskPrompt({ ...baseStep, required_skill: 'UnknownSkill' });
      expect(prompt).toContain('测试任务描述');
      expect(prompt).not.toContain('国务卿');
    });
  });

  // ── executeTask — Happy Path ──────────────────────────────────────────

  describe('executeTask — Happy Path', () => {
    it('should call callLLM and return success for Search task', async () => {
      mockAdapter.callLLM.mockResolvedValueOnce({
        content: 'TypeScript 5.7 是最新版本，包含装饰器改进...',
        rawOutput: '',
      });

      const result = await sec.executeTask(makeTask());

      expect(result.status).toBe('success');
      expect(result.output).toContain('TypeScript 5.7');
      expect(result.error).toBeUndefined();
      expect(result.task_id).toBe('task-sec-001');
      expect(result.step_index).toBe(0);
      expect(result.tokens_consumed).toBe(100);

      expect(mockAdapter.callLLM).toHaveBeenCalledTimes(1);
      // Verify prompt includes Search-specific content
      const callArgs = mockAdapter.callLLM.mock.calls[0];
      expect(callArgs[1]).toContain('搜索工具');
    });

    it('should pass modelRef to adapter.callLLM when set', async () => {
      sec.modelRef = 'anthropic/claude-opus-4-20250514';

      mockAdapter.callLLM.mockResolvedValueOnce({
        content: '搜索结果...',
        rawOutput: '',
      });

      await sec.executeTask(makeTask());

      // adapter.callLLM receives (systemPrompt, userPrompt, modelRef)
      expect(mockAdapter.callLLM).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('搜索工具'),
        'anthropic/claude-opus-4-20250514',
      );
    });

    it('should call callLLM and return success for WebBrowser task', async () => {
      mockAdapter.callLLM.mockResolvedValueOnce({
        content: '页面内容：React 19 发布公告...',
        rawOutput: '',
      });

      const task = makeTask({
        step: {
          index: 1,
          description: '浏览 React 官方发布页面',
          required_skill: 'WebBrowser',
          tool_parameters: {},
          estimated_tokens: 80,
          acceptance_criteria: '提取发布信息',
          dependencies: [],
        },
      });

      const result = await sec.executeTask(task);

      expect(result.status).toBe('success');
      expect(result.output).toContain('React 19');
      expect(result.step_index).toBe(1);
      expect(result.tokens_consumed).toBe(80);

      // Verify prompt includes WebBrowser-specific content
      const callArgs = mockAdapter.callLLM.mock.calls[0];
      expect(callArgs[1]).toContain('浏览器工具');
    });
  });

  // ── executeTask — Empty Response ──────────────────────────────────────

  describe('executeTask — Empty LLM Response', () => {
    it('should return failed when LLM returns empty string', async () => {
      mockAdapter.callLLM.mockResolvedValueOnce({
        content: '',
        rawOutput: '',
      });

      const result = await sec.executeTask(makeTask());

      expect(result.status).toBe('failed');
      expect(result.error).toBe('LLM returned empty response');
      expect(result.output).toBe('');
      expect(result.tokens_consumed).toBe(0);
    });

    it('should return failed when LLM returns whitespace-only content', async () => {
      mockAdapter.callLLM.mockResolvedValueOnce({
        content: '   \n\t  ',
        rawOutput: '',
      });

      const result = await sec.executeTask(makeTask());

      expect(result.status).toBe('failed');
      expect(result.error).toBe('LLM returned empty response');
    });
  });

  // ── executeTask — Exception Handling ──────────────────────────────────

  describe('executeTask — Exception handling (never blocks Pipeline)', () => {
    it('should return failed TaskResult when callLLM throws', async () => {
      mockAdapter.callLLM.mockRejectedValueOnce(new Error('Search API timeout'));

      const result = await sec.executeTask(makeTask());

      expect(result.status).toBe('failed');
      expect(result.error).toContain('Search API timeout');
      expect(result.output).toBe('');
      expect(result.tokens_consumed).toBe(0);
    });

    it('should handle non-Error throw (string throw)', async () => {
      mockAdapter.callLLM.mockRejectedValueOnce('network disconnected');

      const result = await sec.executeTask(makeTask());

      expect(result.status).toBe('failed');
      expect(result.error).toBe('network disconnected');
    });
  });

  // ── Event emission tests ────────────────────────────────────────────

  describe('Event emissions', () => {
    it('should emit running then success on successful LLM call', async () => {
      const emitSpy = vi.spyOn(sec, 'emitEvent');

      mockAdapter.callLLM.mockResolvedValueOnce({
        content: '搜索结果摘要...',
        rawOutput: '',
      });

      await sec.executeTask(makeTask({ task_id: 'task-ev-1' }));

      expect(emitSpy).toHaveBeenCalledTimes(2);
      expect(emitSpy).toHaveBeenNthCalledWith(1,
        EventAction.TOOL_CALL,
        expect.objectContaining({ status: 'running', step_index: 0 }),
        undefined,
        'task-ev-1',
      );
      expect(emitSpy).toHaveBeenNthCalledWith(2,
        EventAction.TOOL_CALL,
        expect.objectContaining({ status: 'success', step_index: 0 }),
        undefined,
        'task-ev-1',
      );
    });

    it('should emit running then failed on empty LLM response', async () => {
      const emitSpy = vi.spyOn(sec, 'emitEvent');

      mockAdapter.callLLM.mockResolvedValueOnce({
        content: '',
        rawOutput: '',
      });

      await sec.executeTask(makeTask({ task_id: 'task-ev-2' }));

      expect(emitSpy).toHaveBeenCalledTimes(2);
      expect(emitSpy).toHaveBeenNthCalledWith(1,
        EventAction.TOOL_CALL,
        expect.objectContaining({ status: 'running' }),
        undefined,
        'task-ev-2',
      );
      expect(emitSpy).toHaveBeenNthCalledWith(2,
        EventAction.TOOL_CALL,
        expect.objectContaining({ status: 'failed', error: 'LLM returned empty response' }),
        undefined,
        'task-ev-2',
      );
    });

    it('should emit running then failed when callLLM throws exception', async () => {
      const emitSpy = vi.spyOn(sec, 'emitEvent');

      mockAdapter.callLLM.mockRejectedValueOnce(new Error('boom'));

      await sec.executeTask(makeTask({ task_id: 'task-ev-3' }));

      expect(emitSpy).toHaveBeenCalledTimes(2);
      expect(emitSpy).toHaveBeenNthCalledWith(1,
        EventAction.TOOL_CALL,
        expect.objectContaining({ status: 'running' }),
        undefined,
        'task-ev-3',
      );
      expect(emitSpy).toHaveBeenNthCalledWith(2,
        EventAction.TOOL_CALL,
        expect.objectContaining({ status: 'failed', error: 'boom' }),
        undefined,
        'task-ev-3',
      );
    });

    it('should include correct tool_name in emitted events', async () => {
      const emitSpy = vi.spyOn(sec, 'emitEvent');

      mockAdapter.callLLM.mockResolvedValueOnce({
        content: '结果...',
        rawOutput: '',
      });

      const task = makeTask({
        task_id: 'task-ev-4',
        step: {
          index: 2,
          description: '浏览页面',
          required_skill: 'WebBrowser',
          tool_parameters: {},
          estimated_tokens: 60,
          acceptance_criteria: '',
          dependencies: [],
        },
      });

      await sec.executeTask(task);

      expect(emitSpy).toHaveBeenNthCalledWith(1,
        EventAction.TOOL_CALL,
        expect.objectContaining({ tool_name: 'WebBrowser', step_index: 2 }),
        undefined,
        'task-ev-4',
      );
      expect(emitSpy).toHaveBeenNthCalledWith(2,
        EventAction.TOOL_CALL,
        expect.objectContaining({ tool_name: 'WebBrowser', step_index: 2 }),
        undefined,
        'task-ev-4',
      );
    });
  });

  // ── Tool check & permission guard ──────────────────────────────────

  describe('Guards', () => {
    it('should throw when required_skill is not in available tools', async () => {
      const task = makeTask();
      task.step.required_skill = 'UnknownTool';

      await expect(sec.executeTask(task)).rejects.toThrow('无法使用工具');
    });
  });

  // ── act() routing ─────────────────────────────────────────────────────

  describe('act()', () => {
    it('should route valid ExecutionTask to executeTask', async () => {
      mockAdapter.callLLM.mockResolvedValueOnce({
        content: '搜索结果...',
        rawOutput: '',
      });

      const result = await sec.act(makeTask()) as any;

      expect(result.status).toBe('success');
      expect(mockAdapter.callLLM).toHaveBeenCalledTimes(1);
    });

    it('should throw TypeError for invalid message', async () => {
      await expect(sec.act({ invalid: true })).rejects.toThrow(TypeError);
    });
  });
});
