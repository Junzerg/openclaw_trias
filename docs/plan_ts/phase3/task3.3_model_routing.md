# Task 3.3: 模型路由与 Agent 配置

> **目标**：让不同 Agent 使用不同 LLM 模型，**完全由用户在 `constitution.yaml` 中灵活配置**。
> **前置依赖**：[Task 3.1](task3.1_adapter_async.md)（adapter 需支持 per-call model 参数）
> **对应目录**：`backend/src/config/`, `backend/src/agents/`, `backend/src/openclaw/`
> **预估耗时**：0.5 会话

## 需求说明

### 1. 配置格式 (`constitution.yaml` 新增段)

```yaml
# model_routing 段（整段可选，缺失则所有 Agent 使用 adapter.defaultModel）
model_routing:
  # 全局默认（必填，如果 model_routing 段存在）
  default: "anthropic/claude-sonnet-4-20250514"

  # 按角色覆盖（可选，未列出的角色使用 default）
  overrides:
    chief_justice: "anthropic/claude-opus-4-20250514"
    radical_mp: "deepseek/deepseek-chat"
    conservative_mp: "deepseek/deepseek-chat"
    # speaker, president, sec_engineering, sec_state → 使用 default
```

### 2. Zod Schema (`config/models.ts` 修改)

```typescript
export const ModelRoutingConfigSchema = z.object({
  default: z.string().describe('全局默认模型标识符'),
  overrides: z.record(z.string(), z.string()).optional()
    .describe('role → model 覆盖映射表'),
}).optional();

export type ModelRoutingConfig = z.infer<typeof ModelRoutingConfigSchema>;
```

> **向后兼容**：整个 `model_routing` 段为 `optional()`，不存在时走 `adapter.config.defaultModel`。

### 3. 配置加载 (`config/loader.ts` 修改)

- `loadConstitution()` 解析 `model_routing` 段
- 返回的 `ConstitutionConfig` 新增 `model_routing?: ModelRoutingConfig` 字段
- 提供 `resolveModel(role: string, config?: ModelRoutingConfig): string | undefined` 工具函数

```typescript
export function resolveModel(role: string, routing?: ModelRoutingConfig): string | undefined {
  if (!routing) return undefined;  // adapter 使用内置 defaultModel
  return routing.overrides?.[role] ?? routing.default;
}
```

### 4. Agent 基类 (`base.ts` 修改)

- 新增 `modelRef?: string` 实例属性
- `callLLM()` 调用时传入 `this.modelRef`

```typescript
export abstract class BaseAgent {
  public modelRef?: string;  // 新增

  protected async callLLM(prompt: string): Promise<LLMResponse> {
    // 传入 modelRef 给 adapter
    return await this.adapter.callLLM(this.systemPrompt, prompt, this.modelRef);
  }
}
```

### 5. Adapter (`adapter.ts`修改)

- `callLLM` 和 `executeCode` 签名增加可选 `model` 参数
- 如果传入 `model`，注入 `OPENCLAW_MODEL` 环境变量到 Node.js Spawn 进程中（因为 OpenClaw 原生暂不支持 `--model` 命令行标志）

```typescript
async callLLM(systemPrompt: string, userMessage: string, model?: string): Promise<LLMResponse> {
  const args = ['agent', '--agent', this.config.agentId, '--message', fullMessage];
  // model 优先级：显式传入 > config.defaultModel > 不传
  const effectiveModel = model ?? this.config.defaultModel;
  const envOverride: NodeJS.ProcessEnv = {};
  if (effectiveModel) {
    envOverride.OPENCLAW_MODEL = effectiveModel;
  }
  return await this.runCliCommand(args, envOverride);
}
```

### 6. Government 注入 (`government.ts` 修改)

初始化各 Agent 后，从 `constitution.model_routing` 注入 `modelRef`：

```typescript
private _applyModelRouting(): void {
  const routing = this.constitution.model_routing;
  if (!routing) return;

  const agents = [
    this.speaker, this.radicalMp, this.conservativeMp,
    this.president, this.secEngineering, this.secState,
    this.chiefJustice,
  ];

  for (const agent of agents) {
    agent.modelRef = resolveModel(agent.role, routing);
  }
}
```

## 交付物

| 文件 | 行数(预估) | 说明 |
|------|-----------|------|
| `config/models.ts` | ~15 行新增 | `ModelRoutingConfigSchema` |
| `config/loader.ts` | ~15 行新增 | 解析 + `resolveModel()` |
| `constitution.yaml` | ~10 行新增 | `model_routing` 示例配置 |
| `agents/base.ts` | ~5 行改动 | `modelRef` 属性 + callLLM 传参 |
| `openclaw/transport.ts` | ~10 行改动 | `ITransport.send` 增加 `env` 重载参数 |
| `openclaw/adapter.ts` | ~15 行改动 | `callLLM` & `executeCode` 增加 `OPENCLAW_MODEL` 注入 |
| `government.ts` | ~15 行新增 | `_applyModelRouting()` 注入 |
| `tests/config/model-routing.test.ts` | ~200 | Zod 校验 + fallback + 注入链 + 拦截验证 |

## 验收维度

- [x] `constitution.yaml` 新增 `model_routing` 段，用户可自由配置 `role → model`
- [x] LLM 调用日志中可见 `OPENCLAW_MODEL=xxx` 参数正确传递
- [x] `model_routing` 段缺失 → `resolveModel` 返回 `undefined` → adapter 使用内置 `defaultModel`（向后兼容）
- [x] `overrides` 中未列出的角色 → 使用 `model_routing.default`
- [x] `overrides` 中列出的角色 → 使用指定模型
- [x] Zod schema 校验：缺少 `default` 字段 → 报错
- [x] 所有现有测试通过（回归）
- [x] `npm run build` 零 TypeScript 报错
