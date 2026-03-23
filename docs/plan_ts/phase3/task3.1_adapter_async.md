# Task 3.1: Adapter 异步化重构

> **目标**：将 `OpenClawAdapter` 的核心传输从 `execSync`（同步阻塞）切换为 `child_process.spawn`（异步），解决 Phase 2 遗留 Bug 3。同时引入 `ITransport` 接口抽象为 Phase 4 WebSocket 直连铺路，并在 LLM 等待期间推送进度事件。
> **前置依赖**：[Phase 2](../phase2/phase2_overview.md) 完成
> **对应目录**：`backend/src/openclaw/`
> **预估耗时**：0.5 会话

## 需求说明

### 1. `ITransport` 接口抽象 (`openclaw/transport.ts` — 新增)

定义传输层抽象接口，当前仅实现 CLI 版本，预留 WebSocket Hook：

```typescript
export interface ITransport {
  /** 发送命令并等待完整响应 */
  send(args: string[], timeoutMs: number): Promise<string>;
  /** 注册进度回调（可选，用于 LLM 等待期间推送心跳） */
  onProgress?(callback: (elapsedMs: number) => void): void;
  /** 清理资源 */
  dispose?(): void;
}
```

### 2. `CliTransport` 实现 (`openclaw/transport.ts`)

将 `adapter.ts` 中的 `runCliCommand` 逻辑提取为独立类：

- 使用 `child_process.spawn` **直接执行**目标 binary（无 bash 中间层 → SIGTERM 直达目标进程，无孤儿泄露）
- 直接捕获 `stdout` + `stderr` 流，**删除** `/tmp/openclaw-out-*.txt` 临时文件方案
- `MAX_BUFFER = 10MB` 防止 OOM
- 超时保护：`SIGTERM` → 2s fallback `SIGKILL` → reject
- Timer/Interval `.unref()` 防止阻塞 Node.js 退出
- Settle guard 防止双 resolve/reject
- 每 3 秒调用 `onProgress` 回调（仅在注册了回调时创建 interval）

```typescript
export class CliTransport implements ITransport {
  private cliBin: string;
  constructor(cliBin: string = 'openclaw') { this.cliBin = cliBin; }

  async send(args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.cliBin, args, { env: { ...process.env } });
      let output = ''; let outputBytes = 0; let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return; settled = true;
        clearTimeout(timer); if (heartbeat) clearInterval(heartbeat);
        fn();
      };
      const appendOutput = (chunk: Buffer) => {
        if (outputBytes >= MAX_BUFFER) return;
        output += chunk.toString(); outputBytes += chunk.length;
      };
      child.stdout?.on('data', appendOutput);
      child.stderr?.on('data', appendOutput);
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2000).unref();
        settle(() => reject(new Error(`CLI timeout after ${timeoutMs}ms`)));
      }, timeoutMs);
      timer.unref();
      const heartbeat = this.progressCallback
        ? setInterval(() => { ... }, 3000) : undefined;
      heartbeat?.unref();
      child.on('close', () => settle(() => resolve(output)));
      child.on('error', (err) => settle(() => reject(err)));
    });
  }
}
```

### 3. `adapter.ts` 重构

- `runCliCommand(args): Promise<string>` 委托给 `ITransport.send()`
- `callLLM()` / `executeCode()` 内部 `await` 异步调用（公共签名保持 `Promise` 不变）
- 新增 **进度心跳机制**：LLM 调用期间每 3 秒通过回调推送 `{ action: 'llm_thinking', source_agent, elapsed_seconds }` 事件
- 构造器新增可选 `transport?: ITransport` 参数（不传则默认 `new CliTransport()`）

```typescript
// adapter.ts 构造器签名变更
constructor(config?: Partial<OpenClawAdapterConfig>, transport?: ITransport) {
  this.config = { ...DEFAULT_CONFIG, ...config };
  this.transport = transport ?? new CliTransport(this.config.cliBin);
}
```

### 4. 进度事件推送

在 `base.ts` 的 `callLLM()` 方法中集成进度回调：

