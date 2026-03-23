# Task 0-A · 项目骨架搭建

> **对应 Phase 0 子项**：0.1 Python 项目初始化 + 0.2 Monorepo 目录规划
> **前置依赖**：无
> **预估工作量**：1 个会话
> **状态**：✅ 已完成

---

## 目标

搭建可安装、可测试的 Python 项目骨架和标准化目录结构，为后续所有 Task 提供可运行的根基。

---

## ⚠️ 环境规约（贯穿所有 Task）

> **严禁污染系统 Python 环境。** 本项目全程使用项目本地虚拟环境。

1. 在项目根目录创建虚拟环境：`python -m venv .venv`
2. 后续所有命令**必须使用 `.venv` 中的 Python 解释器**：
   - Windows: `.venv\Scripts\python.exe`、`.venv\Scripts\pip.exe`、`.venv\Scripts\pytest.exe`
   - Linux/macOS: `.venv/bin/python`、`.venv/bin/pip`
3. `pip install -e .` 和 `pip install -e ".[dev]"` 都在 `.venv` 内执行
4. `pytest`、`ruff`、`mypy` 等工具都通过 `.venv` 调用
5. `.venv/` 目录已在 `.gitignore` 中排除，不提交到 Git

**此规约适用于 Task 0-A、0-B、0-C 及后续所有 Phase 的开发和测试。**

---

## 具体步骤

### Step 1：创建虚拟环境

```powershell
# 在项目根目录执行
python -m venv .venv

# 验证
.venv\Scripts\python.exe --version
```

确认 `.venv\Scripts\python.exe` 存在且版本 ≥ 3.11。

### Step 2：创建 `pyproject.toml`

```toml
[project]
name = "openclaw-republic"
version = "0.1.0"
description = "OpenClaw Republic — 三权分立 AI Agent 协作框架"
requires-python = ">=3.11"
dependencies = [
    "pydantic>=2.0",
    "pydantic-settings>=2.0",
    "structlog>=23.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0",
    "ruff>=0.1",
    "mypy>=1.0",
    "pre-commit>=3.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.ruff]
target-version = "py311"
line-length = 100

[tool.mypy]
python_version = "3.11"
strict = true

[tool.pytest.ini_options]
testpaths = ["tests"]
```

> 注意：具体依赖版本号在实施时以最新稳定版为准。

### Step 3：创建 Python 主包结构

创建 `openclaw_republic/` 包目录及所有子包的 `__init__.py`：

```
openclaw_republic/
├── __init__.py                    # 版本号 + 顶层导出
├── government.py                  # CyberGovernment 入口类（占位）
├── agents/
│   ├── __init__.py
│   ├── base.py                    # Agent 基类（占位）
│   ├── legislative/
│   │   ├── __init__.py
│   │   ├── speaker.py             # 占位
│   │   ├── radical_mp.py          # 占位
│   │   ├── conservative_mp.py     # 占位
│   │   └── debate.py              # 占位
│   ├── executive/
│   │   ├── __init__.py
│   │   ├── president.py           # 占位
│   │   ├── sec_engineering.py     # 占位
│   │   └── sec_state.py           # 占位
│   └── judicial/
│       ├── __init__.py
│       ├── chief_justice.py       # 占位
│       └── rules_engine.py        # 占位
├── schemas/
│   ├── __init__.py
│   ├── act.py                     # 占位
│   ├── events.py                  # 占位
│   └── verdict.py                 # 占位
├── bus/
│   ├── __init__.py
│   ├── message_bus.py             # 占位
│   └── state_machine.py           # 占位
├── config/
│   ├── __init__.py
│   ├── loader.py                  # 占位
│   └── models.py                  # 占位
└── server/
    ├── __init__.py
    ├── app.py                     # 占位
    ├── routes.py                  # 占位
    └── websocket.py               # 占位
```

**占位文件内容规范**：
- 每个文件包含模块级 docstring，说明此模块的职责
- 定义该模块的核心类/函数签名（`pass` 实现）
- 例如 `government.py`：
  ```python
  """CyberGovernment — 三权分立政府的入口类。"""

  class CyberGovernment:
      """三权分立 AI 协作政府的主入口。"""

      def inaugurate(self, port: int = 8080) -> None:
          """启动三权协作系统。"""
          raise NotImplementedError
  ```

