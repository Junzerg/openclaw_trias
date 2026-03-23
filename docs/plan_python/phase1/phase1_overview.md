# Phase 1 · 后端核心：三权 Agent 状态机

> **目标**：实现三个 Branch 的 Agent Persona、RBAC 权限隔离、状态流转和协作协议。**这是整个系统的心脏。**
> **前置依赖**：Phase 0（项目脚手架 & SOUL.md）
> **预估复杂度**：⭐⭐⭐⭐ 高
> **优先级**：🔴 核心 — 建议拆 5-6 个会话迭代
> **建议拆分**：RBAC 基础 → 立法分支 → 行政分支 → 司法分支 → 协作总线

---

## 1.1 Agent 基础框架 & RBAC

| 序号 | 工作项 | 说明 |
|------|--------|------|
| 1.1.1 | **Agent 基类 (`BaseAgent`)** | SOUL.md 加载、LLM 调用接口、权限声明、消息收发、生命周期管理 |
| 1.1.2 | **RBAC 权限模型** | 权限枚举定义 ⬇️ |
| 1.1.3 | **Workspace 物理隔离** | 立法分支无法调用 CodeExecution/FileOps 等工具（物理层面不挂载），行政分支无法生成规划文本 |
| 1.1.4 | **SOUL.md 加载引擎** | 读取 `config/souls/*.md`，解析注入 Agent 的 System Prompt，支持热更新 |

### RBAC 权限矩阵

| 权限 | 说明 | 立法 | 行政 | 司法 |
|------|------|:----:|:----:|:----:|
| `PLAN` | 规划权：生成/修改方案 | ✅ | ❌ | ❌ |
| `EXECUTE` | 执行权：调用底层工具 | ❌ | ✅ | ❌ |
| `MONITOR` | 监控权：只读监听 | ❌ | ❌ | ✅ |
| `VETO` | 否决权：打回法案 | ❌ | ✅ (总统) | ❌ |
| `KILL` | 熔断权：强制终止 | ❌ | ❌ | ✅ |

---

## 1.2 立法分支 (Legislative Branch)

目录：`openclaw_republic/agents/legislative/`

| 序号 | 工作项 | 说明 |
|------|--------|------|
| 1.2.1 | **议长 Agent (Speaker)** | 流程编排器：接收选民请愿 → 发起提案 → 控制辩论 Token 预算 → 判定终止条件 → 发起表决 → 产出《执行法案》JSON |
| 1.2.2 | **激进派议员 Agent (Radical MP)** | 通过 SOUL.md 注入极客/激进人设。偏好前沿技术栈、代码极简，提议大胆，容易产生边界幻觉 |
| 1.2.3 | **保守派议员 Agent (Conservative MP)** | 通过 SOUL.md 注入防御性/保守人设（Red Team）。专挑性能瓶颈、内存泄漏、安全漏洞 |
| 1.2.4 | **议会辩论协议 (`debate.py`)** | 多轮 Critique → Rebuttal → 分歧度评估 → 阈值判定 → 共识 → 投票表决 |
| 1.2.5 | **《执行法案》Schema** | JSON Schema 定义：目标、步骤列表、每步所需 Skill、工具参数声明、预估 Token、验收标准 |
| 1.2.6 | **Conflict Score 引擎** | 量化辩论分歧度 (0~100)，驱动前端 Lv1 (< 50) / Lv2 (50~80) / Lv3 (> 80) 动画切换 |

### 辩论协议流程

```
选民请愿 (Prompt)
    │
    ▼
┌─ 议长接收 ──┐
│  分配辩论预算  │
└──────────────┘
    │
    ▼
┌─ 激进派提案 ─┐     ┌─ 保守派 Critique ─┐
│  展开卷轴      │ ──→ │  找茬 & 反对        │
└───────────────┘     └────────────────────┘
    │                         │
    ▼                         ▼
┌─ 激进派 Rebuttal ─┐  ┌─ Conflict Score 计算 ─┐
│  反驳 & 修正        │  │  < 阈值? 继续辩论      │
└────────────────────┘  │  ≥ 阈值? 议长控场      │
    │                   └───────────────────────┘
    ▼
  (循环直到共识)
    │
    ▼
┌─ 议长表决 ──────┐
│  生成《执行法案》  │
│  发往行政分支      │
└─────────────────┘
```

---

## 1.3 行政分支 (Executive Branch)

目录：`openclaw_republic/agents/executive/`

| 序号 | 工作项 | 说明 |
|------|--------|------|
| 1.3.1 | **总统 Agent (President)** | 接收法案 → Token 预算校验 → Skill 可用性校验 → 行使 Veto 或签署 → 拆解 Task 派发内阁 |
| 1.3.2 | **工程部长 Agent (Sec. of Engineering)** | 挂载 `CodeExecution`, `Python_Interpreter`, `GitHub` 技能，负责实际编码与环境操作 |
| 1.3.3 | **国务卿 Agent (Sec. of State)** | 挂载 `WebBrowser`, `Search` 技能，负责外部信息检索与 API 交互 |
| 1.3.4 | **执行引擎** | 按法案步骤列表顺序/并行调用 Skill，管理 Token 预算消耗，收集执行结果 |
| 1.3.5 | **Veto 机制** | Token 不足 / Skill 不可用时，总统否决并附 reason 打回立法分支重构 |

### Skill 挂载映射

