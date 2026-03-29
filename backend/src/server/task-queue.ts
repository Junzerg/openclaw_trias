/**
 * 异步任务队列 — 翻译自 Python task_queue.py。
 *
 * 使用手写信号量 + drain 循环实现并发控制。
 * 核心防雷：submit 只入队 Thunk，不立即执行。
 * drain 循环在有空闲 slot 时才 invoke factory 创建 Promise。
 */

import { type ITaskQueue } from './app';

interface QueueEntry {
  taskId: string;
  factory: () => Promise<void>;
}

/**
 * 带并发控制的异步任务队列。
 *
 * 设计要点：
 * - Thunk 模式：submit 接受 `() => Promise<void>`，**不在 submit 时调用**。
 *   只有 drain 循环发现有空闲并发 slot 时才 invoke factory。
 * - 无第三方依赖：手写信号量逻辑，避免引入 p-limit 等模块。
 */
export class TaskQueue implements ITaskQueue {
  private readonly maxConcurrent: number;
  private readonly pending: QueueEntry[] = [];
  private readonly running = new Set<string>();
  private draining = false;

  constructor(maxConcurrent: number = 1) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * 提交任务到队列。
   * factory 不会被立即调用 — 只在并发 slot 空闲时由 drain 循环启动。
   *
   * Bug 26 fix: 去重 — 拒绝已在 running 或 pending 中的 taskId。
   */
  async submit(taskId: string, taskFactory: () => Promise<void>): Promise<void> {
    // Bug 26 fix: 防止同一 taskId 被重复提交
    if (this.running.has(taskId)) {
      console.warn(`[TaskQueue] Task ${taskId} already running, rejecting duplicate submit`);
      return;
    }
    if (this.pending.some(e => e.taskId === taskId)) {
      console.warn(`[TaskQueue] Task ${taskId} already pending, rejecting duplicate submit`);
      return;
    }
    this.pending.push({ taskId, factory: taskFactory });
    // 触发 drain（非阻塞）
    this.drain();
  }

  /** 当前正在执行的任务数 */
  get runningCount(): number {
    return this.running.size;
  }

  /** 等待执行的任务数 */
  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * 内部 drain 循环：从 pending 队列取出任务，填满并发 slot。
   *
   * 重入安全：多次调用 drain() 不会产生多个并行循环，
   * 因为 draining 标记 + 同步取值保证单线程下的互斥。
   */
  private drain(): void {
    if (this.draining) return;
    this.draining = true;

    // 使用 queueMicrotask 而非 Promise.resolve().then()
    // 确保当前同步调用栈完成后再启动 drain
    queueMicrotask(() => {
      this.draining = false;
      this.processPending();
    });
  }

  /**
   * 从 pending 中取出可执行的任务并启动。
   * 每个任务完成后递归触发 drain 以填补空位。
   */
  private processPending(): void {
    while (this.running.size < this.maxConcurrent && this.pending.length > 0) {
      // shift()! 安全：循环条件保证 pending 非空
      const entry = this.pending.shift()!;
      this.running.add(entry.taskId);

      // 启动任务 — 此处才真正 invoke factory
      try {
        const promise = entry.factory();
        promise
          .catch((err) => {
            console.error(`TaskQueue: task ${entry.taskId} failed:`, err);
          })
          .finally(() => {
            this.running.delete(entry.taskId);
            // 任务完成后继续 drain
            this.processPending();
          });
      } catch (err) {
        // Bug 50 fix: caught synchronous throw from factory prevents infinite deadlock
        console.error(`TaskQueue: task ${entry.taskId} threw synchronously:`, err);
        this.running.delete(entry.taskId);
        this.processPending();
      }
    }
  }
}
