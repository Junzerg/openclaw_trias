import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConstitution, loadSoul, clearConfigCache } from '../src/config/loader';
import { BaseAgent, Branch, Permission, PermissionDeniedError } from '../src/agents/base';
import { OpenClawAdapter, LLMResponse } from '../src/openclaw/adapter';
import { MessageBus } from '../src/bus/message-bus';
import { join } from 'node:path';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';

const PROJECT_ROOT = join(__dirname, '../..');
const SOULS_DIR = join(PROJECT_ROOT, 'config', 'souls');

describe('Config Loader', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('should load constitution.yaml and parse correctly', () => {
    const config = loadConstitution();
    expect(config.version).toBe('1.0');
    expect(config.judicial.blacklist_commands).toContain('rm -rf');
    expect(config.security.sandbox_enabled).toBe(true);
    expect(config.rbac.permissions).toContain('PLAN');
  });

  it('should load a soul md file correctly for an existing role', () => {
    // Let's create a temporary soul for testing if it doesn't exist
    const testRole = 'dummy_test';
    const soulPath = join(SOULS_DIR, `SOUL_${testRole.toUpperCase()}.md`);
    if (!existsSync(SOULS_DIR)) {
      mkdirSync(SOULS_DIR, { recursive: true });
    }
    writeFileSync(soulPath, 'You are a test agent\nLine 2', 'utf-8');

    try {
      const prompt = loadSoul(testRole);
      expect(prompt).toContain('You are a test agent');
      
      const promptCache = loadSoul(testRole); // from cache
      expect(promptCache).toBe(prompt);
    } finally {
      unlinkSync(soulPath);
      clearConfigCache();
    }
  });
});

describe('BaseAgent', () => {
  let adapter: OpenClawAdapter;
  let bus: MessageBus;

  class DummyAgent extends BaseAgent {
    public async act(message: unknown): Promise<unknown> {
      this.requirePermission(Permission.PLAN);
      return { success: true, processed: message };
    }

    public async executePlan(): Promise<unknown> {
      this.requirePermission(Permission.EXECUTE);
      return true;
    }

    public async publicCallLLM(prompt: string): Promise<LLMResponse> {
      return this.callLLM(prompt);
    }
  }

  beforeEach(() => {
    clearConfigCache();
    adapter = new OpenClawAdapter();
    bus = new MessageBus();
    
    // Mock the adapter callLLM
    vi.spyOn(adapter, 'callLLM').mockResolvedValue({
      content: 'Mocked Response',
      rawOutput: 'Raw',
    });
  });

  it('should enforce RBAC with requirePermission', async () => {
    const agent = new DummyAgent('Dummy', 'dummy', Branch.LEGISLATIVE, [Permission.PLAN], adapter, bus, false);

    agent.systemPrompt = 'Dummy Prompt';

    // act requires PLAN, which the agent has
    const result = await agent.act('Hello') as { success: boolean };
    expect(result.success).toBe(true);

    // executePlan requires EXECUTE, which the agent lacks
    await expect(agent.executePlan()).rejects.toThrowError(PermissionDeniedError);
    await expect(agent.executePlan()).rejects.toThrowError('dummy 不具备 EXECUTE 权限');
  });

  it('should correctly build context and inject OpenClawAdapter', async () => {
    const agent = new DummyAgent('Dummy', 'dummy', Branch.LEGISLATIVE, [Permission.PLAN], adapter, bus, false);
    agent.systemPrompt = 'Dummy Prompt context.';

    const response = await agent.publicCallLLM('What is 1+1?');
    expect(response.content).toBe('Mocked Response');
    expect(adapter.callLLM).toHaveBeenCalledWith('Dummy Prompt context.', 'What is 1+1?');
  });

  it('should emit events correctly to MessageBus', () => {
    const spy = vi.spyOn(bus, 'publish');
    const agent = new DummyAgent('Dummy', 'dummy', Branch.EXECUTIVE, [Permission.EXECUTE], adapter, bus, false);
    
    // In BaseAgent we emit event with `EventAction.TOOL_CALL` inside emitEvent when requested
    const event = agent.emitEvent('tool_call' as any, { tool: 'abc' });
    
    expect(event.source_agent).toBe('dummy');
    expect(event.action).toBe('tool_call');
    expect(event.payload.tool).toBe('abc');
    expect(spy).toHaveBeenCalledWith('execution', event);
  });
});