| Agent | 挂载 Skills | 权限 |
|-------|------------|------|
| 工程部长 | `CodeExecution`, `Python_Interpreter`, `GitHub` | EXECUTE |
| 国务卿 | `WebBrowser`, `Search` | EXECUTE |
| 总统 | 无直接 Skill | VETO |

---

## 1.4 司法分支 (Judicial Branch)

目录：`openclaw_republic/agents/judicial/`

| 序号 | 工作项 | 说明 |
|------|--------|------|
| 1.4.1 | **首席大法官 Agent (Chief Justice)** | 最高安全审查 Prompt，旁路监听行政动作，对标"都察院/刑部" |
| 1.4.2 | **违宪规则引擎 (`rules_engine.py`)** | 从 `constitution.yaml` 加载规则集 |
| 1.4.3 | **过程违宪审查 (Process Review)** | 实时沙箱监听：危险命令检测 (`rm -rf`, `DROP TABLE`, 越权读取私钥)、死循环检测、资源超限检测 |
| 1.4.4 | **结果违宪审查 (Result Review)** | 交付验收：比对《选民原始请愿》vs《最终产物》，LLM-as-a-Judge 评估产出偏离度（幻觉检测）|
| 1.4.5 | **物理熔断机制 (Kill Switch)** | 违宪判定后：强制 Kill 容器/进程 → 回滚状态 → 生成判决书（含违宪理由 + Traceback）→ 打回立法重做 |

### 双通道违宪审查架构

```
                    ┌──────────────────────────┐
                    │   首席大法官 (Chief Justice)│
                    │   MONITOR + KILL 权限      │
                    └──────┬───────────┬────────┘
                           │           │
              ┌────────────▼──┐   ┌───▼─────────────┐
              │ 过程违宪审查    │   │ 结果违宪审查      │
              │ (Process)      │   │ (Result)         │
              │ 实时沙箱监听    │   │ 交付前验收        │
              │ · 黑名单命令   │   │ · 请愿 vs 产物   │
              │ · 死循环检测   │   │ · 偏离度评分      │
              │ · 资源超限     │   │ · 幻觉检测        │
              └───────────────┘   └──────────────────┘
```

---

## 1.5 三权协作总线

目录：`openclaw_republic/bus/`

| 序号 | 工作项 | 说明 |
|------|--------|------|
| 1.5.1 | **消息总线 (`message_bus.py`)** | 三分支间的异步消息传递协议 (内存队列 `asyncio.Queue`，后续可扩展 Redis/NATS) |
| 1.5.2 | **法案生命周期状态机 (`state_machine.py`)** | 完整生命周期见下方 ⬇️ |
| 1.5.3 | **结构化事件日志** | 所有 Agent action 统一记录为结构化事件（含 `emotion`, `intensity` 等字段），直接对标 PRD §4 的 WebSocket 事件格式 |

### 法案生命周期状态机

```
Petition → Drafting → Debating → Voted
                                   │
                          ┌────────┴────────┐
                          ▼                  ▼
                       Signed             Vetoed
                          │                  │
                          ▼                  ▼
                      Executing         (回到 Drafting)
                          │
                          ▼
                      Reviewing
                          │
                 ┌────────┴────────┐
                 ▼                  ▼
          Constitutional      Unconstitutional
                 │                  │
                 ▼                  ▼
            Delivered         (回到 Drafting)
```

---

## 验收标准

- [x] `BaseAgent` 基类可复用，RBAC 校验有效
- [x] 3 个立法 Agent 可进行多轮辩论，产出结构化《执行法案》
- [ ] Conflict Score 可计算并影响辩论流程
- [x] 总统可签署/否决法案
- [x] 工程部长和国务卿可调用对应 Skill
- [x] 大法官可检测违宪行为并触发熔断
- [x] 完整 Pipeline 可在 CLI 跑通：Prompt → 辩论 → 表决 → 签署 → 执行 → 审判 → 结果
- [ ] 所有 Agent 通过 SOUL.md 配置人设

---

## Task 拆分
Phase 1 拆分为 6 个独立闭环的开发任务，按顺序执行：

| Task | 标题 | 涵盖子项 | 预估 | 状态 |
|------|------|---------|------|------|
| [Task 1-A](task1.1_agent_base_rbac.md) | Agent 基类 & RBAC 权限模型 | 1.1 全部 | 1 会话 | ✅ 已完成 |
| [Task 1-B](task1.2_legislative_branch.md) | 立法分支核心 | 1.2.1~1.2.4 | 1-2 会话 | ✅ 已完成 |
| [Task 1-C](task1.3_conflict_score_and_act_schema.md) | Conflict Score & 法案 Schema | 1.2.5~1.2.6 | 1 会话 | ✅ 已完成 |
| [Task 1-D](task1.4_executive_branch.md) | 行政分支 | 1.3 全部 | 1-2 会话 | ✅ 已完成 |
| [Task 1-E](task1.5_judicial_branch.md) | 司法分支 | 1.4 全部 | 1-2 会话 | ✅ 已完成 |
| [Task 1-F](task1.6_bus_and_integration.md) | 协作总线 & 端到端集成 | 1.5 全部 + 端到端 | 1-2 会话 | ✅ 已完成 |

**依赖关系**：`Task 1-A` → `Task 1-B` → `Task 1-C` → `Task 1-D` → `Task 1-E` → `Task 1-F`

---

## 后续衔接

- ← 前置：[Phase 0 · 项目脚手架](../phase0/phase0_overview.md)
- → 后续：[Phase 2 · 通信桥接层](../phase2/phase2_overview.md)
