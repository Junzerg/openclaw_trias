# Task 3.2: 错误分类与重试基础设施

> **目标**：建立统一的非确定性错误分类体系和通用重试装饰器，供 Task 3.4~3.7 消费。
> **前置依赖**：[Task 3.1](task3.1_adapter_async.md)（异步 adapter 才能实现异步重试）
> **对应目录**：`backend/src/openclaw/`
> **预估耗时**：0.5 会话
> **状态**：✅ 已完成 — 7 轮深度审查，17 个 Bug 修复，324 tests passed

## 需求说明

### 1. 错误分类 (`openclaw/errors.ts` — 新增)

```typescript
export enum OpenClawErrorType {
  // ── 可重试 ──
  LLM_TIMEOUT        = 'LLM_TIMEOUT',          // CLI/Gateway 超时
  LLM_RATE_LIMIT     = 'LLM_RATE_LIMIT',        // API 限流 (429)
  JSON_PARSE_ERROR   = 'JSON_PARSE_ERROR',       // LLM 返回截断/畸形 JSON
  GATEWAY_DISCONNECT = 'GATEWAY_DISCONNECT',     // Gateway 断连

  // ── 不可重试 ──
  MODEL_NOT_FOUND      = 'MODEL_NOT_FOUND',
  SKILL_NOT_AVAILABLE  = 'SKILL_NOT_AVAILABLE',
  AUTH_FAILED          = 'AUTH_FAILED',
  CODE_EXECUTION_CRASH = 'CODE_EXEC_CRASH',
  CONTENT_FILTERED     = 'CONTENT_FILTERED',
}

export class OpenClawError extends Error {
  readonly type: OpenClawErrorType;
  readonly retryable: boolean;

  constructor(type: OpenClawErrorType, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OpenClawError';
    this.type = type;
    this.retryable = RETRYABLE_TYPES.has(type);
  }
}

const RETRYABLE_TYPES = new Set([
  OpenClawErrorType.LLM_TIMEOUT,
  OpenClawErrorType.LLM_RATE_LIMIT,
  OpenClawErrorType.JSON_PARSE_ERROR,
  OpenClawErrorType.GATEWAY_DISCONNECT,
]);
```

### 2. 重试装饰器 (`openclaw/retry.ts` — 新增)

```typescript
export interface RetryConfig {
  maxRetries: number;
  /** 退避策略：固定/指数/立即 */
  backoff: 'fixed' | 'exponential' | 'immediate';
  /** 基础延迟 (ms)，指数退避时每次翻倍 */
  baseDelayMs: number;
  /** 最大延迟上限 (ms)，防止指数退避失控。默认 30s */
  maxDelayMs?: number;
  /** 仅对这些错误类型重试（空 = 所有可重试类型） */
  retryOn?: OpenClawErrorType[];
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  logger?: (msg: string) => void,
): Promise<T> { ... }
```

- 不可重试错误 → 立即 rethrow
- 可重试错误 → 按 `RetryConfig` 策略重试
- 每次重试记录结构化日志 `[Retry] attempt 2/3 for LLM_TIMEOUT (delay: 4000ms)`
- 最终失败 → 抛出最后一个 `OpenClawError`

#### 默认重试配置表

```typescript
export const DEFAULT_RETRY_CONFIGS: Record<OpenClawErrorType, RetryConfig> = {
  [OpenClawErrorType.LLM_TIMEOUT]:        { maxRetries: 2, backoff: 'exponential', baseDelayMs: 2000 },
  [OpenClawErrorType.JSON_PARSE_ERROR]:    { maxRetries: 2, backoff: 'immediate',   baseDelayMs: 0 },
  [OpenClawErrorType.LLM_RATE_LIMIT]:      { maxRetries: 3, backoff: 'exponential', baseDelayMs: 5000 },
  [OpenClawErrorType.GATEWAY_DISCONNECT]:  { maxRetries: 1, backoff: 'fixed',       baseDelayMs: 3000 },
};
```

### 3. `adapter.ts` 集成

- `extractLLMContent()` 中的错误检测 → 抛出分类化的 `OpenClawError`（而非通用 `Error`）
- `callLLM()` 内部包裹 `withRetry()`
- `executeCode()` 内部包裹 `withRetry()`

