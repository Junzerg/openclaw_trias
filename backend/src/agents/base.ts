import { randomUUID } from 'node:crypto';
import { BaseEvent, EventAction, EmotionType } from '../schemas/events';
import { MessageBus } from '../bus/message-bus';
import { OpenClawAdapter, LLMResponse } from '../openclaw/adapter';
import { loadSoul } from '../config/loader';

export enum Permission {
  PLAN = 'PLAN',
  EXECUTE = 'EXECUTE',
  MONITOR = 'MONITOR',
  VETO = 'VETO',
  KILL = 'KILL',
}

export enum Branch {
  LEGISLATIVE = 'legislative',
  EXECUTIVE = 'executive',
  JUDICIAL = 'judicial',
}

export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionDeniedError';
  }
}

export abstract class BaseAgent {
  public name: string;
  public role: string;
  public branch: Branch;
  public systemPrompt: string = '';
  /** Per-agent model override, injected by Government from model_routing config */
  public modelRef?: string;

  protected readonly _permissions: Set<Permission>;
  protected _tools: string[];
  protected bus?: MessageBus;
  protected adapter: OpenClawAdapter;

  // The base tools available to this agent class
  protected static _available_tools: string[] = [];

  constructor(
    name: string,
    role: string,
    branch: Branch,
    permissions: Permission[],
    adapter: OpenClawAdapter,
    bus?: MessageBus,
    loadSoulFlag: boolean = true
  ) {
    this.name = name;
    this.role = role;
    this.branch = branch;
    this._permissions = new Set(permissions);
    
    // We bind the global static tools to instance tools
    this._tools = [...(this.constructor as typeof BaseAgent)._available_tools];

    this.adapter = adapter;
    this.bus = bus;

    if (loadSoulFlag) {
      try {
        this.systemPrompt = loadSoul(this.role);
      } catch (err) {
        console.warn(`[BaseAgent] Could not load soul for ${this.role}: ${err}`);
      }
    }
  }

  // ----- RBAC -----
  public hasPermission(perm: Permission): boolean {
    return this._permissions.has(perm);
  }

  public requirePermission(perm: Permission): void {
    if (!this.hasPermission(perm)) {
      throw new PermissionDeniedError(`${this.role} 不具备 ${perm} 权限`);
    }
  }

  // ----- Tools -----
  public registerTools(tools: string[]): void {
    this._tools = [...tools];
  }

  public canUseTool(toolName: string): boolean {
    return this._tools.includes(toolName);
  }

  // ----- LLM Interop -----
  protected async callLLM(prompt: string, taskId?: string): Promise<LLMResponse> {
    const heartbeat = this.startProgressHeartbeat(taskId);
    try {
      return await this.adapter.callLLM(this.systemPrompt, prompt, this.modelRef);
    } finally {
      clearInterval(heartbeat);
    }
  }



  /**
   * Publish `llm_thinking` heartbeat events every 3 s while an LLM call is in flight.
   * Allows frontends to show "thinking…" indicators and detect stalled calls.
   */
  private startProgressHeartbeat(taskId?: string): NodeJS.Timeout {
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += 3;
      if (this.bus) {
        this.bus.publish('lifecycle', {
          action: EventAction.LLM_THINKING,
          source_agent: this.role,
          payload: { elapsed_seconds: elapsed },
          timestamp: new Date(),
          intensity: 0,
          emotion: EmotionType.NEUTRAL,
          task_id: taskId,
        }).catch(() => {});
      }
    }, 3000);
    // Bug 42 fix: 防止 heartbeat 阻止 Node.js 进程退出
    timer.unref();
    return timer;
  }

  // ----- Lifecycle & Processing -----
  public abstract act(message: unknown): Promise<unknown>;

  public async receive(message: unknown): Promise<unknown> {
    return await this.act(message);
  }

  public emitEvent(
    action: EventAction,
    payload: Record<string, unknown> = {},
    targetAgent?: string,
    taskId?: string
  ): { event: BaseEvent; publishPromise: Promise<void> } {
    // Bug 16 fix: 分离事件元数据和 payload，避免 payload 自引用导致数据冗余
    // 从 caller payload 中提取事件级元数据，其余保留为纯数据 payload
    const { emotion: payloadEmotion, intensity: payloadIntensity, status: payloadStatus, payload: nestedPayload, task_id: payloadTaskId, ...cleanPayload } = payload;

    const eventBase = {
      timestamp: new Date(),
      source_agent: this.role,
      target_agent: targetAgent || null,
      action: action,
      emotion: payloadEmotion ?? EmotionType.NEUTRAL,
      intensity: payloadIntensity ?? 0.5,
      status: payloadStatus ?? 'success',
      // 展开 clean payload 到顶层（保持向后兼容：ExecutionEvent 等需要 tool_name 在顶层）
      ...cleanPayload,
      // payload 字段存储纯数据，不再复制 cleanPayload 导致双重存储 (Bug 56 fix)
      payload: nestedPayload !== undefined ? nestedPayload : {},
      task_id: taskId || payloadTaskId || randomUUID(),
    };
    
    const event = eventBase as unknown as BaseEvent;
    
    // Publish to the bus if available, returning the Promise
    let publishPromise = Promise.resolve();
    if (this.bus) {
      let topic: 'legislation' | 'execution' | 'judiciary' | 'lifecycle';
      switch (this.branch) {
        case Branch.LEGISLATIVE:
          topic = 'legislation';
          break;
        case Branch.EXECUTIVE:
          topic = 'execution';
          break;
        case Branch.JUDICIAL:
          topic = 'judiciary';
          break;
        default:
          topic = 'lifecycle';
      }
      publishPromise = this.bus.publish(topic, event);
    }

    return { event, publishPromise };
  }
}
