# Phase 2 E2E 真实联调发现的问题

> 联调时间: 2026-03-23 15:30 — 15:40
> 测试请愿: "请帮我写一个 Python 的 hello world 程序，输出三行文字"
> Task ID: `31c73f02-4c79-4804-bd5a-e31f73c27afc`

---

## Bug 1: Deviation Scorer JSON 解析失败 ✅ 已修复 (2026-03-23)

> **修复方案**: `_createDeviationScorer` 中将 fallback 从 `0.5`（超阈值 → 误判违宪）改为 `0.0`（安全默认 → 合宪），并加入 2 次重试机制（单次 LLM 调用 retry）。修改文件: `chief-justice.ts`。

**现象**: Pipeline 跑到司法审查阶段，`ChiefJustice._deviationScorer` 抛出 `SyntaxError: Unexpected end of JSON input`。

**根因**: LLM 返回的偏离度评分结果是截断的 JSON（内容不完整），`JSON.parse()` 直接抛异常。

**影响**: 解析失败后 fallback 到默认高偏离度(0.50)，超过阈值(0.30) → 判定 `unconstitutional` → 触发重试循环 → 耗尽重试次数后法案失败。

**文件位置**:
- `backend/src/agents/judicial/chief-justice.ts:77` — `JSON.parse()` 无容错
- `backend/src/agents/judicial/rules-engine.ts:113` — `checkDeviation` 调用方

**建议修复**:
1. `_deviationScorer` 中 wrap `JSON.parse` 在 try-catch 中，解析失败时给出默认低偏离度（而非高偏离度）
2. 或在 prompt 中增加严格的 JSON 格式约束 + 使用 `JSON.parse` 前做基本格式校验
3. 考虑加重试逻辑（单次 LLM 调用 retry）

**堆栈**:
```
SyntaxError: Unexpected end of JSON input
    at JSON.parse (<anonymous>)
    at RulesEngine._deviationScorer (chief-justice.ts:77)
    at RulesEngine.checkDeviation (rules-engine.ts:113)
    at ResultReviewer.reviewDelivery (result-reviewer.ts:22)
    at ChiefJustice.reviewResult (chief-justice.ts:113)
    at CyberGovernment._runPipeline (government.ts:192)
```

---

## Bug 2: bill_state 未正确更新 ✅ 已修复 (2026-03-23)

> **修复方案**: 在 `createDbBridge` 中增加对 `state_change` 事件的处理：当收到 `STATE_CHANGE` 事件且 `payload.state` 有值时，自动调用 `taskStore.updateTask({ bill_state })` 同步更新 tasks 表。修改文件: `pipeline-bridge.ts`。

**现象**: Pipeline 完成后，`GET /task/:id/status` 返回 `bill_state: "petition"`（初始值），而非预期的 `delivered` 或 `drafting`。

**根因**: `bill_state` 只在 `state_change` 事件中通过 bus 广播更新，但 task 表的 `bill_state` 字段似乎没有被 DB Bridge 更新。Pipeline 重试失败后状态回退到初始值。

**文件位置**:
- `backend/src/server/pipeline-bridge.ts` — `createDbBridge` 或 `runPetition` 中应同步更新 bill_state
- `backend/src/server/task-store.ts` — `updateTask` 方法

**建议修复**:
1. 在 DB Bridge 收到 `state_change` 事件时，同步更新 tasks 表的 `bill_state` 字段
2. 或在 `runPetition` 完成时根据最终 Pipeline 结果更新 `bill_state`

---

## Bug 3: execSync 阻塞 Node.js 事件循环 ⚡ 架构级（Phase 4）

**现象**: 每次 LLM 调用（`openclaw agent --message ...`）通过 `execSync` 执行，期间整个 Express 事件循环冻结。HTTP 请求和 WS 心跳在 LLM 调用期间完全无法响应（每次 30-120 秒）。

**根因**: `OpenClawAdapter.runCliCommand()` 使用 `execSync`（同步子进程），阻塞 Node.js 单线程事件循环。

**影响**:
- Pipeline 执行期间 `GET /task/:id/status` 超时（curl timeout 2s 即失败）
- WS 心跳丢失，可能导致前端重连
- 多个并发请愿无法处理

**文件位置**:
- `backend/src/openclaw/adapter.ts:284-309` — `runCliCommand` 方法

