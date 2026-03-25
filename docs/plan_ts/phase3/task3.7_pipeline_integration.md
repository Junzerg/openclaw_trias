# Task 3.7: Pipeline 集成调试

> **目标**：将 Task 3.3~3.6 的真实执行能力接回 `government.ts` 的完整 Pipeline，确保真实数据在全链路上正确传播。
> **前置依赖**：[Task 3.3](task3.3_model_routing.md) + [Task 3.4](task3.4_sec_engineering.md) + [Task 3.5](task3.5_sec_state.md) + [Task 3.6](task3.6_sandbox.md)
> **对应目录**：`backend/src/`
> **预估耗时**：0.5 会话

> **状态**：✅ 已完成 (于 Deep Audit 中得到极限强化)

## 为什么需要独立的集成 Task？

Phase 2 的 Task 2.5 E2E 联调经验表明，独立组件测试通过不代表集成无问题。Phase 2 发现了 3 个仅在集成时才暴露的 Bug：

| Phase 2 Bug | 根因 |
|-------------|------|
| Bug 1: deviation scorer JSON 解析 | 真实 LLM 输出与 Mock 格式差异 |
| Bug 2: bill_state 未更新 | 事件桥接遗漏 `state_change` 处理 |
| Bug 3: execSync 阻塞 | 全链路集成时才暴露 |

Phase 3 中，真实执行的输出格式与 Mock 差异更大，预期同样会有集成问题。

## 需求说明

### 1. 潜在集成风险逐项排查

#### 风险 A: 偏离度评分漂移

**现象**：Mock 时 `TaskResult.output = "[Mock] sec_engineering 完成步骤 0: ..."` → 中文描述文本。真实执行时 `output = "hello world\n"` → 代码实际输出。

**影响**：大法官 `_createDeviationScorer` 的 prompt 中比较 petition vs output，真实代码输出可能导致评分偏移。

**排查**：
- 提交 "写 hello world" → 检查 deviation score 是否合理（应 < 0.30 阈值）
- 如果评分过高 → 调整 scorer prompt，增加「执行产出可能是代码运行结果而非自然语言描述」的上下文

```typescript
// chief-justice.ts — 可能需要的 prompt 调整
const prompt = `...
执行产出 (Output):
"""
${output}
"""

注意：执行产出可能是代码运行后的控制台输出（如 stdout），而非自然语言描述。
请根据选民请求的意图来判断偏离度，而非要求产出的格式与请求完全一致。
...`;
```

#### 风险 B: Token 统计偏差

**现象**：Mock 时 `tokens_consumed = step.estimated_tokens`（硬编码估算值）。真实执行时，实际消耗取决于代码生成 + 代码执行两阶段。

**处理**：Phase 3 暂时保持 `estimated_tokens` 作为近似值（adapter 层无法精确获取 CLI 调用的 token 用量）。在 `sec-engineering.ts` 的返回中保留 `estimated_tokens`，Phase 4 升级 WebSocket 直连后可获取精确值。

#### 风险 C: 输出格式差异

**现象**：真实 stdout 可能包含 ANSI 转义码、换行符等。

**处理**：`adapter.extractLLMContent()` 已有 ANSI 剥离逻辑。确认 `executeCode` 返回值也经过同样处理。

#### 风险 D: 执行时间变长

**现象**：Mock 执行 ~0ms，真实执行可能 5-30s。Pipeline 总时间从 ~60s 增长到 ~120s+。

**处理**：确认 Pipeline 无硬超时。`receivePetition` 的 `maxRetries` 默认为 1，不会无限重试。

### 2. `government.ts` 适配

检查 `_runPipeline` 中是否有假设 Mock 行为的逻辑：

```typescript
// 需检查的关键路径：
const report = await this.executionEngine.executeAct(act);
// report.task_results[].output 现在是真实输出，不再是 "[Mock]" 前缀
// report.overall_status 可能因真实执行失败而变为 'partial' 或 'failed'

const verdict = await this.chiefJustice.reviewResult(petition, report);
// verdict 基于真实输出评估偏离度
```

### 3. 集成测试

编写 Mock adapter 级别的 Pipeline 全链路测试：

```typescript
// tests/integration/phase3-pipeline.test.ts
describe('Phase 3 Pipeline Integration', () => {
  it('完整 Pipeline 使用 Mock Transport 走通 Happy Path', async () => {
    const mockTransport = new MockTransport([
      // LLM 调用 1: radical_mp 辩论
      '{ "response": "我支持这个提案" }',
      // LLM 调用 2: conservative_mp 辩论
      '{ "response": "我也同意" }',
      // ...（按调用顺序排列所有预期响应）
    ]);
    const adapter = new OpenClawAdapter({}, mockTransport);
    const gov = new CyberGovernment(configDir);
    // ...
  });
});
```

## 交付物

| 文件 | 行数(预估) | 说明 |
|------|-----------|------|
| `agents/judicial/chief-justice.ts` | ~5 行微调 | deviation scorer prompt 适配代码输出 |
| `government.ts` | ~5 行微调 | 适配真实执行数据（如有必要） |
| `tests/integration/phase3-pipeline.test.ts` | ~200 | Mock Transport Pipeline 全链路测试 |

## 验收维度

- [x] Pipeline 全链路走通：Petition → 辩论 → 签署 → **真实执行** → 审查 → 交付
- [x] `ExecutionReport` 中包含真实执行输出（非 `[Mock]` 前缀）
- [x] 大法官对 hello world 真实执行结果的偏离度评分 < 0.30（合理范围）
- [x] Pipeline 失败路径正常：执行失败 → 违宪 → 重试
- [x] 事件总线正确推送所有事件（WS Bridge + DB Bridge 不受影响）
- [x] `llm_thinking` 进度事件在 Pipeline 执行期间正确推送
- [x] 模型路由在 Pipeline 中生效（日志验证）
- [x] 所有现有测试通过 + 新增集成测试通过
- [x] `npm run build` 零 TypeScript 报错

> **Deep Audit 特别加固 (Round 9 ~ Round 11)**：
> 在全链路联调期间，我们发现并修复了以下集成级架构漏洞：
> 1. **状态断层 (State GC)**: 当 Pipeline 在执行重度代码节点宕机时，修复了重新启动后残留在数据库的 Zombie Task 会导致前端永久卡死的问题。
> 2. **事件总线原子化 (Atomic Tx)**: Bridge 中的多个更新动作（Act, Verdict, Event）利用了 SQLite 的 `db.transaction()` 完成回滚包裹。
> 3. **大法官裁判逻辑隔离**: 将危险代码探测严格剥离给了 `output` 产物，避免用户 Petition (自然语言) 触发无端违宪拦截，保障了沙盒环境的话语弹性。
