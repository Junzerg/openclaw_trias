# OpenClaw 集成踩坑笔记 (Phase T0)

> **日期**：2026-03-21
> **版本**：OpenClaw 2026.3.13

---

## 1. Gateway 架构要点

| 项目 | 内容 |
|------|------|
| **控制平面** | 单一 WebSocket Gateway（默认 `ws://127.0.0.1:18789`） |
| **Wire 协议** | JSON 文本帧：`{type:"req", id, method, params}` → `{type:"res", id, ok, payload|error}` |
| **事件推送** | `{type:"event", event, payload, seq?, stateVersion?}` |
| **握手流程** | `connect.challenge`(nonce) → `connect`(设备 ID + 公钥 + 签名 + 角色 + scopes) → `hello-ok` |
| **协议版本** | v3（`minProtocol: 3, maxProtocol: 3`） |
| **认证** | 设备配对 + 可选 token（`OPENCLAW_GATEWAY_TOKEN` 环境变量） |

### 1.1 握手复杂度

直接用 WebSocket 连接 Gateway 需要：
1. 生成设备 ID 和密钥对
2. 签名 challenge nonce（v3 签名还绑定 platform + deviceFamily）
3. 首次连接需配对批准

**Phase T0 决策**：使用 CLI 子进程（`openclaw agent --message`）绕过握手复杂度。Phase T3 再实现完整 WebSocket 客户端。

---

## 2. 内置工具 (Built-in Tools)

| 工具名 | 用途 | 我们需要的 |
|--------|------|-----------|
| `exec` | 执行 shell 命令 | ✅ 代码执行（工程部长） |
| `process` | 管理长运行进程 | ✅ 配合 exec 使用 |
| `browser` | CDP 控制 Chrome | 🔲 可能用于国务卿 |
| `web_search` / `web_fetch` | 网页搜索/获取 | 🔲 国务卿搜索能力 |
| `read` / `write` / `edit` | 文件操作 | ✅ 代码生成 |
| `sessions_list` | 列出活跃会话 | ✅ Agent 间通信 |
| `sessions_send` | 发消息给其他会话 | ✅ Agent 间通信 |
| `sessions_spawn` | 派生子 Agent | ✅ 多 Agent 编排 |
| `agents_list` | 列出可用 Agent | 🔲 |

### 2.1 exec 工具参数

```json
{
  "tool": "exec",
  "command": "node -e \"console.log('hello')\"",
  "workdir": "/path/to/dir",
  "timeout": 1800,
  "host": "sandbox|gateway|node",
  "yieldMs": 10000
}
```

关键点：
- `host` 默认 `sandbox`；沙箱关闭时 `host=sandbox` 会**报错**而非静默降级
- `yieldMs`：超过此时间自动转后台，需用 `process` 工具轮询
- 环境变量中会注入 `OPENCLAW_SHELL=exec`

### 2.2 process 工具

```json
{"tool": "process", "action": "poll", "sessionId": "<id>"}
{"tool": "process", "action": "send-keys", "sessionId": "<id>", "keys": ["Enter"]}
```

---

## 3. Session 工具 (Agent 间通信)

### 3.1 sessions_send

```json
{
  "sessionKey": "main",
  "message": "请执行这个任务...",
  "timeoutSeconds": 60
}
```

- `timeoutSeconds = 0`：fire-and-forget，返回 `{runId, status: "accepted"}`
- `timeoutSeconds > 0`：等待完成，返回 `{runId, status: "ok", reply}`
- 超时：返回 `{runId, status: "timeout"}`，任务继续运行

**自动 ping-pong**：发送后 OpenClaw 会在两个 Agent 间自动来回对话（最多 `maxPingPongTurns` 次，默认 5）。回复 `REPLY_SKIP` 可终止。

### 3.2 sessions_spawn

```json
{
  "task": "请写一个 hello world 程序",
  "label": "code-task",
  "model": "anthropic/claude-sonnet-4-20250514"
}
```

- 创建一个临时子 Agent 会话（`agent:<agentId>:subagent:<uuid>`）
- 非阻塞：立即返回 `{status: "accepted", runId, childSessionKey}`
- 子 Agent 默认**不能再 spawn**（防止无限递归）

---

## 4. 模型配置

格式：`provider/model`

示例：
- `anthropic/claude-sonnet-4-20250514`
- `openai/gpt-4.1`
- `openrouter/moonshotai/kimi-k2`（含 `/` 的模型 ID 需加 provider 前缀）

配置路径：`~/.openclaw/openclaw.json` → `agents.defaults.model`

---

## 5. CLI 调用方式

