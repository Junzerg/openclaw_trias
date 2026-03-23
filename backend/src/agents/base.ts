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
  protected async callLLM(prompt: string): Promise<LLMResponse> {
    const heartbeat = this.startProgressHeartbeat();
    try {
      return await this.adapter.callLLM(this.systemPrompt, prompt);
    } finally {
      clearInterval(heartbeat);
    }
  }

  /**
   * Publish `llm_thinking` heartbeat events every 3 s while an LLM call is in flight.
   * Allows frontends to show "thinking…" indicators and detect stalled calls.
   */
  private startProgressHeartbeat(): NodeJS.Timeout {
    let elapsed = 0;
    return setInterval(() => {
      elapsed += 3;
      if (this.bus) {
        this.bus.publish('lifecycle', {
          action: EventAction.LLM_THINKING,
          source_agent: this.role,
          payload: { elapsed_seconds: elapsed },
          timestamp: new Date(),
          intensity: 0,
          emotion: EmotionType.NEUTRAL,
        }).catch(() => {});
      }
    }, 3000);
  }

  // ----- Lifecycle & Processing -----
  public abstract act(message: unknown): Promise<unknown>;

  public async receive(message: unknown): Promise<unknown> {
    return await this.act(message);
  }

  // ----- Event Emission -----
  public emitEvent(
    action: EventAction,
    payload: Record<string, any> = {},
    targetAgent?: string,
    taskId?: string
  ): BaseEvent {
    // Create base event
    const eventBase = {
      timestamp: new Date(),
      source_agent: this.role,
      target_agent: targetAgent || null,
      action: action,
      emotion: payload.emotion || EmotionType.NEUTRAL,
      intensity: payload.intensity || 0.5,
      status: payload.status || 'success',
      ...payload,
      payload: payload.payload !== undefined ? payload.payload : payload,
      task_id: taskId || payload.task_id || randomUUID(),
    };
    
    const event = eventBase as unknown as BaseEvent;

    // Publish to the bus if available
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
      this.bus.publish(topic, event).catch((err) => {
        console.error(`[BaseAgent] Failed to emit event to bus: ${err}`);
      });
    }

    return event;
  }
}
