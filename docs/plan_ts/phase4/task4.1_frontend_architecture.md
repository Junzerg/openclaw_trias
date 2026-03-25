# Task 4.1 — 前端架构重构 & 设计系统

> **前置依赖**：无
> **涉及端**：🖥️ 前端
> **预估工作量**：⭐⭐⭐

---

## 目标

清除开发者原型痕迹（12 个 Debug 按钮、Vite 脚手架遗留样式），建立产品级前端骨架：全局状态管理、三栏布局壳、CSS 设计令牌系统。这是所有后续 UI 任务的公共基础。

## 背景

当前 `App.tsx`（210 行）是一个开发者级原型：
- L97~L204：12 个 Debug 按钮（Trigger Brawl、Trigger Propose、Scene 切换等）
- 状态管理分散在 `useWebSocket` hook 和 `App` 组件本地 state
- `App.css`（185 行）大部分是 Vite 脚手架遗留样式（`.hero`、`#next-steps` 等）
- 无布局系统：Phaser Canvas 和输入框堆叠排列

## 核心产出

### 1. `contexts/AppContext.tsx` — 全局状态管理

```typescript
// State 类型定义
interface AppState {
  activeTaskId: string | null;
  connection: { isConnected: boolean; reconnectAttempts: number; lastEventId: number };
  petition: { prompt: string; status: 'idle' | 'submitting' | 'submitted'; taskId: string | null };
  tasks: TaskSummary[];
  debate: { rounds: DebateRound[]; conflictScores: number[]; currentRound: number };
  execution: { steps: any[]; currentStep: number };
  verdict: { ruling: string; constitutional: boolean; evidence: string[] } | null;
  tokens: { legislative: number; executive: number; judicial: number; total: number };
}

// Action 类型定义
type AppAction =
  | { type: 'SET_ACTIVE_TASK'; taskId: string }
  | { type: 'SET_CONNECTION'; isConnected: boolean }
  | { type: 'PETITION_SUBMIT'; prompt: string }
  | { type: 'PETITION_SUCCESS'; taskId: string }
  | { type: 'SET_TASKS'; tasks: TaskSummary[] }
  | { type: 'DEBATE_EVENT'; event: WSEventPayload }
  | { type: 'TOKEN_USAGE'; event: any }
  | { type: 'RESET' };
```

- 使用 `useReducer` + `createContext` + `useContext` 三件套
- 导出 `AppProvider` 包裹组件 和 `useAppState()` / `useAppDispatch()` hooks

### 2. `components/layout/AppShell.tsx` — 三栏布局骨架

```
┌─────────────────────────────────────────────────────────┐
│  Header: OpenClaw Cyber Trias + 连接状态指示器            │
├──────────┬──────────────────────────────┬────────────────┤
│  左栏     │     中央 Phaser Canvas      │    右栏         │
│  (280px)  │     (flex-grow: 1)          │    (320px)      │
│           │                             │                 │
│  [Slot:   │     gameRef div             │    [Slot:       │
│  Petition │                             │    DebateLog    │
│  TaskList]│                             │    Result       │
│           │                             │    Metrics]     │
├──────────┴──────────────────────────────┴────────────────┤
│  Footer: 状态栏 (可选)                                    │
└─────────────────────────────────────────────────────────┘
```

- 面板折叠/展开按钮（收起左栏 / 收起右栏 → 锁定全屏 Canvas 观影模式）
- 左栏、右栏内容通过 `children` 或 `slot` props 注入（后续 Task 挂载具体面板）

### 3. `styles/design-system.css` — CSS Variables 设计令牌

```css
:root {
  /* 颜色系统 */
  --color-bg-primary: #0a0e1a;
  --color-bg-secondary: #111827;
  --color-bg-panel: #1a1f2e;
  --color-accent-blue: #3b82f6;
  --color-accent-green: #10b981;
  --color-accent-red: #ef4444;
  --color-accent-yellow: #f59e0b;
  --color-text-primary: #f3f4f6;
  --color-text-secondary: #9ca3af;

  /* 分支主题色 */
  --color-legislative: #6366f1;
  --color-executive: #3b82f6;
  --color-judicial: #f59e0b;

  /* 间距系统 */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;

  /* 字体 */
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  /* 动画 */
  --transition-fast: 150ms ease;
  --transition-normal: 300ms ease;
  --transition-slow: 500ms ease;

  /* 阴影 */
  --shadow-panel: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
  --shadow-elevated: 0 10px 15px -3px rgba(0, 0, 0, 0.4);

  /* 布局 */
  --panel-left-width: 280px;
  --panel-right-width: 320px;
  --header-height: 56px;
}
```

### 4. `App.tsx` 重构

- 移除 L97~L204 全部 12 个 Debug 按钮
- 移除底部的裸 `<input>` + `Send` 按钮（将在 Task 4.2 用 PetitionPanel 替代）
- 用 `AppProvider` 包裹
- 用 `AppShell` 替代原有的 div 堆叠布局
- 保留 Phaser 初始化逻辑和 wsEventBus 订阅

### 5. `App.css` 清理

- 移除 `.hero`、`#next-steps`、`#docs`、`#spacer`、`.ticks` 等 Vite 脚手架遗留样式
- 保留必要的全局样式（body reset 等）

## 文件清单

| 操作 | 文件路径 |
|------|---------|
| NEW | `frontend/src/contexts/AppContext.tsx` |
| NEW | `frontend/src/components/layout/AppShell.tsx` |
| NEW | `frontend/src/styles/design-system.css` |
| MODIFY | `frontend/src/App.tsx` |
| MODIFY | `frontend/src/App.css` |

## 验证计划

### 自动化
- `npm run build` 零错误零警告

### 手动
1. `npm run dev` 启动前端
2. 确认 Phaser Canvas 正常渲染（三大场景可切换）
3. 确认三栏布局骨架可见（左栏/右栏空白 slot）
4. 确认无 Debug 按钮残留
5. 确认面板折叠/展开按钮工作正常
6. 确认 WS 连接状态指示器正常显示

## 注意事项

- **不变量 #6**：前端 Phaser 游戏逻辑零改动（EventMapper、SceneManager、三大 Scene 不动）
- AppContext 的 state 结构要预留后续 Task 需要的字段（debate、tokens 等），但 reducer 只需实现本 Task 必须的 action（SET_CONNECTION、RESET），其余 action 在后续 Task 中渐进添加
