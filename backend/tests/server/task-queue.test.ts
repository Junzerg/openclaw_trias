/**
 * TaskQueue 单元测试 — 并发控制验证。
 *
 * 核心验证点：
 * 1. maxConcurrent=1 时同一时刻只有 1 个任务在执行
 * 2. Thunk 在 submit 时不被调用，只在 drain 时触发
 * 3. maxConcurrent=2 时最多 2 个任务同时运行
 */

import { describe, it, expect } from 'vitest';
import { TaskQueue } from '../../src/server/task-queue';

/**
 * 创建一个可控的任务 factory。
 * 返回 { factory, resolve, started }
 * - factory: thunk 函数
 * - resolve: 手动 resolve Promise 让任务完成
 * - started: 一个 getter，检查 factory 是否被调用过
 */
function createControllableTask() {
  let resolvePromise: () => void;
  let started = false;

  const factory = () => {
    started = true;
    return new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
  };

  return {
    factory,
    resolve: () => resolvePromise(),
    get started() { return started; },
  };
}

describe('TaskQueue', () => {
  // ─── 基本行为 ──────────────────────────────────────────────────

  it('should expose runningCount and pendingCount', async () => {
    const queue = new TaskQueue(1);
    expect(queue.runningCount).toBe(0);
    expect(queue.pendingCount).toBe(0);
  });

  // ─── Thunk Deferred Execution ──────────────────────────────────

  it('should NOT call factory synchronously during submit (thunk deferred)', async () => {
    const queue = new TaskQueue(1);
    let factoryCalled = false;

    // 不 await submit — 同步检查 factory 是否在 submit 调用体内被触发
    const factory = () => {
      factoryCalled = true;
      return Promise.resolve();
    };

    // 非 await 调用：submit 返回 Promise 但我们故意不等它
    queue.submit('task-1', factory);

    // 在同一微任务轮次中，factory 绝对不应该被调用
    // （drain 使用 queueMicrotask 延迟至下一微任务）
    expect(factoryCalled).toBe(false);
    expect(queue.pendingCount).toBe(1);

    // 让 drain 微任务执行
    await new Promise((r) => setTimeout(r, 10));

    // 现在 factory 应该已经被调用了
    expect(factoryCalled).toBe(true);
  });

  // ─── Serial Execution (maxConcurrent=1) ────────────────────────

  it('should enforce maxConcurrent=1 — only 1 task runs at a time', async () => {
    const queue = new TaskQueue(1);
    const t1 = createControllableTask();
    const t2 = createControllableTask();
    const t3 = createControllableTask();

    await queue.submit('t1', t1.factory);
    await queue.submit('t2', t2.factory);
    await queue.submit('t3', t3.factory);

    // 让 drain 微任务执行
    await new Promise((r) => setTimeout(r, 10));

    // 只有 t1 被启动，t2 和 t3 在 pending
    expect(t1.started).toBe(true);
    expect(t2.started).toBe(false);
    expect(t3.started).toBe(false);
    expect(queue.runningCount).toBe(1);
    expect(queue.pendingCount).toBe(2);

    // 让 t1 完成
    t1.resolve();
    await new Promise((r) => setTimeout(r, 10));

    // t2 应该启动了
    expect(t2.started).toBe(true);
    expect(t3.started).toBe(false);
    expect(queue.runningCount).toBe(1);
    expect(queue.pendingCount).toBe(1);

    // 让 t2 完成
    t2.resolve();
    await new Promise((r) => setTimeout(r, 10));

    // t3 应该启动了
    expect(t3.started).toBe(true);
    expect(queue.runningCount).toBe(1);
    expect(queue.pendingCount).toBe(0);

    // 清理
    t3.resolve();
    await new Promise((r) => setTimeout(r, 10));

    expect(queue.runningCount).toBe(0);
    expect(queue.pendingCount).toBe(0);
  });

  // ─── Concurrent Execution (maxConcurrent=2) ────────────────────

  it('should allow maxConcurrent=2 — up to 2 tasks run simultaneously', async () => {
    const queue = new TaskQueue(2);
    const t1 = createControllableTask();
    const t2 = createControllableTask();
    const t3 = createControllableTask();

    await queue.submit('t1', t1.factory);
    await queue.submit('t2', t2.factory);
    await queue.submit('t3', t3.factory);

    await new Promise((r) => setTimeout(r, 10));

    // t1 和 t2 同时运行，t3 pending
    expect(t1.started).toBe(true);
    expect(t2.started).toBe(true);
    expect(t3.started).toBe(false);
    expect(queue.runningCount).toBe(2);
    expect(queue.pendingCount).toBe(1);

    // 让 t1 完成
    t1.resolve();
    await new Promise((r) => setTimeout(r, 10));

    // t3 应自动填补空位
    expect(t3.started).toBe(true);
    expect(queue.runningCount).toBe(2);
    expect(queue.pendingCount).toBe(0);

    // 全部完成
    t2.resolve();
    t3.resolve();
    await new Promise((r) => setTimeout(r, 10));

    expect(queue.runningCount).toBe(0);
  });

  // ─── Error Handling ────────────────────────────────────────────

  it('should continue processing even if a task throws', async () => {
    const queue = new TaskQueue(1);
    const t2 = createControllableTask();

    // t1 会立即 reject
    const failingFactory = () => Promise.reject(new Error('Boom!'));

    await queue.submit('fail-task', failingFactory);
    await queue.submit('ok-task', t2.factory);

    await new Promise((r) => setTimeout(r, 10));

    // 失败的任务应该已经完成，t2 应该被启动
    expect(t2.started).toBe(true);
    expect(queue.runningCount).toBe(1);
    expect(queue.pendingCount).toBe(0);

    t2.resolve();
    await new Promise((r) => setTimeout(r, 10));
    expect(queue.runningCount).toBe(0);
  });

  // ─── Execution Order ──────────────────────────────────────────

  it('should execute tasks in FIFO order', async () => {
    const queue = new TaskQueue(1);
    const executionOrder: string[] = [];

    const makeTask = (id: string) => async () => {
      executionOrder.push(id);
    };

    await queue.submit('a', makeTask('a'));
    await queue.submit('b', makeTask('b'));
    await queue.submit('c', makeTask('c'));

    // 等待所有任务完成
    await new Promise((r) => setTimeout(r, 50));

    expect(executionOrder).toEqual(['a', 'b', 'c']);
  });
});
