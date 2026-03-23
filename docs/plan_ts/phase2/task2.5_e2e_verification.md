# Task 2.5: 端到端联调验证

> **目标**：启动 TS 后端 + 像素前端，验证从 Petition 提交到三大场景动画的完整链路可通。
> **前置依赖**：[Task 2.4](task2.4_pipeline_bridge.md)
> **对应目录**：`backend/tests/e2e/`
> **预估耗时**：1 会话

## 需求说明

### 1. Vite 代理兼容验证

确认前端 `vite.config.ts` 的代理配置与 TS 后端端口匹配：

```typescript
// 前端 vite.config.ts 已有配置：
server: {
  port: 3000,
  proxy: {
    '/api': { target: 'http://localhost:8000', changeOrigin: true },
    '/ws':  { target: 'ws://localhost:8000', ws: true }
  }
}
```

> TS 后端需监听 `8000` 端口。如果现有 Express 端口与此不一致，需调整 `startServer()` 默认端口。

### 2. E2E 测试脚本

编写自动化 E2E 测试 `backend/tests/e2e/phase2-e2e.test.ts`：

```
测试流程：
1. 启动 TS 后端（in-process 或 child_process）
2. POST /petition → 获取 task_id
3. 建立 WebSocket 连接 ws://localhost:8000/ws/task/{task_id}
4. 收集所有 WS 推送事件
5. 等待 Pipeline 完成（收到 state_change: delivered 或 task status = completed）
6. 验证：
   - 至少收到了 state_change (debating → voted → signed → executing → reviewing → delivered)
   - 收到了 propose / vote_passed / sign_act / constitutional 等核心事件
   - GET /task/{id}/status → status: completed
   - GET /task/{id}/act → 非空法案
   - GET /task/{id}/debate → 至少 1 轮辩论记录
   - GET /task/{id}/verdict → 合宪判决
7. 关闭连接，停止后端
```

### 3. 手动联调检查清单

> 以下步骤需人工在像素演播厅中观察确认：

- [ ] **Terminal 1**：`cd backend && npm run dev` → 后端在 8000 端口启动
- [ ] **Terminal 2**：`cd frontend && npm run dev` → 前端在 3000 端口启动
- [ ] 浏览器打开 `http://localhost:3000` → 进入像素演播厅大厅
- [ ] 通过前端 UI 或 `curl POST http://localhost:3000/api/petition -d '{"prompt":"帮我写一个 hello world"}'` 提交请愿
- [ ] 观察场景切换：
  - 🏛️ 议会场景：议员发言气泡、辩论动画、表决通过绿灯
  - 🏢 行政场景：总统签字、部长敲键盘
  - ⚖️ 司法场景：法官敲槌、合宪/违宪判决
- [ ] 检查 `data/tasks.db` 中数据完整性

### 4. 启动脚本更新

更新 `backend/package.json`：

```json
{
  "scripts": {
    "dev": "tsx watch src/server/app.ts",
    "start": "tsx src/server/app.ts",
    "test:e2e": "vitest run tests/e2e/"
  }
}
```

## 验收维度

- [ ] `npm run test:e2e` 全部通过
- [ ] 手动联调：前端提交 Petition → 看到完整三大场景动画流转
- [ ] `wscat` 连接实时收到 ≥8 种事件类型的 JSON 流
- [ ] SQLite 持久化数据完整：`tasks` / `events` / `acts` / `verdicts` 各表有正确记录
- [ ] Pipeline 在 Veto 或 Unconstitutional 时正确触发回路重试

## 完成标志

> Phase 2 完成后，项目达到以下里程碑：
> **浏览器打开前端 → 提交 Petition → 看到完整的 AI 驱动的像素演播厅动画（不再是 Mock 数据）。**
>
> 这标志着 TypeScript 后端已具备 Python 版的全部 Server 层能力，且与现有像素前端完全兼容。
