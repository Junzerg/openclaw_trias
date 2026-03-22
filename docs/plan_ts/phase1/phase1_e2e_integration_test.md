# Phase 1 · 端到端联调测试计划

> **目标**：覆盖 Phase 1 全部 8 个 Task 构建的核心编排层，验证从选民请愿（Petition）到最终交付（Delivered）的完整生命周期，包含所有分支路径和边界条件。
> **工具**：Vitest（mock 模式，不依赖真实 LLM/OpenClaw Gateway）
> **测试文件**：`backend/tests/e2e/phase1-e2e.test.ts`
> **运行命令**：`cd backend && npx vitest run tests/e2e/phase1-e2e.test.ts`

---

## 一、测试矩阵总览

> 🎯 覆盖 PRD §6.1 状态机的 **11 个状态** 和 **全部合法转换路径**（含 2 条回路 + 1 个终态），以及 PRD §4 的 **9 种 WebSocket 事件类型**。

### 1.1 生命周期主路径（Happy Path）

| # | 场景 | 覆盖状态链 | 覆盖事件 |
|---|------|-----------|---------|
| E2E-HP-01 | 🟢 **完整成功路径** | PETITION → DRAFTING → DEBATING → VOTED → SIGNED → EXECUTING → REVIEWING → CONSTITUTIONAL → DELIVERED | `propose`, `vote_passed`, `sign_act`, `tool_call`, `constitutional`, `state_change` |

### 1.2 回路路径（Retry Loops）

| # | 场景 | 覆盖状态链 | 覆盖事件 |
|---|------|-----------|---------|
| E2E-VETO-01 | 🟡 **总统否决 → 重试成功** | …→ VOTED → VETOED → DRAFTING → …→ SIGNED → …→ DELIVERED | `veto`, `sign_act` |
| E2E-VETO-02 | 🔴 **总统连续否决 → 耗尽重试** | …→ VOTED → VETOED → DRAFTING → VOTED → VETOED → 终止 | `veto` ×2 |
| E2E-UNCN-01 | 🟡 **违宪驳回 → 重试成功** | …→ REVIEWING → UNCONSTITUTIONAL → DRAFTING → …→ CONSTITUTIONAL → DELIVERED | `unconstitutional`, `constitutional` |
| E2E-UNCN-02 | 🔴 **连续违宪 → 耗尽重试** | …→ UNCONSTITUTIONAL → DRAFTING → …→ UNCONSTITUTIONAL → 终止 | `unconstitutional` ×2 |
| E2E-MIX-01 | 🟡 **第一轮否决 + 第二轮违宪 → 耗尽** | …→ VETOED → DRAFTING → …→ UNCONSTITUTIONAL → 终止 | `veto`, `unconstitutional` |

### 1.3 辩论引擎分支（DebateEngine）

| # | 场景 | 覆盖机制 | 覆盖事件 |
|---|------|---------|---------|
| E2E-DEB-01 | 🟢 **正常收敛（Lv1）** | conflict_score < consensus_threshold 在 min_rounds 后退出 | `propose` |
| E2E-DEB-02 | 🟡 **高冲突触发议长控场（Lv2）** | conflict_score > conflict_threshold，议长 intervene | `brawl`, `order` |
| E2E-DEB-03 | 🔴 **极端冲突强制终止（Lv3, score≥90）** | 辩论 break，强制进入表决 | `brawl`, `order` |
| E2E-DEB-04 | **达到 max_rounds 自然终止** | 消耗完最大轮次后退出 | `propose` ×N |

### 1.4 行政分支分支（Executive）

| # | 场景 | 覆盖机制 | 覆盖事件 |
|---|------|---------|---------|
| E2E-EXE-01 | 🟢 **多步并行执行 + 拓扑排序** | Kahn 算法分层并行执行 | `tool_call` ×N |
| E2E-EXE-02 | 🟡 **步骤失败 → 下游跳过** | 失败传播 + skipped 标记 | `tool_call` (failed) |
| E2E-EXE-03 | 🟡 **Token 预算超限 → 总统否决** | President.evaluateAct token check | `veto` |
| E2E-EXE-04 | 🟡 **Skill 不可用 → 总统否决** | President.evaluateAct skill check | `veto` |
| E2E-EXE-05 | 🟢 **工程部长 & 国务卿路由** | CodeExecution→SecEng, Search→SecState | `tool_call` |

### 1.5 司法分支分支（Judicial）

