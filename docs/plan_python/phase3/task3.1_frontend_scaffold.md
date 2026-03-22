# Phase 3 Task 3-A: 前端工程基础与场景管理器

## 任务目标
搭建 Vite + React + Phaser.js 前端架构，完成 WebSocket 连接，并建立三大基础场景的切换管理系统。

## 前置依赖
- [Phase 2](../phase2/phase2_overview.md) 提供的 `/ws/task/{id}` WebSocket 接口处于可用状态。

## 具体执行步骤
1. **项目初始化**
   - 使用 `npm create vite@latest openclaw_frontend -- --template react-ts` 初始化前端项目。
   - 安装依赖：`phaser`, `react-router-dom`, `lucide-react`, `tailwindcss` (可选，用于辅助 UI)。
   - 配置 Vite 以代理 WebSocket 和 API 请求至后端 (`localhost:8000`)。
2. **WebSocket 客户端集成**
   - 封装 WebSocketClient 与后端的 `/ws/task/{task_id}` 进行通信。
   - 建立单例和心跳重连机制，自动接收并解析经过规整的 JSON 事件格式（参考 PRD §4）。
3. **Phaser 场景体系搭建**
   - 在前端创建 Phaser Game 实例并在 React 组件中装载。
   - 完成主线 SceneManager 和三大骨架类继承自 Phaser.Scene：`ParliamentScene`, `ExecutiveScene`, `JudicialScene`。
   - 编写状态路由逻辑：比如接收到生命周期状态为 `Debating` 时激活 `ParliamentScene`。
4. **事件总线层 (EventMapper)**
   - 创建一层映射桥梁，把后端的领域事件（如 `propose`, `brawl`) 路由分发翻译成 Phaser 环境内的函数调用（如 `scene.showDebateBubble(...)`）。

## 验收标准
- [x] 运行 `npm run dev` 能够进入无报错显示占位黑屏画布的网页。
- [x] 能稳定链接并在 Console 收到 WebSocket 实况消息流。
- [x] 能在日志观察到当前随着任务周期的转变，场景在自动流转更换。
