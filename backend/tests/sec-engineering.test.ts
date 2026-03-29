/**
 * SecretaryOfEngineering — Two-Phase Execution Tests
 *
 * Task 3.4: Validates the complete code-generation → code-execution pipeline,
 * JSON extraction, fallback logic, error handling, and event emissions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecretaryOfEngineering } from '../src/agents/executive/sec-engineering';
import { EventAction } from '../src/schemas/events';

// ─── Shared Fixtures ─────────────────────────────────────────────────────────

function createMockAdapter() {
  return {
    callLLM: vi.fn(),
    executeCode: vi.fn(),
  } as any;
}

function createMockBus() {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function makeTask(overrides: Record<string, any> = {}): any {
  return {
    task_id: 'task-001',
    act_id: 'act-001',
    step: {
      index: 0,
      description: '用 Python 编写 hello world',
      required_skill: 'CodeExecution',
      tool_parameters: {},
      estimated_tokens: 50,
      acceptance_criteria: 'stdout 包含 hello',
      dependencies: [],
    },
    assigned_to: 'sec_engineering',
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SecretaryOfEngineering — Two-Phase Execution (Task 3.4)', () => {
  let mockAdapter: ReturnType<typeof createMockAdapter>;
  let mockBus: ReturnType<typeof createMockBus>;
  let sec: SecretaryOfEngineering;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter = createMockAdapter();
    mockBus = createMockBus();
    sec = new SecretaryOfEngineering(mockAdapter, mockBus);
  });

  // ── _extractCodeFromLLM unit tests ──────────────────────────────────────

  describe('_extractCodeFromLLM', () => {
    it('should parse clean JSON with language and code', () => {
      const result = sec._extractCodeFromLLM('{"language":"python","code":"print(1)"}');
      expect(result).toEqual({ language: 'python', code: 'print(1)', valid: true });
    });

    it('should extract JSON embedded in Markdown fences', () => {
      const content = '```json\n{"language":"javascript","code":"console.log(42)"}\n```';
      const result = sec._extractCodeFromLLM(content);
      expect(result).toEqual({ language: 'javascript', code: 'console.log(42)', valid: true });
    });

    it('should extract JSON with surrounding text', () => {
      const content = 'Here is the code:\n{"language":"bash","code":"echo hi"}\nDone.';
      const result = sec._extractCodeFromLLM(content);
      expect(result).toEqual({ language: 'bash', code: 'echo hi', valid: true });
    });

    it('should fallback unsupported language to python', () => {
      const result = sec._extractCodeFromLLM('{"language":"rust","code":"fn main(){}"}');
      expect(result).toEqual({ language: 'python', code: 'fn main(){}', valid: true });
    });

    it('should fallback to python code when JSON has no code field', () => {
      const result = sec._extractCodeFromLLM('{"language":"python"}');
      expect(result).toEqual({ language: 'python', code: '{"language":"python"}', valid: false });
    });

    it('should fallback entire content as python when no JSON found', () => {
      const content = 'print("hello world")';
      const result = sec._extractCodeFromLLM(content);
      expect(result).toEqual({ language: 'python', code: 'print("hello world")', valid: false });
    });

    it('should fallback when JSON is malformed', () => {
      const content = '{ broken json !!!';
      const result = sec._extractCodeFromLLM(content);
      expect(result).toEqual({ language: 'python', code: '{ broken json !!!', valid: false });
    });

    it('should handle code containing nested braces (greedy regex edge case)', () => {
      // The regex /\{[\s\S]*\}/ is greedy — if code contains {}, it may grab too much
      // But JSON.parse should still work for well-formed JSON
      const content = JSON.stringify({ language: 'python', code: "x = {'a': 1}" });
      const result = sec._extractCodeFromLLM(content);
      expect(result.language).toBe('python');
      expect(result.code).toBe("x = {'a': 1}");
    });
  });

  // ── Two-phase executeTask tests ─────────────────────────────────────────

  describe('executeTask — Happy Path', () => {
    it('should call callLLM then executeCode and return success', async () => {
      // Phase 1: callLLM returns code-gen JSON
      mockAdapter.callLLM.mockResolvedValueOnce({
        content: '{"language":"python","code":"print(\'hello world\')"}',
        rawOutput: '',
      });
      // Phase 2: executeCode returns success
      mockAdapter.executeCode.mockResolvedValueOnce({
        stdout: 'hello world\n',
        stderr: '',
        exitCode: 0,
        rawOutput: '',
      });

      const result = await sec.executeTask(makeTask());

      expect(result.status).toBe('success');
      expect(result.output).toContain('hello world');
      expect(result.error).toBeUndefined();
      expect(result.task_id).toBe('task-001');
      expect(result.step_index).toBe(0);
      expect(result.tokens_consumed).toBe(50);

      // Verify callLLM was called (Phase 1)
      expect(mockAdapter.callLLM).toHaveBeenCalledTimes(1);
      // Verify executeCode was called with extracted code (Phase 2)
      expect(mockAdapter.executeCode).toHaveBeenCalledTimes(1);
      expect(mockAdapter.executeCode).toHaveBeenCalledWith(
        "print('hello world')",
        'python',
        undefined, // modelRef not set on this instance
      );
    });

    it('should pass modelRef to executeCode when set', async () => {
      sec.modelRef = 'anthropic/claude-opus-4-20250514';

      mockAdapter.callLLM.mockResolvedValueOnce({
        content: '{"language":"python","code":"print(1)"}',
        rawOutput: '',
      });
      mockAdapter.executeCode.mockResolvedValueOnce({
        stdout: '1\n', stderr: '', exitCode: 0, rawOutput: '',
      });

      await sec.executeTask(makeTask());

      expect(mockAdapter.executeCode).toHaveBeenCalledWith(
        'print(1)',
        'python',
        'anthropic/claude-opus-4-20250514',
      );
    });
  });

  describe('executeTask — exitCode !== 0', () => {
    it('should return failed TaskResult with stderr on non-zero exitCode', async () => {
      mockAdapter.callLLM.mockResolvedValueOnce({
        content: '{"language":"python","code":"1/0"}',
        rawOutput: '',
      });
      mockAdapter.executeCode.mockResolvedValueOnce({
        stdout: '',
        stderr: 'ZeroDivisionError: division by zero',
        exitCode: 1,
        rawOutput: '',
      });

      const result = await sec.executeTask(makeTask());

      expect(result.status).toBe('failed');
      expect(result.error).toContain('ZeroDivisionError');
      // Bug #3 fix: failed output prioritizes stderr
      expect(result.output).toContain('ZeroDivisionError');
    });

    it('should fall back to stdout in error field when stderr is empty on failure', async () => {
      mockAdapter.callLLM.mockResolvedValueOnce({
        content: JSON.stringify({ language: 'python', code: 'exit(1)' }),
        rawOutput: '',
      });
      mockAdapter.executeCode.mockResolvedValueOnce({
        stdout: 'partial output before crash',
        stderr: '',
        exitCode: 1,
        rawOutput: '',
      });

      const result = await sec.executeTask(makeTask());

      expect(result.status).toBe('failed');
      // When stderr is empty, error should contain stdout
      expect(result.error).toContain('partial output before crash');
      expect(result.output).toContain('partial output before crash');
    });
  });

  describe('executeTask — Fallback on malformed LLM output', () => {
    it('should fallback to python when LLM returns non-JSON', async () => {
      // LLM returns raw code instead of JSON
      mockAdapter.callLLM.mockResolvedValueOnce({
        content: 'print("fallback hello")',
        rawOutput: '',
      });
      // executeCode should receive the raw code as python
      mockAdapter.executeCode.mockResolvedValueOnce({
        stdout: 'fallback hello\n',
        stderr: '',
        exitCode: 0,
        rawOutput: '',
      });

      const result = await sec.executeTask(makeTask());

      expect(result.status).toBe('success');
      expect(result.output).toContain('fallback hello');

      // Verify executeCode was called with fallback language 'python'
      expect(mockAdapter.executeCode).toHaveBeenCalledWith(
        'print("fallback hello")',
        'python',
        undefined,
      );
    });

    it('should retry once when first LLM response is not valid JSON, then succeed', async () => {
      // First call: LLM returns garbage
      mockAdapter.callLLM
        .mockResolvedValueOnce({ content: 'I cannot generate code right now', rawOutput: '' })
        // Second call (retry): LLM returns valid JSON
        .mockResolvedValueOnce({ content: JSON.stringify({ language: 'python', code: 'print(42)' }), rawOutput: '' });
      mockAdapter.executeCode.mockResolvedValueOnce({
        stdout: '42\n', stderr: '', exitCode: 0, rawOutput: '',
      });

      const result = await sec.executeTask(makeTask());

      expect(result.status).toBe('success');
      expect(result.output).toContain('42');
      // callLLM should have been called twice (initial + retry)
      expect(mockAdapter.callLLM).toHaveBeenCalledTimes(2);
    });

    it('should fallback to Python when both LLM attempts fail to produce valid JSON', async () => {
      // Both calls return non-JSON
      mockAdapter.callLLM
        .mockResolvedValueOnce({ content: 'print("fallback")', rawOutput: '' })
        .mockResolvedValueOnce({ content: 'still not json', rawOutput: '' });
      mockAdapter.executeCode.mockResolvedValueOnce({
        stdout: 'fallback\n', stderr: '', exitCode: 0, rawOutput: '',
      });

      const result = await sec.executeTask(makeTask());

      expect(result.status).toBe('success');
      // Should have used the first response as fallback Python code
      expect(mockAdapter.executeCode).toHaveBeenCalledWith(
        'print("fallback")',
        'python',
        undefined,
      );
      expect(mockAdapter.callLLM).toHaveBeenCalledTimes(2);
    });
  });

  describe('executeTask — Edge cases', () => {
    it('should return empty string output when both stdout and stderr are empty', async () => {
      mockAdapter.callLLM.mockResolvedValueOnce({
        content: JSON.stringify({ language: 'python', code: 'pass' }),
        rawOutput: '',
      });
      mockAdapter.executeCode.mockResolvedValueOnce({
        stdout: '', stderr: '', exitCode: 0, rawOutput: '',
      });

      const result = await sec.executeTask(makeTask());

      expect(result.status).toBe('success');
      expect(result.output).toContain('[Generated python Code]:\npass');
      expect(result.output.endsWith('[Execution Output]:\n')).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('executeTask — Exception handling (never blocks Pipeline)', () => {
    it('should return failed TaskResult when callLLM throws', async () => {
      mockAdapter.callLLM.mockRejectedValueOnce(new Error('LLM gateway timeout'));

      const result = await sec.executeTask(makeTask());

      expect(result.status).toBe('failed');
      expect(result.error).toContain('LLM gateway timeout');
      expect(result.output).toBe('');
      expect(result.tokens_consumed).toBe(0);

      // executeCode should NOT have been called
      expect(mockAdapter.executeCode).not.toHaveBeenCalled();
    });

    it('should return failed TaskResult when executeCode throws', async () => {
      mockAdapter.callLLM.mockResolvedValueOnce({
        content: '{"language":"python","code":"print(1)"}',
        rawOutput: '',
      });
      mockAdapter.executeCode.mockRejectedValueOnce(new Error('Sandbox execution timeout'));

      const result = await sec.executeTask(makeTask());

      expect(result.status).toBe('failed');
      expect(result.error).toContain('Sandbox execution timeout');
    });

    it('should handle non-Error throw (string throw)', async () => {
      mockAdapter.callLLM.mockResolvedValueOnce({
        content: JSON.stringify({ language: 'python', code: 'print(1)' }),
        rawOutput: '',
      });
      // Simulate a non-Error throw (e.g., a string is thrown)
      mockAdapter.executeCode.mockRejectedValueOnce('raw string error');

      const result = await sec.executeTask(makeTask());

      expect(result.status).toBe('failed');
      // err.message is undefined for non-Error, String(err) should be used
      expect(result.error).toBe('raw string error');
    });
  });

  // ── Event emission tests ────────────────────────────────────────────────

  describe('Event emissions', () => {
    it('should emit running then success on successful execution', async () => {
      const emitSpy = vi.spyOn(sec, 'emitEvent');

      mockAdapter.callLLM.mockResolvedValueOnce({
        content: '{"language":"python","code":"print(1)"}',
        rawOutput: '',
      });
      mockAdapter.executeCode.mockResolvedValueOnce({
        stdout: '1\n', stderr: '', exitCode: 0, rawOutput: '',
      });

      await sec.executeTask(makeTask({ task_id: 'task-ev-1', act_id: 'task-ev-1' }));

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

    it('should emit running then failed on exitCode !== 0', async () => {
      const emitSpy = vi.spyOn(sec, 'emitEvent');

      mockAdapter.callLLM.mockResolvedValueOnce({
        content: '{"language":"python","code":"1/0"}',
        rawOutput: '',
      });
      mockAdapter.executeCode.mockResolvedValueOnce({
        stdout: '', stderr: 'error', exitCode: 1, rawOutput: '',
      });

      await sec.executeTask(makeTask({ task_id: 'task-ev-2', act_id: 'task-ev-2' }));

      expect(emitSpy).toHaveBeenCalledTimes(2);
      expect(emitSpy).toHaveBeenNthCalledWith(2,
        EventAction.TOOL_CALL,
        expect.objectContaining({ status: 'failed', step_index: 0 }),
        undefined,
        'task-ev-2',
      );
    });

    it('should emit running then failed when an exception is thrown', async () => {
      const emitSpy = vi.spyOn(sec, 'emitEvent');

      mockAdapter.callLLM.mockRejectedValueOnce(new Error('boom'));

      await sec.executeTask(makeTask({ task_id: 'task-ev-3', act_id: 'task-ev-3' }));

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
  });

  // ── Tool check & permission guard ───────────────────────────────────────

  describe('Guards', () => {
    it('should throw when required_skill is not in available tools', async () => {
      const task = makeTask();
      task.step.required_skill = 'UnknownTool';

      await expect(sec.executeTask(task)).rejects.toThrow('无法使用工具');
    });
  });
});
