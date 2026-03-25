/**
 * 结构化事件日志记录器。
 *
 * 所有 Agent action 统一记录为结构化事件，
 * 直接对标 PRD 的 WebSocket 事件格式。
 */

import { BaseEvent, EventAction } from '../schemas/events';

const MAX_EVENT_LOG_SIZE = 10_000;

export class EventLogger {
  private _events: BaseEvent[];

  constructor() {
    this._events = [];
  }

  public log(event: BaseEvent): void {
    this._events.push(event);
    // Bug 35+54 fix: 防止无限增长，超过容量则原地通过 splice 丢弃旧数据，保持数组引用
    if (this._events.length > MAX_EVENT_LOG_SIZE) {
      this._events.splice(0, MAX_EVENT_LOG_SIZE / 2);
    }
  }

  public get_events(filters?: {
    source_agent?: string;
    action?: EventAction;
    since?: Date;
  }): BaseEvent[] {
    return this._events.filter(event => {
      if (filters?.source_agent && event.source_agent !== filters.source_agent) {
        return false;
      }
      if (filters?.action && event.action !== filters.action) {
        return false;
      }
      if (filters?.since) {
        // Bug 48 fix: handle both Date objects and ISO string timestamps
        const eventTime = event.timestamp instanceof Date
          ? event.timestamp.getTime()
          : new Date(event.timestamp as unknown as string).getTime();
        if (isNaN(eventTime) || eventTime < filters.since.getTime()) {
          return false;
        }
      }
      return true;
    });
  }

  public export_for_websocket(): Record<string, unknown>[] {
    // 假设 event 对象本身结构已经是可以直转 JSON 的类型
    return this._events.map(event => JSON.parse(JSON.stringify(event)));
  }

  public get count(): number {
    return this._events.length;
  }

  public clear(): void {
    this._events = [];
  }
}
