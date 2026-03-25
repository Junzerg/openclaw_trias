# ✅ Task 4.2 — Petition 提交面板 & 快捷模板

> **前置依赖**：Task 4.1
> **涉及端**：🖥️ 前端
> **预估工作量**：⭐⭐

---

## 目标

用户可以通过精致的 UI 面板提交请愿，并从预设模板快速选择常见任务类型。

## 核心产出

### 1. `hooks/useApi.ts` — REST API 封装

```typescript
export function useApi() {
  const postPetition = async (prompt: string): Promise<{ task_id: string }>;
  const fetchTasks = async (offset?: number, limit?: number): Promise<TaskListResponse>;
  const fetchTaskStatus = async (taskId: string): Promise<TaskStatusResponse>;
  const fetchDebate = async (taskId: string): Promise<DebateResponse>;
  const fetchAct = async (taskId: string): Promise<ActResponse>;
  const fetchVerdict = async (taskId: string): Promise<VerdictResponse>;
  return { postPetition, fetchTasks, fetchTaskStatus, fetchDebate, fetchAct, fetchVerdict };
}
```

- 所有请求带 error handling（网络错误、HTTP 状态码错误）
- 基础 URL 从 `window.location.origin` 推导（Vite proxy 已配好）

### 2. `components/petition/PetitionPanel.tsx`

- textarea 输入区（带字数统计、min 10 / max 20000 匹配后端 Zod schema）
- 快捷模板气泡列表：
  - 📝 "帮我写一个 TODO App"
  - 🔍 "搜索 Rust async 最新进展"
  - ⚠️ "危险测试: rm -rf /tmp/test"
  - 🧮 "用 Python 计算斐波那契数列前 20 项"
- 提交按钮：带加载状态（spinner + disable）
- 提交成功后：dispatch `PETITION_SUCCESS` 到 AppContext，显示 task_id

### 3. AppShell 左栏挂载

- PetitionPanel 挂载到 AppShell 左栏上半部分

## 后端对接

| 接口 | 用途 | 状态 |
|------|------|------|
| `POST /petition` | 提交请愿 | ✅ 已有 |

## 文件清单

| 操作 | 文件路径 |
|------|---------|
| NEW | `frontend/src/hooks/useApi.ts` |
| NEW | `frontend/src/components/petition/PetitionPanel.tsx` |
| MODIFY | `frontend/src/components/layout/AppShell.tsx` |
| MODIFY | `frontend/src/contexts/AppContext.tsx` — 添加 PETITION_SUBMIT/SUCCESS actions |

## 验证计划

1. 前端输入请愿文本 → 点击提交 → 后端返回 `202` + `task_id`
2. 点击快捷模板 → 文本自动填充到 textarea
3. 空输入或不足 10 字 → 提交按钮 disabled
4. 提交期间 → 按钮显示 spinner
5. 网络错误 → UI 显示错误提示