| # | 场景 | 覆盖机制 | 覆盖事件 |
|---|------|---------|---------|
| E2E-JUD-01 | 🟢 **合宪通过** | deviation_score ≤ max_score | `constitutional` |
| E2E-JUD-02 | 🔴 **偏离度超标 → 违宪** | deviation_score > max_score | `unconstitutional` |
| E2E-JUD-03 | 🔴 **危险指令熔断（黑名单拦截）** | RulesEngine.checkCommand → 直接违宪 | `unconstitutional` |
| E2E-JUD-04 | 🔴 **KillSwitch 触发 + 判决书生成** | issueJudgment → KillSwitch.execute | `unconstitutional` |

### 1.6 消息总线 & 事件完整性

| # | 场景 | 覆盖机制 |
|---|------|---------|
| E2E-BUS-01 | **事件日志完整性** | 完整 pipeline 后检查 bus.event_log 包含各阶段事件 |
| E2E-BUS-02 | **EventLogger 记录** | 检查 eventLogger.log 被正确调用 |
| E2E-BUS-03 | **跨分支事件订阅** | legislation / execution / judiciary / lifecycle 四主题全覆盖 |

### 1.7 RBAC & 权限隔离

| # | 场景 | 覆盖机制 |
|---|------|---------|
| E2E-RBAC-01 | **立法分支无执行权** | Speaker/MP 调用 EXECUTE 应抛 PermissionDeniedError |
| E2E-RBAC-02 | **行政分支无规划权** | Secretary 调用 PLAN 应抛 PermissionDeniedError |
| E2E-RBAC-03 | **司法分支有 MONITOR + KILL 权限** | ChiefJustice MONITOR 和 KILL 通过 |

### 1.8 状态机边界

| # | 场景 | 覆盖机制 |
|---|------|---------|
| E2E-SM-01 | **非法转换抛异常** | 尝试从 PETITION 直接跳到 SIGNED |
| E2E-SM-02 | **终态不可再转换** | DELIVERED 后任何 transition 都应抛异常 |

---

## 二、测试实现策略

### 2.1 Mock 层次

本联调测试在 **OpenClawAdapter 层** 进行 Mock（`adapter.callLLM`），让所有 Agent 的内部逻辑（RBAC、事件发射、状态机转换）运行真实代码。这样可以在不依赖外部 LLM 服务的情况下，验证整个编排层的正确性。

```
┌─────────────────────────────────────────┐
│  CyberGovernment (真实)                  │
│  ├── Speaker / MPs (真实)                │
│  ├── DebateEngine + ConflictScore (真实)  │
│  ├── President (真实)                     │
│  ├── ExecutionEngine (真实)               │
│  ├── SecEngineering / SecState (真实)     │
│  ├── ChiefJustice + RulesEngine (真实)    │
│  ├── MessageBus (真实)                    │
│  └── BillLifecycle (真实)                 │
│                                          │
│  ✂ Mock 层 ─────────────────────         │
│  └── OpenClawAdapter.callLLM (Mock)       │
└─────────────────────────────────────────┘
```

### 2.2 Mock 返回策略

| Agent 调用场景 | Mock 返回值 | 说明 |
|--------------|-----------|------|
| **RadicalMP.propose** | 激进提案文本 | 包含激进关键词触发 ConflictScore |
| **ConservativeMP.critique** | 包含 `反对`/`不可行` 的批评 | 用于拉高 ConflictScore |
| **ConservativeMP.rebut** | 包含 `部分同意` 的温和反驳 | 用于逐轮降低 ConflictScore |
| **RadicalMP.rebut** | 温和回应 | 配合 ConflictScore 收敛 |
| **Speaker.intervene** | 控场声明 | 当 conflict > threshold 时触发 |
| **Speaker.generateAct (内部 LLM)** | 精炼后的步骤描述 | 法案步骤生成 |
| **President.evaluateAct** | `[SIGN]` 或 `[VETO: 原因]` | 控制签署/否决 |
| **ChiefJustice (deviation scorer)** | `{"score": 0.1}` 或 `{"score": 0.8}` | 控制合宪/违宪 |

### 2.3 ConflictScore 精准控制

ConflictScoreEngine 是纯函数（基于关键词匹配），**不 Mock**。通过精心构造 LLM mock 返回文本中的对立/妥协/强度关键词来控制分歧度。

- **Lv1 (低冲突)**：critique 返回中等语气，无强对立关键词
- **Lv2 (高冲突)**：critique 包含大量 `反对! 荒谬! 绝对不行!` → score > conflict_threshold
- **Lv3 (极端冲突)**：critique 包含 `反对! 错误! 危险! 绝对不行! 必须拒绝!` + 大量感叹号 → score ≥ 90