### Step 4：创建项目级辅助目录

```
openclaw_trias/                     # 仓库根目录
├── config/                         # 用户可编辑配置区（空目录占位）
│   └── souls/                      # SOUL.md 文件待 Task 0-B 填充
├── frontend/                       # Phase 3 前端（空目录占位）
├── assets/
│   ├── sprites/
│   ├── tilemaps/
│   ├── sfx/
│   └── props/
├── scripts/                        # 开发/部署脚本（空目录占位）
├── tests/
│   ├── __init__.py
│   ├── unit/
│   │   └── __init__.py
│   ├── integration/
│   │   └── __init__.py
│   └── e2e/
│       └── __init__.py
└── docs/                           # 已存在
```

> 空目录用 `.gitkeep` 文件保留。

### Step 5：编写 Smoke Test

`tests/unit/test_smoke.py`：

```python
"""Smoke test — 确认包结构可导入。"""

def test_package_importable():
    """openclaw_republic 包可以被正常导入。"""
    import openclaw_republic
    assert openclaw_republic is not None

def test_government_class_exists():
    """CyberGovernment 类存在且可实例化。"""
    from openclaw_republic.government import CyberGovernment
    gov = CyberGovernment()
    assert gov is not None
```

### Step 6：更新 `README.md`

补充项目基本说明、安装方式（注明使用 `.venv`）、快速开始。

---

## 产出文件清单

| 文件 | 说明 |
|------|------|
| `.venv/` | 项目本地虚拟环境（不提交 Git） |
| `pyproject.toml` | 项目元数据 & 依赖声明 |
| `openclaw_republic/**/__init__.py` | 所有包和子包初始化 |
| `openclaw_republic/government.py` | 入口类占位 |
| `openclaw_republic/agents/base.py` | Agent 基类占位 |
| `openclaw_republic/agents/legislative/*.py` | 立法分支模块占位 |
| `openclaw_republic/agents/executive/*.py` | 行政分支模块占位 |
| `openclaw_republic/agents/judicial/*.py` | 司法分支模块占位 |
| `openclaw_republic/schemas/*.py` | 数据模型占位 |
| `openclaw_republic/bus/*.py` | 消息总线占位 |
| `openclaw_republic/config/*.py` | 配置加载占位 |
| `openclaw_republic/server/*.py` | API 服务占位 |
| `tests/unit/test_smoke.py` | 烟雾测试 |
| `README.md` | 项目说明（更新） |

---

## 验收标准

- [x] `.venv` 虚拟环境存在，Python 版本 ≥ 3.11 — ✅ Python 3.12.10
- [x] `.venv\Scripts\pip.exe install -e .` 成功安装，无报错
- [x] `.venv\Scripts\python.exe -c "from openclaw_republic.government import CyberGovernment"` 可执行
- [x] `.venv\Scripts\pytest.exe` 通过（3/3 smoke test 绿灯，0.04s）
- [x] 目录结构与 Phase 0 Overview 中的规划一致
- [x] 所有占位模块包含有意义的 docstring 和类/函数签名
- [x] 未在系统 Python 中安装任何依赖

---

## 不包含（由后续 Task 处理）

- ❌ SOUL.md 人设文件内容（→ Task 0-B）
- ❌ constitution.yaml 配置内容（→ Task 0-B）
- ❌ 事件基类实现（→ Task 0-B）
- ❌ pre-commit / CI / Docker（→ Task 0-C）

---

## 后续衔接

完成后进入 → [Task 0-B · 配置体系 & 数据模型](task0.2_config_and_models.md)

---

## 完成记录

- **完成时间**：2026-03-20
- **验收结果**：7/7 全部通过
- **Python 版本**：3.12.10（使用 `py -3` 创建 venv，系统 `python` 不在 PATH）
- **额外产出**：新增 `.gitignore`（排除 `.venv/` 及 Python 常见产物）
