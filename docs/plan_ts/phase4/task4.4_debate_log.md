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

## 文件清单

| 操作 | 文件路径 |
|------|---------|
| NEW | `frontend/src/components/debate/DebateLogPanel.tsx` |
| NEW | `frontend/src/components/debate/DebateRoundCard.tsx` |
| MODIFY | `frontend/src/contexts/AppContext.tsx` — debate reducer |
| MODIFY | `frontend/src/App.tsx` — wsEventBus → DEBATE_EVENT dispatch |
| MODIFY | `frontend/src/components/layout/AppShell.tsx` — 右栏挂载 DebateLogPanel |

## 验证计划

1. 触发一轮真实辩论 → 右侧面板实时显示双方发言气泡
2. 激进派红色气泡在左 / 保守派蓝色气泡在右
3. Speaker ORDER! 事件显示为黄色"议长介入"标记
4. 多轮辩论 → 每轮独立折叠卡片
5. 面板自动滚动到最新一轮