---

## 三、实测结果

> ✅ **29/29 全部通过** — 运行时间 53ms（2026-03-22）
> 全量回归：85 passed / 1 pre-existing failure / 2 skipped

| 测试场景 | 状态 | 备注 |
|---------|------|------|
| E2E-HP-01 完整成功路径 | ✅ | 15ms |
| E2E-VETO-01 否决→重试成功 | ✅ | 2ms |
| E2E-VETO-02 连续否决→耗尽 | ✅ | 2ms |
| E2E-UNCN-01 违宪→重试成功 | ✅ | 3ms |
| E2E-UNCN-02 连续违宪→耗尽 | ✅ | 2ms |
| E2E-MIX-01 否决+违宪混合 | ✅ | 2ms |
| E2E-DEB-01 正常收敛(Lv1) | ✅ | 1ms |
| E2E-DEB-02 高冲突控场(Lv2) | ✅ | 2ms |
| E2E-DEB-03 极端冲突强制终止(Lv3) | ✅ | 2ms |
| E2E-DEB-04 max_rounds自然终止 | ✅ | 3ms |
| E2E-EXE-01 多步并行+拓扑排序 | ✅ | 2ms |
| E2E-EXE-02 步骤失败→下游跳过 | ✅ | 1ms |
| E2E-EXE-03 Token超限→否决 | ✅ | 0ms |
| E2E-EXE-04 Skill不可用→否决 | ✅ | 0ms |
| E2E-EXE-05 部长路由正确性 | ✅ | 0ms |
| E2E-JUD-01 合宪通过 | ✅ | 1ms |
| E2E-JUD-02 偏离度超标→违宪 | ✅ | 1ms |
| E2E-JUD-03 危险指令熔断 | ✅ | 1ms |
| E2E-JUD-04 KillSwitch触发 | ✅ | 1ms |
| E2E-BUS-01 事件日志完整性 | ✅ | 1ms |
| E2E-BUS-02 EventLogger记录 | ✅ | 2ms |
| E2E-BUS-03 跨分支事件订阅 | ✅ | 1ms |
| E2E-RBAC-01 立法无执行权 | ✅ | 1ms |
| E2E-RBAC-02 行政无规划权 | ✅ | 1ms |
| E2E-RBAC-03 司法MONITOR+KILL | ✅ | 1ms |
| E2E-SM-01 非法转换抛异常 | ✅ | 0ms |
| E2E-SM-02 终态不可再转换 | ✅ | 0ms |
| Bonus: ConflictScore分级 | ✅ | 1ms |
| Bonus: 趋势计算 | ✅ | 0ms |


---

## 四、与现有单元测试的关系

### 已有测试文件（单模块闭环）

| 测试文件 | 覆盖模块 | 测试数 |
|---------|---------|-------|
| `tests/schemas.test.ts` | Zod Schema 校验 | Task 1.1 |
| `tests/bus.test.ts` | MessageBus + BillLifecycle | Task 1.2 |
| `tests/base-agent.test.ts` | BaseAgent RBAC + Tools | Task 1.3 |
| `tests/legislative-mps.test.ts` | ConflictScore + MPs | Task 1.4 |
| `tests/legislative-debate.test.ts` | DebateEngine + VotingMachine | Task 1.5 |
| `tests/executive.test.ts` | President + Secretaries + Engine | Task 1.6 |
| `tests/judicial.test.ts` | ChiefJustice + RulesEngine + KillSwitch | Task 1.7 |
| `tests/government.test.ts` | CyberGovernment Pipeline（粗粒度 Mock） | Task 1.8 |
| `tests/openclaw/adapter.test.ts` | OpenClawAdapter | Task 0 |

### 本 E2E 测试的增值

> **现有** `government.test.ts` 每个子模块都用 `vi.spyOn` 直接 Mock 方法返回值，不经过真实的内部逻辑。
>
> **本 E2E 测试** 只在 `adapter.callLLM` 层 Mock，让所有中间逻辑（ConflictScoreEngine 关键词匹配、President Token/Skill 校验、RulesEngine 黑名单检测、BillLifecycle 状态转换……）真实执行。

---

## 五、运行方式

```bash
# 运行全部 E2E 测试
cd backend && npx vitest run tests/e2e/phase1-e2e.test.ts

# 运行特定场景
cd backend && npx vitest run tests/e2e/phase1-e2e.test.ts -t "E2E-HP-01"

# 运行全部测试（含单元测试）
cd backend && npx vitest run
```
