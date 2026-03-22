# OpenClaw-Republic 项目上下文 (CONTEXT)

> **用途**：每次新开 AI 会话时 `@` 本文件，即可快速恢复项目完整上下文。
> **最后更新**：2026-03-21

### 📖 如何使用本文档

| 场景 | 你给 AI 发什么 | 说明 |
|------|--------------|------|
| **新会话开工** | `@CONTEXT.md` + "继续做 Phase 0" | 本文件轻量，给 AI 全局视野 + 当前进度 |
| **讨论产品需求** | `@CONTEXT.md` + `@PRD_v3.md` | PRD 有完整的产品定义、场景描述、事件映射 |
| **开始写代码** | `@CONTEXT.md` + `@development_master_plan_ts.md` | Master Plan 有翻译清单、文件对照表、架构图 |
| **具体 Task 执行** | `@CONTEXT.md` + `@plan_ts/某个task.md` | Task 文档有详细的验收标准和实现步骤 |
| **翻译 Python 代码** | `@CONTEXT.md` + `@某个Python源文件` | 直接看 Python 源码作为翻译蓝本 |

> **原则**：CONTEXT.md 每次都带（记忆入口），其他文档按需引用（深入细节）。

---

## 一句话定位

基于 [OpenClaw](https://github.com/openclaw/openclaw) Skill 引擎，以美式**三权分立（Separation of Powers）**为编排范式的多 Agent 协作系统，配有像素风 8-bit 实时演播厅前端。

---

## 关键架构决策 (ADR)

| # | 决策 | 结论 | 日期 |
|---|------|------|------|
| 1 | 后端语言 | **TypeScript** (Node.js 20+)，替代原 Python 版 | 2026-03-21 |
| 2 | 底层 Skill 引擎 | **OpenClaw Gateway**（60+ Skill、LLM Provider、渠道接入） | 2026-03-21 |
| 3 | 前端 | **完全复用**现有 Phaser.js 像素演播厅（`frontend/`），零改动 | 2026-03-21 |
| 4 | 前后端契约 | **WebSocket JSON 事件格式不变**（10 种 EventAction），前端 `EventMapper.ts` 为准 | 2026-03-21 |
| 5 | 与 danghuangshang 的差异 | 它是纯配置集权制；我们是独立编排层 + 辩论引擎 + 像素前端 | 2026-03-21 |
| 6 | 开发策略 | 先做 T0 探针（跑通 OpenClaw），再拆细化 Task | 2026-03-21 |

---

## 项目进度

### ✅ 已完成 (Python 版 Phase 0~3)

- **Phase 0** — 项目脚手架、SOUL.md 人设、constitution.yaml 宪法
- **Phase 1** — 三权 Agent 状态机（RBAC、辩论引擎、Conflict Score、执行引擎、司法审查）
- **Phase 2** — FastAPI + WebSocket 通信桥接层
- **Phase 3** — Phaser.js 像素演播厅前端（三大场景 + 音效 + E2E 联调）

> Python 代码保留在 `openclaw_republic/`，作为 TS 翻译参考。

### 🔄 当前阶段：TS 重构

进度跟踪以 `docs/development_master_plan_ts.md` 为准：

- [ ] **Phase 0** — TS 脚手架 + OpenClaw Gateway 连通性验证
- [ ] **Phase 1** — 核心编排层翻译 (Python → TS)
- [ ] **Phase 2** — Server 层 + WebSocket（前端打通）
- [ ] **Phase 3** — OpenClaw 深度集成（真实 LLM + Skill）
- [ ] **Phase 4** — UX 优化 & 产品化
- [ ] **Phase 5** — 极致发布

---

## 核心文档索引

| 文档 | 路径 | 说明 |
|------|------|------|
| **PRD v3** | `docs/prds/PRD_v3.md` | 产品需求（含 §1.2 OpenClaw 关系说明） |
| **TS 主线计划** | `docs/development_master_plan_ts.md` | 当前活跃的开发路线图 |
| **Python 旧计划** | `docs/development_master_plan.md` | ⚠️ 已归档 |
| **Python Task 文档** | `docs/plan_python/` | Phase 0~3 已完成；Phase 4~6 可参考 |
| **TS Task 文档** | `docs/plan_ts/` | 待 Phase 0 探针完成后填充 |
| **宪法配置** | `config/constitution.yaml` | 全局红线配置 |
| **SOUL 人设** | `config/souls/*.md` | 7 个 Agent 的人设文件 |

---

## 六大不变量

重构过程中绝对不能破坏的约束：

1. **WebSocket 事件格式** — 前端 `EventMapper.ts` 期望的 JSON 结构不变
2. **法案生命周期状态机** — 11 状态 + 合法转换表不变
3. **RBAC 权限模型** — 5 权限 × 3 分支 不变
4. **constitution.yaml 格式** — 用户配置兼容
5. **SOUL.md 文件格式** — Markdown 人设文件兼容
6. **前端代码零改动** — 除非有明确功能增强需求

---

## 目录结构概览

```
openclaw_trias/
├── backend/              # TS 新后端 (待创建)
├── frontend/             # ✅ Phaser.js 像素演播厅 (复用)
├── openclaw_republic/    # Python 旧后端 (归档, 翻译参考)
├── config/               # SOUL.md + constitution.yaml
├── docs/
│   ├── prds/PRD_v3.md
│   ├── development_master_plan_ts.md  # 主线计划
│   ├── development_master_plan.md     # 旧计划 (归档)
│   ├── plan_python/                   # Python 版 Task 文档
│   └── plan_ts/                       # TS 版 Task 文档 (待填充)
├── tests/
└── CONTEXT.md            # ← 本文件
```
