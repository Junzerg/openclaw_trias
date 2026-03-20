# Phase 0 · 项目脚手架 & 基础设施

> **目标**：搭好项目骨架，让后续所有 Phase 有可运行的根基。
> **前置依赖**：无
> **预估复杂度**：⭐ 低
> **优先级**：🔴 首先 — 一次性搭好，后续所有工作基于此

---

## 0.1 Python 项目初始化

- 创建 `pyproject.toml`（包名 `openclaw-republic`）
- 包结构入口 `openclaw_republic/`
- 开发依赖：`pytest`, `ruff`, `mypy`
- 运行时依赖：`pydantic`, `pydantic-settings`, `structlog` / `loguru`
- 配置 `pip install -e .` 可编辑安装

## 0.2 Monorepo 目录规划

按 PRD v3 架构搭建标准化目录：

```
openclaw_trias/                         # Git 仓库根目录
├── openclaw_republic/                  # Python 主包
│   ├── __init__.py
│   ├── government.py                   # CyberGovernment 入口类
│   ├── agents/                         # Agent 定义
│   │   ├── __init__.py
│   │   ├── base.py                     # Agent 基类 & RBAC 权限模型
│   │   ├── legislative/                # 立法分支
│   │   │   ├── __init__.py
│   │   │   ├── speaker.py              # 议长
│   │   │   ├── radical_mp.py           # 激进派议员
│   │   │   ├── conservative_mp.py      # 保守派议员
│   │   │   └── debate.py              # 议会辩论协议 & 表决引擎
│   │   ├── executive/                  # 行政分支
│   │   │   ├── __init__.py
│   │   │   ├── president.py            # 总统（Veto 机制）
│   │   │   ├── sec_engineering.py      # 工程部长
│   │   │   └── sec_state.py            # 国务卿
│   │   └── judicial/                   # 司法分支
│   │       ├── __init__.py
│   │       ├── chief_justice.py        # 首席大法官
│   │       └── rules_engine.py         # 违宪规则引擎
│   ├── schemas/                        # 数据模型
│   │   ├── __init__.py
│   │   ├── act.py                      # 《执行法案》JSON Schema
│   │   ├── events.py                   # WebSocket 事件模型
│   │   └── verdict.py                  # 司法判决模型
│   ├── bus/                            # 三权通信总线
│   │   ├── __init__.py
│   │   ├── message_bus.py              # 消息传递协议
│   │   └── state_machine.py            # 法案生命周期状态机
│   ├── config/                         # 配置加载
│   │   ├── __init__.py
│   │   ├── loader.py                   # constitution.yaml & SOUL.md 加载器
│   │   └── models.py                   # 配置 Pydantic 模型
│   └── server/                         # API & WebSocket (Phase 2)
│       ├── __init__.py
│       ├── app.py                      # FastAPI 应用
│       ├── routes.py                   # REST API 路由
│       └── websocket.py                # WebSocket 事件推送
├── config/                             # 用户可编辑配置区
│   ├── souls/                          # SOUL.md 人设文件
│   │   ├── speaker.md
│   │   ├── radical_mp.md
│   │   ├── conservative_mp.md
│   │   ├── president.md
│   │   ├── sec_engineering.md
│   │   ├── sec_state.md
│   │   └── chief_justice.md
│   └── constitution.yaml               # 宪法全局红线
├── frontend/                            # 像素演播厅前端 (Phase 3)
├── assets/                              # 美术资源
│   ├── sprites/                         # Sprite Sheets
│   ├── tilemaps/                        # 场景背景
│   ├── sfx/                             # 音效
│   └── props/                           # 道具特效
├── scripts/                             # 开发/部署脚本
├── tests/                               # 测试
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/                                # 文档
├── docker-compose.yml
├── pyproject.toml
├── README.md
└── LICENSE
```

## 0.3 SOUL.md 人设配置框架

在 `config/souls/` 目录下，为每个 Agent 编写初始 SOUL.md 人设文件：

