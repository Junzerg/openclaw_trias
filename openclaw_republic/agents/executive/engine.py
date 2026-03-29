"""行政执行引擎 — 管理法案步骤的顺序/并行执行。

按法案步骤依赖关系进行拓扑排序，同层无依赖的步骤
可并行执行（``asyncio.gather``），跟踪 Token 消耗，
生成 ``ExecutionReport``。
"""

from __future__ import annotations

import asyncio
import time
import uuid
from collections import defaultdict, deque
from typing import Any, Literal, Protocol, runtime_checkable

from openclaw_republic.schemas.act import (
    Act,
    ActStep,
    ExecutionReport,
    ExecutionTask,
    TaskResult,
)


# ---------------------------------------------------------------------------
# 协议：任何拥有 execute_task 的对象均可作为执行者
# ---------------------------------------------------------------------------


@runtime_checkable
class TaskExecutor(Protocol):
    """可执行任务的协议 — 部长 Agent 需满足此接口。"""

    role: str

    async def execute_task(self, task: ExecutionTask) -> TaskResult: ...


# ---------------------------------------------------------------------------
# ExecutionEngine
# ---------------------------------------------------------------------------


class ExecutionEngine:
    """行政执行引擎 — 管理法案步骤的顺序/并行执行。"""

    def __init__(self, cabinet: dict[str, TaskExecutor]) -> None:
        """初始化执行引擎。

        Args:
            cabinet: ``{skill_name: executor}`` 映射，例如
                     ``{"CodeExecution": sec_engineering, "Search": sec_state}``。
        """
        self._cabinet = dict(cabinet)

    # ----- 公开接口 -----

    async def execute_act(self, act: Act, event_publisher: Any | None = None) -> ExecutionReport:
        """按法案步骤列表执行。

        处理逻辑：
        1. 按步骤依赖关系确定执行顺序（拓扑排序）
        2. 同层无依赖的步骤并行执行
        3. 跟踪 Token 消耗
        4. 某步失败时，依赖它的后续步骤标记为 skipped
        5. 生成 ``ExecutionReport``
        """
        start_time = time.monotonic()
        levels = self._topological_sort(act.steps)
        results: dict[int, TaskResult] = {}
        failed_steps: set[int] = set()

        for level in levels:
            # 确定本层哪些步骤需要执行（排除因依赖失败而跳过的）
            to_run: list[ActStep] = []
            for step in level:
                blocked_deps = failed_steps & set(step.dependencies)
                if blocked_deps:
                    # 依赖失败 → 跳过
                    results[step.index] = TaskResult(
                        task_id=str(uuid.uuid4()),
                        step_index=step.index,
                        status="skipped",
                        output=f"跳过：依赖步骤 {sorted(blocked_deps)} 失败",
                    )
                    failed_steps.add(step.index)
                else:
                    to_run.append(step)

            # 并行执行本层待执行步骤
            if to_run:
                coros = [self._execute_step(step, act.act_id, event_publisher) for step in to_run]
                level_results = await asyncio.gather(*coros, return_exceptions=True)
                for step, result in zip(to_run, level_results):
                    if isinstance(result, BaseException):
                        tr = TaskResult(
                            task_id=str(uuid.uuid4()),
                            step_index=step.index,
                            status="failed",
                            error=str(result),
                        )
                        results[step.index] = tr
                        failed_steps.add(step.index)
                    else:
                        results[step.index] = result
                        if result.status == "failed":
                            failed_steps.add(step.index)

        elapsed = time.monotonic() - start_time
        ordered_results = [results[i] for i in sorted(results)]
        total_tokens = sum(r.tokens_consumed for r in ordered_results)

        # 确定整体状态
        statuses = {r.status for r in ordered_results}
        overall: Literal["completed", "partial", "failed"]
        if statuses == {"success"}:
            overall = "completed"
        elif "success" in statuses:
            overall = "partial"
        else:
            overall = "failed"

        return ExecutionReport(
            act_id=act.act_id,
            overall_status=overall,
            task_results=ordered_results,
            total_tokens_consumed=total_tokens,
            execution_time_seconds=round(elapsed, 3),
        )

    def resolve_skill(self, skill_name: str) -> TaskExecutor | None:
        """根据 Skill 名查找对应的内阁部长。"""
        return self._cabinet.get(skill_name)

    # ----- 内部方法 -----

    async def _execute_step(self, step: ActStep, act_id: str, event_publisher: Any | None = None) -> TaskResult:
        """执行单个步骤。"""
        executor = self.resolve_skill(step.required_skill)
        if executor is None:
            return TaskResult(
                task_id=str(uuid.uuid4()),
                step_index=step.index,
                status="failed",
                error=f"无法找到 Skill '{step.required_skill}' 对应的执行者",
            )

        if event_publisher:
            await event_publisher("running", step.required_skill, step.index)

        task = ExecutionTask(
            task_id=str(uuid.uuid4()),
            act_id=act_id,
            step=step,
            assigned_to=executor.role,
        )
        result = await executor.execute_task(task)

        if event_publisher:
            await event_publisher(result.status, step.required_skill, step.index)

        return result

    @staticmethod
    def _topological_sort(steps: list[ActStep]) -> list[list[ActStep]]:
        """将步骤按依赖关系分层（Kahn 拓扑排序）。

        Returns:
            分层结果，每层包含可并行执行的步骤列表。
        """
        step_map: dict[int, ActStep] = {s.index: s for s in steps}
        in_degree: dict[int, int] = {s.index: 0 for s in steps}
        dependents: dict[int, list[int]] = defaultdict(list)

        for s in steps:
            for dep in s.dependencies:
                if dep in step_map:
                    dependents[dep].append(s.index)
                    in_degree[s.index] += 1

        queue: deque[int] = deque(
            idx for idx, deg in in_degree.items() if deg == 0
        )
        levels: list[list[ActStep]] = []

        while queue:
            current_level: list[ActStep] = []
            next_queue: deque[int] = deque()
            while queue:
                idx = queue.popleft()
                current_level.append(step_map[idx])
                for dep_idx in dependents[idx]:
                    in_degree[dep_idx] -= 1
                    if in_degree[dep_idx] == 0:
                        next_queue.append(dep_idx)
            levels.append(current_level)
            queue = next_queue

        return levels
