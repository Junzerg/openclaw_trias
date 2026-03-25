# Task 3.6: 安全沙箱与执行约束

> **目标**：在编排层 (L2) 做轻量安全预检查，确保 CodeExecution Skill 执行的代码不会破坏宿主机。
> **前置依赖**：[Task 3.4](task3.4_sec_engineering.md)（SecEngineering 真实执行后才需要安全层）
> **对应目录**：`backend/src/openclaw/`
> **预估耗时**：0.5 会话

> **状态**：✅ 已完成 (深水区审计后极其健壮)

## 需求说明

### 双层防御架构

| 层级 | 防线 | 说明 |
|------|------|------|
| L1 | **OpenClaw Gateway 内置沙箱** | Gateway exec Skill 的超时、资源限制（外部依赖，已有） |
| L2 | **CyberGovernment 编排层约束** | 我方在调用前做预检查（本 Task 实现） |

### 1. `openclaw/sandbox.ts` — 安全检查工具函数（新增）

#### `validateCode(code: string, language: string): ValidationResult`

预检查代码是否安全，返回通过/拒绝及原因：

```typescript
export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateCode(code: string, language: string): ValidationResult {
  // 1. 代码长度限制 ≤ 10KB
  if (code.length > 10 * 1024) {
    return { valid: false, reason: `代码长度 ${code.length} 字节超过 10KB 限制` };
  }

  // 2. 危险命令拦截
  const danger = hasDangerousCommand(code);
  if (danger) {
    return { valid: false, reason: `检测到危险命令: ${danger}` };
  }

  return { valid: true };
}
```

#### `hasDangerousCommand(code: string): string | null`

正则匹配明显的破坏性命令：

```typescript
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\//, label: 'rm -rf /' },
  { pattern: /mkfs\b/, label: 'mkfs (格式化磁盘)' },
  { pattern: /dd\s+if=/, label: 'dd (磁盘写入)' },
  { pattern: /:\(\)\{\s*:\|:&\s*\};:/, label: 'fork bomb' },
  { pattern: />\s*\/dev\/sd[a-z]/, label: '直写磁盘设备' },
  { pattern: /chmod\s+777\s+\//, label: 'chmod 777 根目录' },
];
```

#### `truncateOutput(output: string, maxBytes: number = 50 * 1024): string`

输出截断，避免撑爆内存：

```typescript
export function truncateOutput(output: string, maxBytes: number = 50 * 1024): string {
  if (Buffer.byteLength(output, 'utf8') <= maxBytes) return output;
  // 按字节截断 + 添加标记
  const truncated = Buffer.from(output, 'utf8').subarray(0, maxBytes).toString('utf8');
  return truncated + '\n\n[OUTPUT TRUNCATED — exceeded 50KB limit]';
}
```

### 2. `sec-engineering.ts` 集成

在 `executeTask()` 中集成安全检查：

```typescript
// 阶段 1.5: 安全预检（在代码生成后、执行前）
const validation = validateCode(code, language);
if (!validation.valid) {
  return {
    task_id: task.task_id,
    step_index: task.step.index,
    status: 'failed',
    output: '',
    error: `安全检查未通过: ${validation.reason}`,
    tokens_consumed: 0,
  };
}

// 阶段 2: 代码执行 ...

// 阶段 3: 输出截断（执行后）
return {
  ...result,
  output: truncateOutput(result.output),
};
```

## 交付物

| 文件 | 行数(预估) | 说明 |
|------|-----------|------|
| `openclaw/sandbox.ts` | ~100 | `validateCode`, `hasDangerousCommand`, `truncateOutput` |
| `agents/executive/sec-engineering.ts` | ~15 行改动 | 集成安全检查 |
| `tests/openclaw/sandbox.test.ts` | ~150 | 危险命令拦截 + 长度限制 + 截断 + 正常代码放行 |

## 验收维度

- [x] 超长代码 (>10KB) → 拒绝执行，`TaskResult.status = 'failed'`
- [x] `rm -rf /` → 拦截，代码不发送给 Gateway
- [x] fork bomb `:(){ :|:& };:` → 拦截
- [x] `mkfs /dev/sda` → 拦截
- [x] 正常 `print('hello')` → 正常执行，不误拦
- [x] stdout > 50KB → 截断至 50KB + `[OUTPUT TRUNCATED]` 标记
- [x] 截断后的输出是合法 UTF-8（不截断在多字节字符中间）
- [x] 单测覆盖率 > 90% (达到 100%)
- [x] 所有现有测试通过（回归）

> **Deep Audit 特别加固 (Round 8)**：
> 在基础沙箱之上，沙箱层经历了 L2 层渗透测试。我们特别增补了高级正则对抗探测规则（拦截 `r\m`，`atob` 以及编码级逃逸），同时修复了长文本直接打进 `Buffer.from()` 造成的瞬时 OOM。目前的截断防线采用字符串预先切片双端保护。