| 文件 | 角色 | 人设关键词 |
|------|------|-----------|
| `speaker.md` | 议长 | 流程控制、中立、秩序维护 |
| `radical_mp.md` | 激进派议员 | 极客、前沿技术、大胆、追求效率 |
| `conservative_mp.md` | 保守派议员 | Red Team、防御性、找茬、安全边界 |
| `president.md` | 总统 | 务实、预算敏感、任务分派 |
| `sec_engineering.md` | 工程部长 | 编码执行、环境操作、工程严谨 |
| `sec_state.md` | 国务卿 | 外部信息检索、API 交互 |
| `chief_justice.md` | 首席大法官 | 最高安全审查、铁面无私、合规 |

SOUL.md 格式规范：
- 标题：角色名 + 官方称号
- 人格特质：3-5 条核心性格描述
- 职责边界：明确能做什么、不能做什么
- 输出风格：语气、用词习惯
- System Prompt 模板

## 0.4 宪法配置系统 (`constitution.yaml`)

全局红线配置，定义司法分支的违宪审查规则：

```yaml
# constitution.yaml 预期结构
version: "1.0"

judicial:
  blacklist_commands:
    - "rm -rf"
    - "DROP TABLE"
    - "FORMAT"
    - "deltree"
    # ... 更多危险命令

  token_budget:
    max_per_task: 100000        # 单任务最大 Token
    debate_budget: 30000         # 辩论阶段预算
    execution_budget: 50000      # 执行阶段预算

  debate:
    max_rounds: 10               # 最大辩论轮次
    conflict_threshold: 80       # 分歧度阈值，超过触发 Lv2

  deviation:
    max_score: 0.3               # 产出偏离度阈值 (0~1)

security:
  sandbox_enabled: true
  allowed_file_extensions: [".py", ".js", ".ts", ".md", ".json", ".yaml"]
  max_execution_time_seconds: 300
```

使用 `pydantic-settings` 进行加载和校验。

## 0.5 日志 & 事件系统

- 选型：`structlog` 或 `loguru` 统一日志
- 定义结构化事件基类 `BaseEvent`：
  - `timestamp`, `source_agent`, `target_agent`
  - `action`, `emotion`, `intensity`
  - `payload` (自由扩展字段)
- 事件类型枚举直接对标 [PRD v3 §4](file:///d:/Projects/Privates/openclaw_trias/docs/prds/PRD_v3.md) 的 WebSocket 事件
- 为 Phase 2 的 WebSocket 推送铺路

## 0.6 Dev 工具链

- **pre-commit**：ruff lint + format, mypy 类型检查
- **CI (GitHub Actions)**：push/PR 自动跑 lint + test
- **Docker Compose**：开发环境一键启动
- **Makefile / Taskfile**：常用命令快捷方式

---

## Task 拆分

Phase 0 拆分为 3 个独立闭环的开发任务，按顺序执行：

| Task | 标题 | 涵盖子项 | 预估 | 状态 |
|------|------|---------|------|------|
| [Task 0-A](task0.1_project_skeleton.md) | 项目骨架搭建 | 0.1 + 0.2 | 1 会话 | 🔲 待开始 |
| [Task 0-B](task0.2_config_and_models.md) | 配置体系 & 数据模型 | 0.3 + 0.4 + 0.5 | 1-2 会话 | 🔲 待开始 |
| [Task 0-C](task0.3_devtools_and_ci.md) | Dev 工具链 & 容器化 | 0.6 | 1 会话 | 🔲 待开始 |

**依赖关系**：`Task 0-A` → `Task 0-B` → `Task 0-C`（0-B 和 0-C 对 0-A 有依赖，0-B 与 0-C 之间理论上可并行）

---

## 验收标准

- [ ] `pip install -e .` 可安装
- [ ] `pytest` 可运行（至少有一个 smoke test）
- [ ] `docker compose up` 可启动
- [ ] 所有 7 个 SOUL.md 文件就位
- [ ] `constitution.yaml` 可被 Pydantic 加载校验
- [ ] 结构化事件基类定义完成
- [ ] pre-commit hooks 配置完成

---

## 后续衔接

Phase 0 完成后，直接进入 → [Phase 1 · 后端核心：三权 Agent 状态机](../phase1/phase1_overview.md)
