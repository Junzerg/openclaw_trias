# Phase 0 · TypeScript 项目脚手架 & OpenClaw 集成

> **目标**：搭建 TypeScript 后端项目骨架，完成与 OpenClaw Gateway 的连通性验证。
> **前置依赖**：无
> **预估复杂度**：⭐ 低
> **优先级**：🔴 首先 — 一次性搭好，验证底层的 LLM 和工具执行能力，后续全部依赖此基础设施。

---

## 0.1 TS 后端项目初始化

- 创建 `package.json`（设定 `"type": "module"`）
- 配置 `tsconfig.json`（设定 `ES2022`, `Node16` resolution 等）
- 开发依赖：`typescript`, `vitest`, `eslint`
- 运行时依赖：`zod`, `ws`, `yaml`
- 创建初始测试与 lint 脚本，设置后端代码入口。

## 0.2 Monorepo 目录规划

调整顶层目录，将 TS 后端放在 `backend/` 下，与现有 `frontend/`、`config/` 等同级。旧版本 Python 代码归档在 `openclaw_republic/` 仅作参考。

```text
openclaw_trias/                            # Git 仓库根目录
├── backend/                               # TS 新后端 ← 本次重写目标
│   ├── src/
│   │   ├── index.ts                       # 入口
│   │   ├── government.ts                  # CyberGovernment 主编排
│   │   ├── agents/                        # 角色抽象与实现
│   │   ├── bus/                           # 消息总线与状态机
│   │   ├── schemas/                       # 数据校验与类型定义 (Zod)
│   │   ├── config/                        # 配置加载
│   │   ├── openclaw/
│   │   │   └── adapter.ts                 # OpenClaw Gateway 适配层
│   │   └── server/                        # WebSocket / HTTP 服务层
│   └── tests/                             # 自动化测试代码 (Vitest)
├── config/                                # 用户可编辑配置区 (SOUL.md 等共享文件)
├── frontend/                              # 前端工程 (复用)
└── docs/                                  # 相关文档
```

## 0.3 OpenClaw Gateway 安装 & 部署

- 本地全局安装 OpenClaw CLI 并配置守护进程。
- 配置 LLM Provider 模型（如 zai/glm-5 或相应 API Keys）。
- 启动 Gateway 服务并在本地 `ws://127.0.0.1:18789` 可供连接。

## 0.4 OpenClaw 适配层 (`openclaw/adapter.ts`)

- 封装与 OpenClaw 的通信层，对外屏蔽 CLI 或 WebSocket 细节（Phase 0 使用 CLI subprocess 绕过复杂握手，后续 Phase 3 升级为 websocket）。
- 核心功能要求：
  - `healthCheck()`: 检查 CLI 和 Gateway 状态。
  - `callLLM(systemPrompt, userMessage)`: 发起纯大语言模型调用。
  - `executeCode(code, language)`: 触发 OpenClaw 内置工具（例如 `exec`）执行特定代码。

## 0.5 连通性验证

对上述实现，必须通过真实的大模型侧与执行引擎测试：
- 通过适配层发送一个打招呼 Prompt，能获得正确的 LLM 回复。
- 派发一小段 Javascript/TypeScript 执行，成功获取包含 stdout 等执行环境回显的结果。

---

## Task 拆分

Phase 0 拆分为如下具体开发任务：

| Task | 标题 | 涵盖子项 | 预估 | 状态 |
|------|------|---------|------|------|
| [Task 0-A](task0.1_project_skeleton.md) | 项目骨架与 OpenClaw 配置 | 0.1 + 0.2 + 0.3 | 1 会话 | ✅ 已完成 |
| [Task 0-B](task0.2_adapter_and_testing.md) | 适配层实现与测试验证 | 0.4 + 0.5 | 1 会话 | ✅ 已完成 |

**依赖关系**：`Task 0-A` → `Task 0-B`

---

## 验收标准

- [x] 后端 `package.json` 配置能够安装与编译通过 (`npm install`, `npx tsc --noEmit`)。
- [x] OpenClaw CLI 可在终端与代码环境中成功调用，并连接到合法 Gateway。
- [x] 完成 `adapter.ts` 的编写。
- [x] `npm run smoke` 可顺利完整跑通连通测试（Health Check，LLM 调用，环境执行）。
- [x] 成功规避或记录了相关的环境通信“坑点”（如控制台 ANSI 代码、Vitest stdio 被拦截等问题），形成技术备忘。

---

## 后续衔接

Phase 0 完成后，将拥有稳固的执行底座，随后直接进入 → [Phase 1 · 代理基类与沙箱调度封装](../phase1/phase1_overview.md)
