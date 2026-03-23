# Phase 4 - Task 4-D: 司法审查实弹化

> **前置依赖**: Task 4-A (LLM Provider), Task 4-C (沙箱已接入真实执行)
> **包含项**: 4.4.1 ~ 4.4.3
> **模块特性**: 后端司法分支 / LLM-as-a-Judge / 进程管控

## 📌 目标

当行政部门开始执行真实代码后，司法审查就从"走形式"变成了真正的安全关卡。本任务将 `ChiefJustice` 的过程审查和结果审查都接入真实数据流，使其能够审计真实的 stdout/stderr，并用 LLM-as-a-Judge 评估成果偏离度。

## 📋 涵盖子项

### 4.4.1 过程审查接入真实执行
- **当前状态**: `ProcessReviewer` 检查 `ExecutionEvent` 中的危险模式。但目前事件中的数据全是 Mock 的。
- **改造**: 沙箱执行 (Task 4-C) 产生的真实 `tool_call` 事件，应携带实际执行的命令/代码内容。`ProcessReviewer` 需能解析 `stdout`/`stderr` 中的可疑输出模式。
- 新增检测维度：
  - 沙箱逃逸尝试（路径穿越 `../../`）
  - 网络外联尝试（`socket.connect`, `requests.get` 对非白名单 URL）
  - 资源耗尽信号（OOM Killer 日志）

### 4.4.2 结果审查 LLM 化
- **当前状态**: `ResultReviewer` 使用规则引擎的 `DeviationScorer` 计算偏离度（基于文本相似度）。
- **改造**: 引入 LLM-as-a-Judge 模式，让 LLM 充当大法官：
  - 输入：原始请愿文本 + 执行报告中的真实产物（stdout 输出）
  - 输出：偏离度评分 (0~100) + 判决理由
- 保留规则引擎作为 fallback（当 LLM 不可用或 `MOCK_LLM=true` 时）。

### 4.4.3 Kill Switch 真实化
- **当前状态**: `KillSwitch.execute()` 仅生成 `KillReport` 日志对象。
- **改造**: 违宪判定触发后，如果沙箱子进程仍在运行，真正调用 `process.kill()` 终止。
- 清理沙箱工作区中的残留文件。
- 生成包含真实 traceback 的判决书。

## 🛠️ 关键修改文件

| 操作 | 文件 |
|------|------|
| **[MODIFY]** | `openclaw_republic/agents/judicial/process_reviewer.py` — 增强检测维度 |
| **[MODIFY]** | `openclaw_republic/agents/judicial/result_reviewer.py` — LLM-as-a-Judge |
| **[MODIFY]** | `openclaw_republic/agents/judicial/kill_switch.py` — 真实进程终止 |
| **[MODIFY]** | `openclaw_republic/agents/judicial/chief_justice.py` — 对接真实执行报告 |

## 验收标准

- [ ] 提交一个正常请愿 → 执行结果合规 → `ChiefJustice` 判定合宪 → 流程顺利通过。
- [ ] 提交一个包含 `rm -rf /` 的请愿 → 过程审查实时拦截 → 违宪熔断。
- [ ] 提交一个"请帮我写一首诗"的请愿，但法案步骤要求执行代码 → 结果审查检测到产物偏离原始需求 → 违宪判定（偏离度超标）。
- [ ] Kill Switch 真正终止正在运行的子进程。
