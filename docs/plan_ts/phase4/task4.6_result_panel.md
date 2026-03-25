# Task 4.6 — 执行结果面板 & 判决展示

> **前置依赖**：Task 4.1
> **涉及端**：🖥️ 前端
> **预估工作量**：⭐⭐⭐

---

## 目标

展示行政分支的执行产物（代码/文件/文本输出）和司法分支的判决结果（合宪/违宪）。

## 核心产出

### 1. `components/result/ResultPanel.tsx`

- 总统交付备忘录面板
- 展示法案步骤执行结果（从 `GET /task/:id/act` 获取）
- 代码块：使用 `<pre><code>` + 语法高亮（CSS class 或轻量高亮库）
- 错误栈追踪：红色标记底色
- Markdown 渲染：使用简单的 Markdown → HTML 转换（可用 `marked` 轻量库或手写基础解析）
- 面板随 BillState 自动显示：当状态为 `CONSTITUTIONAL`/`UNCONSTITUTIONAL`/`DELIVERED` 时切换到此面板

### 2. `components/result/VerdictBanner.tsx`

- 合宪判决：
  - 绿色背景渐变条
  - 法槌 ✅ 图标 + `CONSTITUTIONAL` 大字
  - ruling 文本显示
- 违宪判决：
  - 红色背景渐变条 + 闪烁边框动画
  - ❌ 图标 + `UNCONSTITUTIONAL` 大字
  - evidence 列表展示

### 3. AppShell 右栏状态驱动切换

- 右栏内容根据当前任务状态自动切换：
  - `DEBATING`/`VOTED` → DebateLogPanel
  - `EXECUTING` → 可显示简单进度（或保持 DebateLog）
  - `CONSTITUTIONAL`/`UNCONSTITUTIONAL`/`DELIVERED` → ResultPanel + VerdictBanner

## 后端对接

| 接口 | 用途 | 状态 |
|------|------|------|
| `GET /task/:id/act` | 法案执行结果 | ✅ 已有 |
| `GET /task/:id/verdict` | 司法判决 | ✅ 已有 |

## 文件清单

| 操作 | 文件路径 |
|------|---------|
| NEW | `frontend/src/components/result/ResultPanel.tsx` |
| NEW | `frontend/src/components/result/VerdictBanner.tsx` |
| MODIFY | `frontend/src/components/layout/AppShell.tsx` — 右栏状态驱动切换 |

## 验证计划

1. 完整 Pipeline run → 进入 DELIVERED → ResultPanel 显示执行结果
2. VerdictBanner 正确显示合宪（绿色）或违宪（红色）
3. 切换到不同状态的历史任务 → 右栏面板正确切换
