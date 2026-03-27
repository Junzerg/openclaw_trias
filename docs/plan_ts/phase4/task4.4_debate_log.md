# Task 4.4 — 辩论日志面板 & 实时 WS 事件收集

> **前置依赖**：Task 4.1
> **涉及端**：🖥️ 前端
> **预估工作量**：⭐⭐⭐

---

## 目标

将 WS 实时推送的 `propose`/`debate`/`brawl`/`order` 事件收集到 AppContext，并渲染为可视化辩论日志面板（左右对抗时间线布局）。

**不含**：Conflict Score 曲线图（拆分到 Task 4.5）

## 核心产出

### 1. AppContext debate reducer

```typescript
// 新增 actions
| { type: 'DEBATE_EVENT'; event: WSEventPayload }
| { type: 'DEBATE_RESET' }
| { type: 'DEBATE_LOAD_HISTORY'; rounds: DebateRound[]; conflictScores: number[] }
```

- `DEBATE_EVENT`：根据 `event.action`（propose/debate/brawl/order）和 `event.source_agent`（radical_mp/conservative_mp/speaker）写入对应的 round
- 自动识别 `round_number` 递增、分歧度提取

### 2. `components/debate/DebateRoundCard.tsx`

- 单轮辩论详情卡片
- 折叠/展开查看完整 CoT 文本
- 显示：轮次号、激进派发言、保守派发言、分歧度数值、Speaker 介入标记
- **体验优化**：引入 `useTypewriter` hook，让较长的辩论发言（Markdown 内容）呈现打字机渐显动画（目标耗时约 5 秒及动态光标），更具沉浸感和实时感

### 3. `components/debate/DebateLogPanel.tsx`

- 左右对抗时间线布局：
  - 左侧：激进派红色气泡（`radical_mp` 发言）
  - 右侧：保守派蓝色气泡（`conservative_mp` 发言）
  - 居中黄色条：Speaker 介入（`order` 事件）
- 最新一轮自动滚动到底部
- 空状态提示："等待辩论开始..."

### 4. WS 事件 → AppContext 写入桥接

- 在 `App.tsx` 的 `wsEventBus.subscribe` 中增加 `DEBATE_EVENT` dispatch
- 匹配 action: `propose`、`debate`、`brawl`、`order`
- **体验优化** (`ParliamentScene.ts`)：因 LLM 生成文本过长可能导致打字动画阻塞 Phaser 事件队列，优化 `showTextBubble`：
  - 动态计算 `charDelay`，确保最长约 5 秒内完成播放。
  - **滚动气泡**：不再硬截断前 80 字符，而是保持最多 250 字符的滑动窗口，持续向上滚动直到展示完完整内容。
  - **气泡常驻**：气泡打字完成后不会自动消失，会一直保持在议员头顶，直到该议员开启下一轮发言时才会被新的气泡替换。
- **底层支持** (`backend/src/server/pipeline-bridge.ts`)：修复 `serializeEvent` 漏读顶层扩展属性的 Bug，确保辩论的 `statement` 透传到前端 payload 顶层。
- **新增投票场景** (`backend/src/agents/legislative`)：在 `government.ts` 和 `speaker.ts` 中传入投票轮次参数，利用 `emitEvent` 将表决过程模拟成 `propose` / `order` 事件下发。议长宣布表决开始，随后双发议员分别声明自身的赞成/反对票。

## 文件清单

| 操作 | 文件路径 |
|------|---------|
| NEW | `frontend/src/components/debate/DebateLogPanel.tsx` |
| NEW | `frontend/src/components/debate/DebateRoundCard.tsx` |
| MODIFY | `frontend/src/contexts/AppContext.tsx` — debate reducer |
| MODIFY | `frontend/src/App.tsx` — wsEventBus → DEBATE_EVENT dispatch |
| MODIFY | `frontend/src/components/layout/AppShell.tsx` — 右栏挂载 DebateLogPanel |
| MODIFY | `frontend/src/game/scenes/ParliamentScene.ts` — 加入气泡文本截断优化长度 |
| MODIFY | `backend/src/server/pipeline-bridge.ts` — 修复 `serializeEvent` 展开丢失 `statement` 数据的 Bug |

## 验证计划

1. 触发一轮真实辩论 → 右侧面板实时显示双方发言气泡
2. 激进派红色气泡在左 / 保守派蓝色气泡在右
3. **右边栏体验**：出现打字机渐隐动画并且光标闪烁，5 秒内加载完毕
4. **游戏画布体验**：议会在发表超长内容时，头顶气泡会保持最多 250 字符进行向上滚动显示（最多播放 5 秒），且内容播放完毕后气泡长存，直到该议员开启下一轮发言。
5. Speaker ORDER! 事件显示为黄色"议长介入"标记
6. 多轮辩论 → 每轮独立折叠卡片
7. 面板自动滚动到最新一轮
