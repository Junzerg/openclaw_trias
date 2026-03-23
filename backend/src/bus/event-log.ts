/**
 * 结构化事件日志记录器。
 *
 * 所有 Agent action 统一记录为结构化事件，
 * 直接对标 PRD 的 WebSocket 事件格式。
 */

import { BaseEvent, EventAction } from '../schemas/events';

export class EventLogger {
  private _events: BaseEvent[];

  constructor() {
    this._events = [];
  }

  public log(event: BaseEvent): void {
    this._events.push(event);
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
        if (event.timestamp.getTime() < filters.since.getTime()) {
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
