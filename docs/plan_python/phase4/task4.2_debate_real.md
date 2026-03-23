# Phase 4 - Task 4-B: 议会辩论真实化

> **前置依赖**: Task 4-A (LLM Provider 已就绪)
> **包含项**: 4.2.1 ~ 4.2.4
> **模块特性**: 后端立法分支 / LLM 集成

## 📌 目标

让议会辩论从"念台词"变成"真吵架"。接入真实 LLM 后，激进派和保守派的提案、批评、反驳将完全由大模型驱动，每次提交不同的请愿会产生截然不同的辩论过程和法案产物。

## 📋 涵盖子项

### 4.2.1 议员 LLM 提案/反驳
- `RadicalMP.propose()` 和 `RadicalMP.rebut()`：通过真实 LLM 调用（继承自 `BaseAgent._call_llm`）生成激进派提案。
- `ConservativeMP.critique()`：通过真实 LLM 调用生成保守派批评。
- 需要优化每个 Agent 的 System Prompt（`SOUL.md`），使其产出风格鲜明、角色清晰的对话。

### 4.2.2 议长 LLM 控场与法案生成
- `Speaker.intervene()`：真实 LLM 生成控场声明（目前已有 prompt 模板）。
- `Speaker.generate_act()`：**核心改造**。当前产出单步占位 Act；改为调用 LLM，将自然语言辩论共识提炼为包含多步骤 `ActStep` 列表的结构化法案（JSON 输出模式）。
- 需要设计 Act 生成的 Prompt 模板，引导 LLM 产出符合 `Act` Pydantic schema 的 JSON。

### 4.2.3 Conflict Score LLM 化（可选）
- 当前 `conflict_score.py` 使用关键词计数的规则引擎。
- 可选择性增强为 LLM-as-a-Judge 评估分歧度，但需注意 Token 消耗的倍增。
- 如果 Token 消耗过高，保留规则引擎也完全可行。

### 4.2.4 投票逻辑真实化
- 移除 `government.py` 中的 `_force_vote_passed()` 硬编码保底机制。
- 议员 `vote()` 方法接入真实 LLM 判断，让投票结果真实反映辩论走向。
- 需要处理"投票未通过"的新路径（当前 Pipeline 假设必定通过）。

## 🛠️ 关键修改文件

| 操作 | 文件 |
|------|------|
| **[NEW/MODIFY]** | `config/souls/radical_mp.md` — 丰富 SOUL 人设 |
| **[NEW/MODIFY]** | `config/souls/conservative_mp.md` — 丰富 SOUL 人设 |
| **[NEW/MODIFY]** | `config/souls/speaker.md` — 丰富议长 SOUL |
| **[MODIFY]** | `openclaw_republic/agents/legislative/speaker.py` — `generate_act()` 真实化 |
| **[MODIFY]** | `openclaw_republic/government.py` — 移除 `_force_vote_passed` |

## 验收标准

- [ ] 对相同请愿提交两次，两轮辩论内容明显不同（证明 LLM 在实际工作）。
- [ ] `speaker.generate_act()` 产出包含 ≥ 2 个 `ActStep` 的多步骤结构化法案。
- [ ] 移除 `_force_vote_passed()` 后，Pipeline 在投票通过和未通过两种情况下均能正确流转。
- [ ] SOUL.md 人设注入工作正常，不同人设产出明显不同的辩论风格。