```typescript
// base.ts — callLLM 增加进度事件
protected async callLLM(prompt: string): Promise<LLMResponse> {
  const heartbeat = this.startProgressHeartbeat();
  try {
    return await this.adapter.callLLM(this.systemPrompt, prompt);
  } finally {
    clearInterval(heartbeat);
  }
}

private startProgressHeartbeat(): NodeJS.Timeout {
  let elapsed = 0;
  return setInterval(() => {
    elapsed += 3;
    if (this.bus) {
      this.bus.publish('lifecycle', {
        action: EventAction.LLM_THINKING,  // 使用枚举，非裸字符串
        source_agent: this.role,
        payload: { elapsed_seconds: elapsed },
        timestamp: new Date(),
        intensity: 0,
        emotion: EmotionType.NEUTRAL,
      }).catch(() => {});  // 无 `as any`
    }
  }, 3000);
}
```

## 交付物

| 文件 | 行数(实际) | 说明 |
|------|-----------|------|
| `openclaw/transport.ts` | 119 | `ITransport` 接口 + `CliTransport` 实现（直接 spawn + maxBuffer + settle guard） |
| `openclaw/adapter.ts` | 398 (重构) | 依赖 `ITransport`，删除 `execSync`/临时文件。healthCheck/extractLLMContent 加固 |
| `agents/base.ts` | ~15 行改动 | 进度心跳机制（使用 `EventAction.LLM_THINKING` 枚举） |
| `schemas/events.ts` | +1 行 | `EventAction.LLM_THINKING = 'llm_thinking'` |
| `tests/openclaw/adapter.test.ts` | 317 | 24 test cases: async, timeout, concurrency, MockTransport, maxBuffer, false-positive prevention |
| `tests/base-agent.test.ts` | +40 行 | heartbeat fake timer 测试 |

## 验收维度

- [x] `callLLM()` 执行期间，Express HTTP 请求正常响应（事件循环不阻塞）— spawn 异步验证
- [x] WS 心跳在 LLM 调用期间不丢失 — E2E 验证可见 `llm_thinking` 事件
- [x] 进度事件每 3 秒推送 `llm_thinking` 到 MessageBus — fake timer 测试验证
- [x] CLI 超时后 Promise reject，子进程被 kill，不挂起 — SIGTERM + 2s SIGKILL fallback
- [x] 同时发起 2 个 `callLLM()`，两个都能正常返回（并发安全）— 并发测试验证
- [x] `ITransport` 接口定义清晰，未来实现 `WebSocketTransport` 零改动 adapter
- [x] 所有现有 242 测试通过（回归）— 265 tests (242 original + 23 new)
- [x] `npm run build` 零 TypeScript 报错

## 深度审查记录 (6 Rounds)

修复 **10 个 Bug**（1 Fatal, 4 High, 3 Medium, 2 Low）：

| # | 严重度 | 问题 | 修复 |
|---|--------|------|------|
| 1 | 💀 Fatal | 进程泄露: `spawn('bash')` → SIGTERM 只杀 bash，openclaw 成孤儿 | 直接 `spawn(cliBin, args)` |
| 2 | 🔴 High | OOM: 无 maxBuffer 限制 | `MAX_BUFFER = 10MB` |
| 3 | 🔴 High | healthCheck 误报 CLI 不可用（banner-only 输出） | try-catch 降级 |
| 4 | 🔴 High | extractLLMContent 误检（LLM 内容提到 gateway 错误） | 过滤后检测 + startsWith |
| 5 | 🔴 High | EventAction 缺 LLM_THINKING → 类型安全漏洞 | 加入枚举 + 移除 as any |
| 6 | 🟡 Medium | Timer 阻塞退出（缺 .unref()） | 全部 .unref() |
| 7 | 🟡 Medium | pingGateway 竞态（双触发 resolve/reject） | settled 守卫 |
| 8 | 🟡 Medium | SIGTERM 后无 SIGKILL 降级 | 2s fallback |
| 9 | 🟢 Low | Transport heartbeat 空转 | 条件创建 |
| 10 | 🟢 Low | Smoke test `\\n` | 修正转义 |