```bash
# 发送单条消息（最简单的集成方式）
openclaw agent --message "你好" --thinking high

# 发送消息并指定模型
openclaw agent --message "你好" --model anthropic/claude-sonnet-4-20250514

# 健康检查
openclaw doctor

# 启动 Gateway（前台，日志到 stdout）
openclaw gateway --port 18789 --verbose
```

---

## 6. Phase T0 适配层设计

```
我们的后端 → OpenClawAdapter → openclaw CLI (子进程) → Gateway → LLM/Tools
```

### 6.1 callLLM 实现

```typescript
// 通过 CLI 子进程调用，system prompt 合并到 message 中
execFile('openclaw', ['agent', '--message', fullPrompt])
```

**已知限制**：
- ❌ 无 streaming（CLI 是同步输出）
- ❌ 无精确的 token usage 统计
- ❌ 无法控制 temperature / top_p 等参数
- ✅ 但足以验证 LLM 连通性

### 6.2 executeCode 实现

```typescript
// 让 agent 调用 exec 工具
execFile('openclaw', ['agent', '--message', '使用 exec 工具执行: ...'])
```

**已知限制**：
- 额外多了一层 LLM 解析（agent 理解我们要执行代码，然后调用 exec）
- 输出可能夹杂 agent 的"注释"

---

## 7. 后续 Task 拆分建议

### Phase T3 需要实现的：

1. **完整 WebSocket 客户端**
   - 实现设备配对流程（生成密钥对、签名 challenge）
   - 直连 `ws://127.0.0.1:18789`
   - 处理事件推送（streaming）

2. **sessions_spawn 集成**
   - 每个 Agent（议长、议员、总统等）作为独立 session
   - 通过 `sessions_send` 实现 Agent 间消息传递

3. **exec 工具直接调用**
   - 不再经过 LLM 转译，直接构造 exec 工具调用
   - 需要研究 Gateway 的 tool invocation API

4. **模型路由**
   - 不同 Agent 使用不同模型（辩论用 Sonnet，审查用 Opus）
   - 通过 `sessions_spawn` 的 `model` 参数实现

### 关键技术风险：

| 风险 | 说明 | 预案 |
|------|------|------|
| WebSocket 握手复杂 | 设备配对、签名等 | 先用 CLI，后续研究 OpenClaw 源码 |
| exec 沙箱限制 | 默认 sandbox 模式可能限制功能 | 可切换到 `host=gateway`（需审批） |
| Agent 间通信延迟 | `sessions_send` 的 ping-pong 机制 | 用 `REPLY_SKIP` 控制轮次 |
| token 成本 | 每次 CLI 调用都是独立会话 | 开发时用廉价模型 |

## 8. 踩坑记录

### 坑 1：CLI stdout 含 ANSI 转义码

OpenClaw CLI 的 stdout 中 `[plugins]` 等日志行带有 ANSI 颜色代码（如 `\x1b[35m[plugins]\x1b[39m`）。
必须先 `replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')` 去色后再做正则过滤，否则 `/^\[[\w_]+\]/` 无法匹配。

### 坑 2：CLI 需要 `--agent main`

`openclaw agent --message "..."` 单独调用会报 `Pass --to <E.164>, --session-id, or --agent to choose a session`。
必须加 `--agent main`（或其他已配置的 agent ID）。

### 坑 3：Vitest 进程无法捕获 CLI 输出

OpenClaw CLI 在 Vitest 的 fork 工作进程中运行时，`child_process.execFile` 和 `execSync` 的 stdout/stderr 均为空。
即使用 shell 重定向到临时文件也为空。原因疑似 CLI 使用了 TTY/pty 相关 I/O。

**解决方案**：单元测试放 Vitest（`npm test`），集成验证用 smoke test（`npm run smoke`）。

### 坑 4：火山引擎 Coding Plan 过期

onboard 默认选择的 `volcengine-plan/ark-code-latest` 模型需要有效的 Coding Plan 订阅。
配置切换到 `zai/glm-5`（智谱 GLM）后恢复正常。
注意检查 `~/.openclaw/openclaw.json` → `agents.defaults.model.primary`。

---

## 9. 验证清单

- [x] OpenClaw CLI 安装成功 (`2026.3.13`)
- [x] `openclaw onboard` 完成配置（使用 zai/glm-5）
- [x] Gateway 启动成功（LaunchAgent 方式）
- [x] `openclaw agent --agent main --message "hello"` 获得回复
- [x] `adapter.healthCheck()` 返回全部通过
- [x] `adapter.callLLM()` 获得真实 LLM 回复（"连通成功"）
- [x] `adapter.executeCode()` 执行代码成功（"hello from openclaw", "4"）

