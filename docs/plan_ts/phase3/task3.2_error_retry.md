# Task 3.2: 错误分类与重试基础设施

> **目标**：建立统一的非确定性错误分类体系和通用重试装饰器，供 Task 3.4~3.7 消费。
> **前置依赖**：[Task 3.1](task3.1_adapter_async.md)（异步 adapter 才能实现异步重试）
> **对应目录**：`backend/src/openclaw/`
> **预估耗时**：0.5 会话

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

现有检测逻辑（`gateway connect failed` 等）→ 升级为分类化错误：

| 匹配模式 | 错误类型 |
|---------|---------|
| `gateway connect failed` / `gateway closed` | `GATEWAY_DISCONNECT` |
| `rate limit` / `429` / `too many requests` | `LLM_RATE_LIMIT` |
| `timeout` / CLI 超时 kill | `LLM_TIMEOUT` |
| `model not found` / `invalid model` | `MODEL_NOT_FOUND` |
| `content_filter` / `safety` | `CONTENT_FILTERED` |
| JSON.parse 失败 | `JSON_PARSE_ERROR` |
| `unauthorized` / `invalid api key` | `AUTH_FAILED` |

## 交付物

| 文件 | 行数(预估) | 说明 |
|------|-----------|------|
| `openclaw/errors.ts` | ~60 | `OpenClawError` + 枚举 + 错误工厂 |
| `openclaw/retry.ts` | ~80 | `withRetry` 通用重试 + 默认配置表 |
| `openclaw/adapter.ts` | ~30 行改动 | 错误分类 + 重试包裹 |
| `tests/openclaw/errors.test.ts` | ~50 | 错误分类单测 |
| `tests/openclaw/retry.test.ts` | ~120 | 重试策略 + 退避时间 + mock timer 测试 |

## 验收维度

- [ ] 可重试错误 → 按配置执行重试 + 正确退避
- [ ] 不可重试错误 → 立即传播，零重试
- [ ] 结构化日志 `[Retry] attempt 2/3 for LLM_TIMEOUT (delay: 4000ms)`
- [ ] `callLLM` 遇到 Gateway 断连 → 重试 1 次 → 仍失败则 `OpenClawError` 上报
- [ ] JSON 解析失败 → 重试 → 成功则返回正确结果
- [ ] 每种错误类型的重试/不重试行为均有单测
- [ ] 所有现有 242 测试通过（回归）
- [ ] `npm run build` 零 TypeScript 报错
