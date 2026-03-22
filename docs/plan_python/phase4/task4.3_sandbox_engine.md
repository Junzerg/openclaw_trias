# Phase 4 - Task 4-C: 行政执行沙箱引擎

> **前置依赖**: Task 4-A (LLM Provider 已就绪)
> **包含项**: 4.3.1 ~ 4.3.6
> **模块特性**: 后端行政分支 / 子进程管理 / 安全隔离

## 📌 目标

给内阁部长们"装上手脚"。当前 `SecretaryOfEngineering.execute_task()` 和 `SecretaryOfState.execute_task()` 都是纯粹的 Mock。本任务要实现一个真实的 Subprocess 沙箱执行器，让工程部长能根据法案步骤调用 LLM 生成代码，并在受控环境中执行。

## 📋 涵盖子项

### 4.3.1 Sandbox 工作区隔离
- 为每个 `ExecutionTask` 创建独立的 `/tmp/openclaw_sandbox/<task_id>/` 工作目录。
- 任务完成后可选清理（保留用于调试）。
- 工作区内可创建/读写文件，但不可逃逸到外部目录。

### 4.3.2 Python 解释器 Skill
- 实现 `PythonExecutor` 类：
  ```python
  async def execute(code: str, workdir: Path, timeout: float) -> ExecutionResult
  ```
- 底层使用 `asyncio.create_subprocess_exec("python3", "-c", code, cwd=workdir)`。
- 捕获 `stdout`, `stderr`, `returncode`。

### 4.3.3 Bash/Shell Skill
- 实现 `BashExecutor` 类，类似上方但执行 shell 命令。
- **安全白名单**：通过正则表达式黑名单拦截 `rm -rf /`、`dd if=`、`mkfs`、`:(){ :|: & };:` 等破坏性命令。
- 黑名单配置化，可通过 `constitution.yaml` 的 `judicial.blacklist_patterns` 扩展。

### 4.3.4 LLM 驱动的代码生成
- 改造 `SecretaryOfEngineering.execute_task()`：
  1. 根据 `ExecutionTask.step.description` 和 `tool_parameters` 组装 Prompt。
  2. 调用 `_call_llm()` 生成 Python/Bash 代码。
  3. 提交给 `PythonExecutor` / `BashExecutor` 执行。
- 改造 `SecretaryOfState.execute_task()`：
  1. 针对 `Search` / `WebBrowser` Skill，LLM 决策搜索关键词或目标 URL。
  2. 调用对应 CLI 工具或 Python 库（如 `httpx`）。

### 4.3.5 执行结果回收
- 定义 `ExecutionResult` Pydantic Model：`stdout`, `stderr`, `exit_code`, `duration_ms`。
- 将其映射回 `TaskResult`：
  - `exit_code == 0` → `status="success"`, `output=stdout`
  - `exit_code != 0` → `status="failed"`, `error=stderr`

### 4.3.6 超时与资源限制
- 单步执行超时上限（默认 30 秒），可通过 constitution 配置。
- 超时后强制 `process.kill()` 并返回 `TaskResult(status="failed", error="执行超时")`。

## 🛠️ 关键修改文件

| 操作 | 文件 |
|------|------|
| **[NEW]** | `openclaw_republic/sandbox/__init__.py` |
| **[NEW]** | `openclaw_republic/sandbox/executor.py` — PythonExecutor + BashExecutor |
| **[NEW]** | `openclaw_republic/sandbox/safety.py` — 黑名单过滤器 |
| **[MODIFY]** | `openclaw_republic/agents/executive/sec_engineering.py` — 接入真实沙箱 |
| **[MODIFY]** | `openclaw_republic/agents/executive/sec_state.py` — 接入真实搜索 |
| **[NEW]** | `tests/unit/test_sandbox.py` — 沙箱单元测试 |

## 验收标准

- [ ] 提交"写一个计算斐波那契数列的 Python 脚本"的请愿 → 工程部长真实编写并执行代码 → 返回正确的计算结果。
- [ ] 提交包含恶意命令的请愿 → 安全黑名单拦截 → 返回 `TaskResult(status="failed")`。
- [ ] 超时测试：执行一个 `while True: pass` 的死循环脚本 → 30 秒后被 kill 并返回超时错误。
- [ ] 沙箱工作区创建和清理行为正常。
