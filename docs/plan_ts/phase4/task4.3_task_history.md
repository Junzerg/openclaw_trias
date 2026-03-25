# ✅ Task 4.3 — 任务历史列表 & 状态追踪

> **前置依赖**：Task 4.1
> **涉及端**：🖥️ 前端
> **预估工作量**：⭐⭐

---

## 目标

用户可以查看历史任务列表，点击任务卡片切换当前追踪的活跃任务，实时显示任务状态。

## 核心产出

### 1. `components/petition/TaskList.tsx`

- 从 `GET /tasks` 拉取历史任务列表（10s 轮询刷新）
- 展示为可滚动的卡片列表
- 当前活跃任务高亮标记

### 2. `components/petition/TaskCard.tsx`

- 状态徽章：映射 11 种 BillState 为颜色（PETITION→灰、DEBATING→紫、EXECUTING→蓝、CONSTITUTIONAL→绿、UNCONSTITUTIONAL→红等）
- 请愿摘要（截断 100 字 + ellipsis）
- 时间戳（相对时间：如"3 分钟前"）
- 点击 → dispatch `SET_ACTIVE_TASK` → 切换 WS 订阅

### 3. `useWebSocket.ts` 增强

- 支持动态切换 `taskId`：切换前 close 旧连接，避免连接泄漏
- 新 taskId 触发新 WS 连接建立

## 后端对接

| 接口 | 用途 | 状态 |
|------|------|------|
| `GET /tasks` | 任务列表 | ✅ 已有 |
| `GET /task/:id/status` | 任务状态 | ✅ 已有 |
| `WS /ws/task/:id` | 实时事件 | ✅ 已有 |

## 文件清单

| 操作 | 文件路径 |
|------|---------|
| NEW | `frontend/src/components/petition/TaskList.tsx` |
| NEW | `frontend/src/components/petition/TaskCard.tsx` |
| MODIFY | `frontend/src/components/layout/AppShell.tsx` — 左栏挂载 TaskList |
| MODIFY | `frontend/src/hooks/useWebSocket.ts` — 支持动态 taskId 切换 |
| MODIFY | `frontend/src/contexts/AppContext.tsx` — SET_ACTIVE_TASK / SET_TASKS actions |

## 深度踩坑与架构纪要 (Bugfix Audit)

在 Task 4.3 的实装过程中，我们趟平了 8 个深水区 Bug，特此纪要以防后续 Task 再次踩坑：

1. **React 18 StrictMode 双挂载连接泄漏**：`useEffect` 闭包内的 `wsRef` 与当前 `ws` 实例比对 (`ws !== wsRef.current`) 解决。
2. **初始状态黑洞**：WS 连接并不推送当前状态，需自行调用 `fetchTaskStatus` 对齐初始化场景。
3. **跨任务切换的数据污染**：`AppContext` 的 `SET_ACTIVE_TASK` 必须显式清空旧任务的 `debate`、`execution` 和 `verdict` 数据树。
4. **乐观更新 (Optimistic UI)**：提交 Petition 需立即前端伪造卡片占位，不干等 10s 接口轮询。
5. **路由回落陷阱**：`SceneManager.SCENE_MAP` 字典需补齐大写的 `VOTED`/`VETOED` 等实控状态。
6. **API 复数路由 404**：REST 接口需统一为单数 `/task/:id`。
7. **Phaser 同场景换皮不渲染**：当目标场景等同当前场景时，需依赖 Router 传入 `taskId` 触发硬 `currentScene.scene.restart()` 避免由于场景缓存导致的“穿戏”。
8. **WS Status 与 BillState 抢占**：WS `status_update` 的底层引擎 `status` (`running`) 会盲目覆盖语意层 `bill_state` (`EXECUTING`)，必须提权 `bill_state` 且补充 `.toUpperCase()` 字典防漏保护。

## 验证计划

1. 提交 2+ 个 Petition → 任务列表正确显示
2. 点击非活跃任务卡片 → WS 连接切换到新 taskId
3. Phaser 场景跟随新 task 状态切换
4. 切换后旧 WS 连接已关闭（无泄漏）
5. 状态徽章颜色正确映射 BillState
