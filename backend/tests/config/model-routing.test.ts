/**
 * Model Routing Tests — Task 3.3
 *
 * Coverage:
 *   1. Zod schema validation (ModelRoutingConfigSchema)
 *   2. resolveModel() fallback logic
 *   3. Agent modelRef injection chain via CyberGovernment
 *   4. Adapter --model CLI arg forwarding via MockTransport
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve } from 'path';
import { ModelRoutingConfigSchema, ConstitutionConfigSchema } from '../../src/config/models';
import { resolveModel, clearConfigCache } from '../../src/config/loader';
import { CyberGovernment } from '../../src/government';
import { OpenClawAdapter, type ITransport } from '../../src/openclaw/adapter';
import { BaseAgent, Branch, Permission } from '../../src/agents/base';
import type { LLMResponse } from '../../src/openclaw/adapter';

const configDir = resolve(__dirname, '../../../config');

// ── Mock Transport ─────────────────────────────────────────────────────────

class MockTransport implements ITransport {
  public sendCalls: { args: string[]; timeoutMs: number; envOverrides?: NodeJS.ProcessEnv }[] = [];
  private responses: string[];

  constructor(responses: string[] = ['mock output']) {
    this.responses = [...responses];
  }

  async send(args: string[], timeoutMs: number, envOverrides?: NodeJS.ProcessEnv): Promise<string> {
    this.sendCalls.push({ args, timeoutMs, envOverrides });
    return this.responses.shift() ?? '';
  }
}

// ── Dummy Agent for injection tests ────────────────────────────────────────

class DummyAgent extends BaseAgent {
  public async act(): Promise<unknown> { return null; }
  public async publicCallLLM(prompt: string): Promise<LLMResponse> {
    return this.callLLM(prompt);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITES
// ═══════════════════════════════════════════════════════════════════════════

describe('Model Routing — Zod Schema', () => {
  it('accepts valid config with default only', () => {
    const result = ModelRoutingConfigSchema.safeParse({
      default: 'anthropic/claude-sonnet-4-20250514',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.default).toBe('anthropic/claude-sonnet-4-20250514');
      expect(result.data.overrides).toBeUndefined();
    }
  });

  it('accepts valid config with default + overrides', () => {
    const result = ModelRoutingConfigSchema.safeParse({
      default: 'anthropic/claude-sonnet-4-20250514',
      overrides: {
        chief_justice: 'anthropic/claude-opus-4-20250514',
        radical_mp: 'deepseek/deepseek-chat',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.overrides!['chief_justice']).toBe('anthropic/claude-opus-4-20250514');
    }
  });

  it('rejects config missing required "default" field', () => {
    const result = ModelRoutingConfigSchema.safeParse({
      overrides: { chief_justice: 'some-model' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts config with empty overrides', () => {
    const result = ModelRoutingConfigSchema.safeParse({
      default: 'model-x',
      overrides: {},
    });
    expect(result.success).toBe(true);
  });

  it('rejects config with non-string default', () => {
    const result = ModelRoutingConfigSchema.safeParse({
      default: 42,
    });
    expect(result.success).toBe(false);
  });

  it('rejects config with non-string override values', () => {
    const result = ModelRoutingConfigSchema.safeParse({
      default: 'model-x',
      overrides: { speaker: 123 },
    });
    expect(result.success).toBe(false);
  });
});

describe('Model Routing — resolveModel()', () => {
  it('returns undefined when routing is undefined (backward compat)', () => {
    expect(resolveModel('speaker', undefined)).toBeUndefined();
  });

  it('returns routing.default when role has no override', () => {
    const routing = { default: 'model-default' };
    expect(resolveModel('speaker', routing)).toBe('model-default');
  });

  it('returns override when role is listed in overrides', () => {
    const routing = {
      default: 'model-default',
      overrides: { chief_justice: 'model-opus' },
    };
    expect(resolveModel('chief_justice', routing)).toBe('model-opus');
  });

  it('returns default for roles not in overrides', () => {
    const routing = {
      default: 'model-default',
      overrides: { chief_justice: 'model-opus' },
    };
    expect(resolveModel('speaker', routing)).toBe('model-default');
    expect(resolveModel('president', routing)).toBe('model-default');
  });

  it('returns default when overrides is empty object', () => {
    const routing = { default: 'model-default', overrides: {} };
    expect(resolveModel('speaker', routing)).toBe('model-default');
  });

  it('returns default when overrides is undefined', () => {
    const routing = { default: 'model-default' };
    expect(resolveModel('radical_mp', routing)).toBe('model-default');
  });
});

describe('Model Routing — Agent modelRef injection via Government', () => {
  beforeEach(() => {
    clearConfigCache();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('agents have undefined modelRef when model_routing is absent', () => {
    // Provide a mocked constitution WITHOUT model_routing to guarantee test independence
    // from whatever is currently written in the real config/constitution.yaml.
    const noRoutingConstitution = {
      version: '1.0',
      judicial: {
        blacklist_commands: [],
        token_budget: { max_per_task: 1, debate_budget: 1, execution_budget: 1, review_budget: 1 },
        debate: { max_rounds: 1, conflict_threshold: 80, consensus_threshold: 30, min_rounds: 1 },
        deviation: { max_score: 0.3 },
      },
      security: { sandbox_enabled: false, allowed_file_extensions: [], max_execution_time_seconds: 1, max_file_size_mb: 1, network_access: 'restricted' },
      rbac: { permissions: ['PLAN', 'EXECUTE', 'MONITOR', 'VETO', 'KILL'], role_permissions: { speaker: ['PLAN'], radical_mp: ['PLAN'], conservative_mp: ['PLAN'], president: ['PLAN'], sec_engineering: ['EXECUTE'], sec_state: ['EXECUTE'], chief_justice: ['MONITOR'] } },
      model_routing: undefined
    };
    const gov = new CyberGovernment(configDir, noRoutingConstitution);
    expect(gov.speaker.modelRef).toBeUndefined();
    expect(gov.radicalMp.modelRef).toBeUndefined();
    expect(gov.president.modelRef).toBeUndefined();
    expect(gov.chiefJustice.modelRef).toBeUndefined();
  });

  it('agents get correct modelRef when model_routing is configured', () => {
    const constitution = {
      version: '1.0',
      judicial: {
        blacklist_commands: [],
        token_budget: { max_per_task: 100000, debate_budget: 30000, execution_budget: 50000, review_budget: 20000 },
        debate: { max_rounds: 10, conflict_threshold: 80, consensus_threshold: 30, min_rounds: 2 },
        deviation: { max_score: 0.3 },
      },
      security: {
        sandbox_enabled: true,
        allowed_file_extensions: ['.py', '.js', '.ts'],
        max_execution_time_seconds: 300,
        max_file_size_mb: 10,
        network_access: 'restricted',
      },
      rbac: {
        permissions: ['PLAN', 'EXECUTE', 'MONITOR', 'VETO', 'KILL'],
        role_permissions: {
          speaker: ['PLAN'],
          radical_mp: ['PLAN'],
          conservative_mp: ['PLAN'],
          president: ['PLAN', 'VETO'],
          sec_engineering: ['EXECUTE'],
          sec_state: ['EXECUTE'],
          chief_justice: ['MONITOR', 'KILL'],
        },
      },
      model_routing: {
        default: 'anthropic/claude-sonnet-4-20250514',
        overrides: {
          chief_justice: 'anthropic/claude-opus-4-20250514',
          radical_mp: 'deepseek/deepseek-chat',
          conservative_mp: 'deepseek/deepseek-chat',
        },
      },
    };

    const gov = new CyberGovernment(configDir, constitution);

    // Override-specified roles
    expect(gov.chiefJustice.modelRef).toBe('anthropic/claude-opus-4-20250514');
    expect(gov.radicalMp.modelRef).toBe('deepseek/deepseek-chat');
    expect(gov.conservativeMp.modelRef).toBe('deepseek/deepseek-chat');

    // Non-overridden roles → use default
    expect(gov.speaker.modelRef).toBe('anthropic/claude-sonnet-4-20250514');
    expect(gov.president.modelRef).toBe('anthropic/claude-sonnet-4-20250514');
    expect(gov.secEngineering.modelRef).toBe('anthropic/claude-sonnet-4-20250514');
    expect(gov.secState.modelRef).toBe('anthropic/claude-sonnet-4-20250514');
  });
});

describe('Model Routing — Adapter --model argument forwarding', () => {
  it('passes --model with explicit model param (per-agent override)', async () => {
    const transport = new MockTransport(['Valid LLM response']);
    const adapter = new OpenClawAdapter({ timeoutSeconds: 10 }, transport);

    await adapter.callLLM('system', 'hello', 'deepseek/deepseek-chat');

    const call = transport.sendCalls[0];
    expect(call.args.includes('--model')).toBe(false);
    expect(call.envOverrides?.OPENCLAW_MODEL).toBe('deepseek/deepseek-chat');
  });

  it('explicit model param overrides config.defaultModel', async () => {
    const transport = new MockTransport(['Valid LLM response']);
    const adapter = new OpenClawAdapter(
      { timeoutSeconds: 10, defaultModel: 'config-default-model' },
      transport,
    );

    await adapter.callLLM('system', 'hello', 'explicit-override-model');

    const call = transport.sendCalls[0];
    expect(call.args.includes('--model')).toBe(false);
    expect(call.envOverrides?.OPENCLAW_MODEL).toBe('explicit-override-model');
  });

  it('falls back to config.defaultModel when model param is undefined', async () => {
    const transport = new MockTransport(['Valid LLM response']);
    const adapter = new OpenClawAdapter(
      { timeoutSeconds: 10, defaultModel: 'config-default-model' },
      transport,
    );

    await adapter.callLLM('system', 'hello', undefined);

    const call = transport.sendCalls[0];
    expect(call.args.includes('--model')).toBe(false);
    expect(call.envOverrides?.OPENCLAW_MODEL).toBe('config-default-model');
  });

  it('omits --model when both model param and config.defaultModel are absent', async () => {
    const transport = new MockTransport(['Valid LLM response']);
    const adapter = new OpenClawAdapter({ timeoutSeconds: 10 }, transport);

    await adapter.callLLM('system', 'hello');

    const call = transport.sendCalls[0];
    expect(call.args.includes('--model')).toBe(false);
    expect(call.envOverrides?.OPENCLAW_MODEL).toBeUndefined();
  });
});

describe('Model Routing — BaseAgent.callLLM forwards modelRef', () => {
  it('passes modelRef to adapter.callLLM when set', async () => {
    const adapter = new OpenClawAdapter();
    const callLLMSpy = vi.spyOn(adapter, 'callLLM').mockResolvedValue({
      content: 'ok', rawOutput: 'ok',
    });

    const agent = new DummyAgent('Test', 'test_role', Branch.LEGISLATIVE, [Permission.PLAN], adapter, undefined, false);
    agent.systemPrompt = 'test prompt';
    agent.modelRef = 'my-special-model';

    await agent.publicCallLLM('hello');

    expect(callLLMSpy).toHaveBeenCalledWith('test prompt', 'hello', 'my-special-model');
  });

  it('passes undefined modelRef when not set (backward compat)', async () => {
    const adapter = new OpenClawAdapter();
    const callLLMSpy = vi.spyOn(adapter, 'callLLM').mockResolvedValue({
      content: 'ok', rawOutput: 'ok',
    });

    const agent = new DummyAgent('Test', 'test_role', Branch.LEGISLATIVE, [Permission.PLAN], adapter, undefined, false);
    agent.systemPrompt = 'test prompt';
    // modelRef not set → undefined

    await agent.publicCallLLM('hello');

    expect(callLLMSpy).toHaveBeenCalledWith('test prompt', 'hello', undefined);
  });
});

describe('Model Routing — ConstitutionConfigSchema integration', () => {
  it('ConstitutionConfigSchema accepts full config with model_routing', () => {
    const result = ConstitutionConfigSchema.safeParse({
      version: '1.0',
      judicial: {
        blacklist_commands: ['rm -rf'],
        token_budget: { max_per_task: 100000, debate_budget: 30000, execution_budget: 50000, review_budget: 20000 },
        debate: { max_rounds: 10, conflict_threshold: 80, consensus_threshold: 30, min_rounds: 2 },
        deviation: { max_score: 0.3 },
      },
      security: {
        sandbox_enabled: true,
        allowed_file_extensions: ['.py'],
        max_execution_time_seconds: 300,
        max_file_size_mb: 10,
        network_access: 'restricted',
      },
      rbac: {
        permissions: ['PLAN'],
        role_permissions: { speaker: ['PLAN'] },
      },
      model_routing: {
        default: 'anthropic/claude-sonnet-4-20250514',
        overrides: { chief_justice: 'anthropic/claude-opus-4-20250514' },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model_routing?.default).toBe('anthropic/claude-sonnet-4-20250514');
      expect(result.data.model_routing?.overrides?.['chief_justice']).toBe('anthropic/claude-opus-4-20250514');
    }
  });

  it('ConstitutionConfigSchema accepts config WITHOUT model_routing (backward compat)', () => {
    const result = ConstitutionConfigSchema.safeParse({
      version: '1.0',
      judicial: {
        blacklist_commands: [],
        token_budget: { max_per_task: 100000, debate_budget: 30000, execution_budget: 50000, review_budget: 20000 },
        debate: { max_rounds: 10, conflict_threshold: 80, consensus_threshold: 30, min_rounds: 2 },
        deviation: { max_score: 0.3 },
      },
      security: {
        sandbox_enabled: true,
        allowed_file_extensions: ['.py'],
        max_execution_time_seconds: 300,
        max_file_size_mb: 10,
        network_access: 'restricted',
      },
      rbac: {
        permissions: ['PLAN'],
        role_permissions: { speaker: ['PLAN'] },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model_routing).toBeUndefined();
    }
  });
});

describe('Model Routing — Government with default-only routing (no overrides)', () => {
  beforeEach(() => {
    clearConfigCache();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('all agents get routing.default when overrides is absent', () => {
    const constitution = {
      version: '1.0',
      judicial: {
        blacklist_commands: [],
        token_budget: { max_per_task: 100000, debate_budget: 30000, execution_budget: 50000, review_budget: 20000 },
        debate: { max_rounds: 10, conflict_threshold: 80, consensus_threshold: 30, min_rounds: 2 },
        deviation: { max_score: 0.3 },
      },
      security: {
        sandbox_enabled: true,
        allowed_file_extensions: ['.py', '.js', '.ts'],
        max_execution_time_seconds: 300,
        max_file_size_mb: 10,
        network_access: 'restricted',
      },
      rbac: {
        permissions: ['PLAN', 'EXECUTE', 'MONITOR', 'VETO', 'KILL'],
        role_permissions: {
          speaker: ['PLAN'], radical_mp: ['PLAN'], conservative_mp: ['PLAN'],
          president: ['PLAN', 'VETO'], sec_engineering: ['EXECUTE'], sec_state: ['EXECUTE'],
          chief_justice: ['MONITOR', 'KILL'],
        },
      },
      model_routing: {
        default: 'unified-model-for-all',
        // no overrides
      },
    };

    const gov = new CyberGovernment(configDir, constitution);

    expect(gov.speaker.modelRef).toBe('unified-model-for-all');
    expect(gov.radicalMp.modelRef).toBe('unified-model-for-all');
    expect(gov.conservativeMp.modelRef).toBe('unified-model-for-all');
    expect(gov.president.modelRef).toBe('unified-model-for-all');
    expect(gov.secEngineering.modelRef).toBe('unified-model-for-all');
    expect(gov.secState.modelRef).toBe('unified-model-for-all');
    expect(gov.chiefJustice.modelRef).toBe('unified-model-for-all');
  });
});

describe('Model Routing — Adapter log observability', () => {
  it('logs OPENCLAW_MODEL value to console when model is specified', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const transport = new MockTransport(['Valid LLM response']);
    const adapter = new OpenClawAdapter({ timeoutSeconds: 10 }, transport);

    await adapter.callLLM('system', 'hello', 'test-model-xyz');

    const modelLogs = logSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('OPENCLAW_MODEL=test-model-xyz'),
    );
    expect(modelLogs.length).toBeGreaterThanOrEqual(1);
    logSpy.mockRestore();
  });

  it('does NOT log OPENCLAW_MODEL when no model is configured', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const transport = new MockTransport(['Valid LLM response']);
    const adapter = new OpenClawAdapter({ timeoutSeconds: 10 }, transport);

    await adapter.callLLM('system', 'hello');

    const modelLogs = logSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('OPENCLAW_MODEL'),
    );
    expect(modelLogs.length).toBe(0);
    logSpy.mockRestore();
  });
});
