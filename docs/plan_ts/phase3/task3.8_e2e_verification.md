# Task 3.8: 端到端真实执行验证

> **目标**：用真实 LLM + 真实 Skill 执行全量 E2E 回归，验证 Phase 3 所有改动的集成效果。参照 Phase 2 [Task 2.5](../phase2/task2.5_e2e_verification.md) 格式。
> **前置依赖**：[Task 3.1](task3.1_adapter_async.md) ~ [Task 3.7](task3.7_pipeline_integration.md) 全部完成
> **对应目录**：`backend/tests/e2e/`
> **预估耗时**：0.5-1 会话

## 需求说明

### 1. 自动化回归测试

```bash
# 全量回归
npm test                # 所有现有 242+ 单测
npm run test:e2e        # Phase 2 + Phase 3 E2E 测试
npm run build           # TypeScript 编译零错误
```

### 2. 真实 LLM + Skill 联调测试矩阵

| 序号 | 场景 | 请愿内容 | 预期路径 | 关键验证点 |
|------|------|---------|---------|-----------|
| 1 | **Happy Path** | "写一个 Python hello world 程序" | 辩论→签署→**真实执行**→合宪→交付 | `TaskResult.output` 包含 "hello" |
| 2 | **多步骤法案** | "写一个 Python 计算器，支持加减乘除" | 辩论→签署→多步执行→合宪 | 多个 `tool_call` 事件，所有步骤 `success` |
| 3 | **VETO 路径** | 高预算请愿 (token > budget) | 辩论→总统否决→重试 | `veto` 事件触发 |
| 4 | **执行失败** | "请执行 `print(1/0)` 这段 Python 代码" | 辩论→签署→执行报错→违宪 | `TaskResult.status = 'failed'` |
| 5 | **模型路由** | 任意请愿 | 全路径 | 日志中大法官使用配置的「强模型」 |
| 6 | **并发安全** | 同时提交 2 个请愿 | 两个 Pipeline 独立运行 | 事件循环不阻塞，两个请求正常完成 |
| 7 | **安全拦截** | "执行 `rm -rf /`" | 沙箱拦截 → 执行失败 | 代码不到达 Gateway |
| 8 | **进度反馈** | 任意请愿 | 全路径 | WS 客户端收到 `llm_thinking` 事件 |

### 3. 手动 curl 验证清单

```bash
# 启动后端
cd backend && npm run dev

# 1. 提交请愿
curl -X POST http://localhost:8000/petition \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "请帮我写一个 Python hello world 程序"}' \
  | jq .

# 2. 监听 WS 事件（另一个终端）
wscat -c ws://localhost:8000/ws/task/{task_id}

# 3. 查询任务状态
curl http://localhost:8000/task/{task_id}/status | jq .

# 4. 查询法案
curl http://localhost:8000/task/{task_id}/act | jq .

# 5. 查询判决
curl http://localhost:8000/task/{task_id}/verdict | jq .

# 6. 并发测试：同时提交 2 个请愿
curl -X POST http://localhost:8000/petition -H 'Content-Type: application/json' \
  -d '{"prompt": "写一个 Python 计算 1+1 的程序"}' &
curl -X POST http://localhost:8000/petition -H 'Content-Type: application/json' \
  -d '{"prompt": "写一个 Python 输出当前时间的程序"}' &
wait
```

### 4. 前端可视化验证

```bash
# 启动前端
cd frontend && npm run dev
# 浏览器打开 http://localhost:3000
```

验证清单：
- [ ] 提交请愿 → 议会场景正确显示辩论气泡
- [ ] `tool_call` 事件 → 行政场景部长敲键盘动画
- [ ] `constitutional` / `unconstitutional` → 最高法院场景法槌/印章动画
- [ ] `llm_thinking` 事件 → 对应 Agent 显示 thinking 状态（如前端已支持）

### 5. Bug 记录

联调发现的 Bug 记录在 `docs/plan_ts/phase3/e2e_bugs.md`，格式参照 Phase 2 的 [e2e_bugs.md](../phase2/e2e_bugs.md)。

## 交付物

| 文件 | 行数(预估) | 说明 |
|------|-----------|------|
| `tests/e2e/phase3-integration.test.ts` | ~200 | 自动化 E2E 测试（mock adapter 级别） |
| `docs/plan_ts/phase3/e2e_bugs.md` | ~100+ | 联调 Bug 记录 |

## 验收维度

### 自动化

- [ ] 所有现有测试通过（零回归）
- [ ] 新增 Phase 3 E2E 测试全绿
- [ ] `npm run build` 零 TypeScript 报错

### 真实联调

- [ ] Happy Path：真实 LLM + 真实 CodeExecution 端到端走通
- [ ] 执行失败路径：执行报错 → 违宪 → 正确记录
- [ ] VETO 路径：总统否决 → 重试
- [ ] 并发：2 个请愿同时执行不互相阻塞
- [ ] 进度反馈：WS 客户端接收到 `llm_thinking` 事件
- [ ] Pipeline 执行期间 HTTP API 正常响应（`execSync` 阻塞已修复）

### 前端

- [ ] 像素演播厅正确渲染所有三个场景
- [ ] 真实 `tool_call` 事件触发部长敲键盘动画
- [ ] 场景切换时序正确

### 分支覆盖

> 参照 Phase 2 Task 2.5 的分支覆盖表，Phase 3 目标 ≥ Phase 2 的 11/11 覆盖率。

| 分支 | 覆盖 | 事件类型 |
|------|------|---------|
| 议会辩论 | □ | `propose` |
| 冲突评分 | □ | 曲线变化 |
| 投票通过 | □ | `vote_passed` |
| 总统签署 | □ | `sign_act` |
| 总统否决 | □ | `veto` |
| **真实代码执行** | □ | `tool_call` + 真实 stdout |
| 司法合宪 | □ | `constitutional` |
| 司法违宪 | □ | `unconstitutional` |
| Pipeline 重试 | □ | 重试循环 |
| brawl (肢体冲突) | □ | 冲突分 > 阈值 |
| 安全拦截 | □ | 沙箱拒绝 |
| **进度反馈** | □ | `llm_thinking` |
| **模型路由** | □ | 日志验证 |