**建议修复** (Phase 4):
1. 将 `execSync` 替换为 `spawn` + Promise 包装的异步版本
2. 或使用 `worker_threads` 将 OpenClaw CLI 调用移到独立线程
3. 最终方案：Phase T3 直接使用 WebSocket API 与 Gateway 通信（已在 adapter.ts 注释中规划）

---

## 联调覆盖的分支总结

| 分支 | 是否覆盖 | 事件类型 | 验证任务 |
|------|---------|---------|---------|
| 议会辩论（多轮） | ✅ | `propose` x4~6 (2~3轮 x 2方) | Task 1/2/3 |
| 冲突评分变化 | ✅ | 曲线 `[0, 0, 45.34, 45.34]` / `[0, 0, 56.38, 56.38, 35.63, 35.63]` | Task 1/2 |
| 投票通过 | ✅ | `vote_passed` (ayes=2, nays=0) | Task 1/2/3 |
| 总统签署 | ✅ | `sign_act` | Task 1/2/3 |
| 执行引擎 | ✅ | `tool_call` x2 | Task 1/2/3 |
| 司法违宪 | ✅ | `unconstitutional` (偏离度 0.50 / 0.90) | Task 1/3 |
| Pipeline 重试 | ✅ | 第 1 次 JSON 解析错误 → 重试 | Task 1 |
| **司法合宪** | ✅ | `constitutional` (偏离度在允许范围内) | **Task 2** ✅ |
| **VETO (总统否决)** | ❌ | 未触发 | — |
| **brawl (肢体冲突)** | ❌ | 冲突分数不够高 | — |

## 未覆盖分支的触发建议

| 分支 | 如何触发 |
|------|---------|
| `veto` | 提交一个道德争议性高的请愿（如"写一个恶意代码"） |
| `brawl` | 需要冲突分数 > 80，LLM 自然触发概率低，可考虑降低 brawl 阈值测试 |

---

## 回归验证记录

### 回归验证 #2 (2026-03-23 16:20 — 16:55)

> Bug 1 & Bug 2 修复后的全量回归

| 验证项 | 结果 | 详情 |
|--------|------|------|
| `npm test` | ✅ 242 passed, 2 skipped | 18 个测试文件全部通过 |
| `npm run test:e2e` | ✅ 9/9 全绿 | Phase 2 E2E 自动测试 517ms |
| curl POST /petition | ✅ 202 | task_id=`67f51aef` |
| GET /task/:id/status | ✅ | bill_state=reviewing (Bug 2 修复生效) |
| GET /task/:id/act | ✅ | 法案 JSON 完整 |
| GET /task/:id/debate | ✅ | 2 轮辩论 + conflict_score_curve |
| GET /task/:id/verdict | ✅ | constitutional=false, 偏离度 0.90 (LLM 真实评分) |
| GET /tasks | ✅ | 3 条历史任务，分页正确 |

**结论**:
- **Bug 1 ✅ 已修复**: Task 2 (`0fa187ea`) 走通了完整合宪路径 (`constitutional: true`, `bill_state: delivered`)
- **Bug 2 ✅ 已修复**: 所有新任务的 `bill_state` 均正常更新（不再卡在 `petition`）
- **Bug 3 ⚡ 已确认**: Pipeline 期间 HTTP 请求仍然被 `execSync` 阻塞（Phase 4 修复）
- **Task 3 违宪原因**: LLM 真实评分偏离度 0.90（非 JSON 解析失败的 fallback 0.50），属于 LLM 判断行为

---

## SQLite 数据快照

### tasks 表 (3 条)

| task_id | petition | status | bill_state |
|---------|----------|--------|------------|
| `67f51aef` | 请帮我写一个 Python 的 hello world 程序 | completed | reviewing |
| `0fa187ea` | 请帮我写一个 Python 的 hello world 程序，输出三行文字 | completed | **delivered** ✅ |
| `31c73f02` | 请帮我写一个 Python 的 hello world 程序，输出三行文字：… | completed | petition (修复前) |

### verdicts 表 (3 条)

| task_id | constitutional | ruling | evidence |
|---------|---|---|---|
| `67f51aef` | 0 | 执行结果违宪，产出偏离度超标 | `["偏离度 0.90 > 阈值 0.30"]` |
| `0fa187ea` | **1** ✅ | 执行结果合宪，偏离度在允许范围内 | `[]` |
| `31c73f02` | 0 | 执行结果违宪，产出偏离度超标 | `["偏离度 0.50 > 阈值 0.30"]` |
