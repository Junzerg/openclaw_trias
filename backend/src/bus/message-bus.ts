/**
 * 消息总线 — 三权分支间的异步消息传递协议。
 *
 * 基于内存的发布/订阅机制。
 */

import { BaseEvent } from '../schemas/events';

export type Topic = 'legislation' | 'execution' | 'judiciary' | 'lifecycle';

export const TOPICS: Set<Topic> = new Set([
  'legislation',
  'execution',
  'judiciary',
  'lifecycle',
]);

export type Handler = (event: BaseEvent) => Promise<void> | void;

export class MessageBus {
  private _subscribers: Map<Topic, Set<Handler>>;
  private _event_log: BaseEvent[];
  private _running: boolean;

  constructor() {
    this._subscribers = new Map<Topic, Set<Handler>>();
    for (const topic of TOPICS) {
      this._subscribers.set(topic, new Set<Handler>());
    }
    this._event_log = [];
    this._running = false;
  }

  public async publish(topic: Topic, event: BaseEvent): Promise<void> {
    if (!TOPICS.has(topic)) {
      throw new Error(`无效主题 '${topic}'，合法主题: ${Array.from(TOPICS).sort().join(', ')}`);
    }

    this._event_log.push(event);

    const handlers = this._subscribers.get(topic);
    if (handlers) {
      await Promise.all(
        Array.from(handlers).map(async (handler) => {
          try {
            await handler(event);
          } catch (error) {
            console.error(`订阅者处理事件失败: topic=${topic}, handler=${handler.name}`, error);
          }
        })
      );
    }
  }

  public subscribe(topic: Topic, handler: Handler): void {
    if (!TOPICS.has(topic)) {
      throw new Error(`无效主题 '${topic}'，合法主题: ${Array.from(TOPICS).sort().join(', ')}`);
    }
    this._subscribers.get(topic)!.add(handler);
  }

  public unsubscribe(topic: Topic, handler: Handler): void {
    if (!TOPICS.has(topic)) {
      throw new Error(`无效主题 '${topic}'，合法主题: ${Array.from(TOPICS).sort().join(', ')}`);
    }
    const handlers = this._subscribers.get(topic);
    if (!handlers || !handlers.has(handler)) {
      throw new Error(`处理器未注册在主题 '${topic}'`);
    }
    handlers.delete(handler);
  }

  public async start(): Promise<void> {
    this._running = true;
    console.log('消息总线已启动');
  }

  public async stop(): Promise<void> {
    this._running = false;
    console.log('消息总线已停止');
  }

  public get is_running(): boolean {
    return this._running;
  }

  public get event_log(): BaseEvent[] {
    return [...this._event_log];
  }

  public get_subscriber_count(topic: Topic): number {
    if (!TOPICS.has(topic)) {
      throw new Error(`无效主题 '${topic}'，合法主题: ${Array.from(TOPICS).sort().join(', ')}`);
    }
    return this._subscribers.get(topic)!.size;
  }
}
