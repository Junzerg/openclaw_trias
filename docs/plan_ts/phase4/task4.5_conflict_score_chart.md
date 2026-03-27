# Task 4.5 — Conflict Score 曲线 & Recharts 集成

> **前置依赖**：Task 4.4
> **涉及端**：🖥️ 前端
> **预估工作量**：⭐⭐
> **状态**：✅ 已完成

---

## 目标

安装 Recharts，将辩论过程中的 Conflict Score 变化渲染为实时折线图。

## 核心产出

### 1. 安装 Recharts

```bash
cd frontend && npm install recharts
```

### 2. `components/debate/ConflictScoreChart.tsx`

- X 轴：辩论轮次（1, 2, 3, ...）
- Y 轴：分歧度 0~100
- 阈值参考线（从 `constitution.yaml` 的 `conflict_threshold` 读取，默认 30）
- 实时数据源：AppContext `debate.conflictScores` 数组
- 历史数据回填：切换到历史任务时从 `GET /task/:id/debate` 的 `conflict_score_curve` 加载
- 动画过渡：新数据点添加时平滑插入

### 3. 嵌入 DebateLogPanel

- 在 DebateLogPanel 顶部或底部嵌入 ConflictScoreChart
- 图表高度固定 150px，不干扰日志滚动

## 后端对接

| 接口 | 用途 | 状态 |
|------|------|------|
| `GET /task/:id/debate` | 历史辩论数据（含 `conflict_score_curve`） | ✅ 已有 |

## 文件清单

| 操作 | 文件路径 |
|------|---------|
| NEW | `frontend/src/components/debate/ConflictScoreChart.tsx` |
| MODIFY | `frontend/src/components/debate/DebateLogPanel.tsx` — 嵌入 Chart |
| MODIFY | `frontend/package.json` — 添加 recharts |

## 验证计划

1. 辩论进行时 → 折线图实时更新新数据点
2. 切换到已完成的历史任务 → 图表回填历史 curve
3. 阈值线正确显示
4. 图表不影响日志面板的滚动交互