```typescript
// adapter.ts callLLM 改造示意
async callLLM(systemPrompt: string, userMessage: string, model?: string): Promise<LLMResponse> {
  return withRetry(
    async () => {
      const rawOutput = await this.transport.send(args, this.config.timeoutSeconds * 1000);
      const content = this.extractLLMContent(rawOutput); // 可能抛 OpenClawError
      return { content, rawOutput };
    },
    this.getRetryConfig(/* 根据错误类型动态选择 */),
    (msg) => console.log(`[OpenClawAdapter] ${msg}`),
  );
}
```

### 4. 错误检测增强 (`extractLLMContent` 改造)

现有检测逻辑（`gateway connect failed` 等）→ 升级为分类化错误。

**所有模式均增加了 context 门控**，防止 LLM 内容中的随意提及触发误报：

| 匹配模式 | 错误类型 | Context 门控 |
|---------|---------|-------------|
| `gateway connect failed` / `gateway closed` | `GATEWAY_DISCONNECT` | `startsWith` 锚定 |
| `rate.?limit` + context / `429` + context / `too many requests` | `LLM_RATE_LIMIT` | error/http/status/exceeded/429 |
| `timeout` + context | `LLM_TIMEOUT` | error/failed/exceeded/kill/CLI/`after\s+\d` |
| `model.?not.?found` + context / `invalid.?model` + context | `MODEL_NOT_FOUND` | error/failed/unknown/specified/id/name |
| `content.?filter` + context / `safety` + action | `CONTENT_FILTERED` | blocked/triggered/rejected/moderation/policy |
| `unauthorized` + context / `invalid.?api.?key` | `AUTH_FAILED` | `4\d{2}`/error/http/status/response/failed |
| JSON.parse 失败 / 空输出 | `JSON_PARSE_ERROR` | 无需门控（结构化检测） |
| CLI 传输层超时 (`CLI timeout`) | `LLM_TIMEOUT` | `wrapError` 中 `/CLI timeout/i` |

## 交付物

| 文件 | 实际行数 | 说明 |
|------|---------|------|
| `openclaw/errors.ts` | 126 行 | `OpenClawError` + 枚举 + 6 个 context-gated 分类模式 |
| `openclaw/retry.ts` | 147 行 | `withRetry` + `computeDelay`(30s cap) + `getRetryConfigForType` + 默认配置表 |
| `openclaw/adapter.ts` | ~50 行改动 | 错误分类 + `callLLM`/`executeCode` 包裹 `withRetry` + `wrapError` CLI 超时分类 |
| `tests/openclaw/errors.test.ts` | 193 行 | 40 tests — 所有模式 + 7 个 false-positive 防护 + 模式优先级 |
| `tests/openclaw/retry.test.ts` | 265 行 | 22 tests — 退避策略 + 30s cap + maxRetries=0 + 错误类型变化 + getRetryConfigForType |
| `tests/openclaw/adapter.test.ts` | ~80 行新增 | 7 新 tests — executeCode error/retry + wrapError edge cases + ANSI stripping |

## 验收维度

- [x] 可重试错误 → 按配置执行重试 + 正确退避
- [x] 不可重试错误 → 立即传播，零重试
- [x] 结构化日志 `[Retry] attempt 2/3 for LLM_TIMEOUT (delay: 4000ms)`
- [x] `callLLM` 遇到 Gateway 断连 → 重试 → 仍失败则 `OpenClawError` 上报
- [x] JSON 解析失败 → 重试 → 成功则返回正确结果
- [x] 每种错误类型的重试/不重试行为均有单测
- [x] 所有现有测试通过（回归）— 324 tests (242 原有 + 82 新增)
- [x] `npm run build` 零 TypeScript 报错
- [x] 深度审查 7 轮，修复 17 个 Bug（2 Critical + 9 Medium + 4 Low + 2 Test-only）

### 审查轮次概要

| 轮次 | 策略 | 发现 |
|------|------|------|
| R1 | 逻辑审查 | 4 bugs — CLI timeout 未分类, 日志格式, 429/safety 误报 |
| R2 | Regex 自匹配分析 | 3 bugs — timeout 误报, timed?.?out 自匹配, \b 数字边界 |
| R3 | 架构审查 | 3 bugs — rate.?limit 无门控, 指数退避无上限, 注释失实 |
| R4 | Node.js REPL 对抗 | 3 bugs — \d{3} 匹配 200, model_not_found 无门控 |
| R5 | REPL 全量爆破 | 3 bugs — AUTH [1-5]\d{2} 过宽, rate 'response' 误触 |
| R6 | 全模式 REPL 覆盖 | 1 bug — content.?filter 无门控 |
| R7 | 变异测试分析 | 0 code bugs, 6 覆盖盲区补测 |
