# Task 4.7 — Token 用量统计埋点 & 仪表盘

> **前置依赖**：Task 4.5（Recharts 已安装）
> **涉及端**：🖥️🔧 前后端
> **预估工作量**：⭐⭐⭐

---

## 目标

在后端 Pipeline 各阶段埋入 Token 用量 WS 事件，前端渲染消耗分布图表。

## 核心产出

### 后端埋点

#### 1. `schemas/events.ts` — 新增 TokenUsageEvent

```typescript
export enum EventAction {
  // ... existing
  TOKEN_USAGE = 'token_usage',
}

export interface TokenUsageEvent extends BaseEvent {
  action: EventAction.TOKEN_USAGE;
  payload: {
    branch: 'legislative' | 'executive' | 'judicial';
    tokens_used: number;
    cumulative: number;
  };
}
```

#### 2. `government.ts` — 4 个埋点位置

| 位置 | 对应代码行 | branch | 说明 |
|------|-----------|--------|------|
| 辩论结束后 | `moderateDebate()` 返回后 | `legislative` | 辩论阶段总 token |
| 法案签署后 | `evaluateAct()` 返回后 | `executive` | 总统审查 token |
| 执行完成后 | `executeAct()` 返回后 | `executive` | 内阁执行 token |
| 审查完成后 | `reviewResult()` 返回后 | `judicial` | 大法官审查 token |

Token 数来源：`report.total_tokens_consumed`（ExecutionReport 已有字段），或者 OpenClaw Adapter 返回的 usage 信息。

### 前端仪表盘

#### 3. `components/metrics/TokenDashboard.tsx`

- 三分支 Token 消耗饼图（Recharts `PieChart`）：
  - 立法分支（紫色）
  - 行政分支（蓝色）
  - 司法分支（黄色）
- 累计 Token 折线图（Recharts `LineChart`）：X 轴=事件序号，Y 轴=累计 token

#### 4. AppContext tokens reducer

```typescript
| { type: 'TOKEN_USAGE'; branch: string; tokens_used: number; cumulative: number }
```

## 文件清单

| 操作 | 文件路径 |
|------|---------|
| NEW | `frontend/src/components/metrics/TokenDashboard.tsx` |
| MODIFY | `backend/src/schemas/events.ts` — TokenUsageEvent |
| MODIFY | `backend/src/government.ts` — 4 个埋点 |
| MODIFY | `frontend/src/contexts/AppContext.tsx` — tokens reducer |

## 验证计划

1. 完整 Pipeline run → 后端日志可见 `token_usage` 事件
2. 前端仪表盘显示三分支消耗分布饼图
3. 累计折线图随事件递增更新
