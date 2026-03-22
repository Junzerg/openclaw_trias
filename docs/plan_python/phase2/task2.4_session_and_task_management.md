# Task 2.4 - Session and Task Management (Schema & Plan)

> **备注**：此文档内容为响应 “在 `@docs/plan/phase2/` 目录下新建 `task2.4_session_and_task_management.md`” 的请求而创建。
> （注：大部分内容已提前由 `task2.4_rest_query_and_concurrency.md` 详尽定义，我们在实际执行时将遵守该预设需求）

## 1. Schema Design (响应模型)

```python
class TaskListResponse(BaseModel):
    total: int
    offset: int
    limit: int
    tasks: list[TaskSummary]

class ActResponse(BaseModel):
    task_id: str
    act: dict  # JSON serialized act content
    created_at: datetime

class DebateResponse(BaseModel):
    task_id: str
    rounds: list[DebateRound]
    conflict_score_curve: list[float]

class VerdictResponse(BaseModel):
    task_id: str
    constitutional: bool
    ruling: str
    evidence: list[str]
    created_at: datetime
```

## 2. 数据库表结构 (SQLite Extended)

除了原本的任务主表 `tasks` 之外，将新增：
- **`events`** 表：记录所有事件流（Action, Emotion, Intensity, Payload 等）用于聚合辩论记录重构。
- **`acts`** 表：通过任务后序列化落盘完整的法案。
- **`verdicts`** 表：存储最后一步司法审查得到的判定细节。

## 3. 实现计划

参见我们在 Brain Directory 自动生成的 `implementation_plan.md`，重点包括解耦事件持久化、使用 `Semaphore` 开发基于协程队列的资源锁以约束并发数量，以及 REST API 端点的搭建。
