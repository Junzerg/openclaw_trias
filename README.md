# 🏛️ OpenClaw Republic

> **三权分立 AI Agent 协作框架** — 用像素风演播厅展示 AI 民主协作过程。

项目代号：**OpenClaw-Republic / DangZongTong (当总统)**

## 架构概览

OpenClaw Republic 将多 Agent 协作建模为三权分立政府体制：

| 分支 | 角色 | 职责 |
|------|------|------|
| 🏛️ **立法** (Legislative) | 议长、激进派议员、保守派议员 | 接收请愿 → 辩论 → 表决 → 产出《执行法案》 |
| 🏢 **行政** (Executive) | 总统、工程部长、国务卿 | 签署/否决法案 → 拆解任务 → 执行 |
| ⚖️ **司法** (Judicial) | 首席大法官、规则引擎 | 违宪审查 → 安全熔断 → 判决 |

## 快速开始

### 1. 创建虚拟环境

```bash
# 在项目根目录
python -m venv .venv

# Windows
.venv\Scripts\python.exe --version

# Linux/macOS
.venv/bin/python --version
```

### 2. 安装项目

```bash
# Windows
.venv\Scripts\pip.exe install -e .

# 安装开发依赖
.venv\Scripts\pip.exe install -e ".[dev]"
```

### 3. 运行测试

```bash
# Windows
.venv\Scripts\pytest.exe

# Linux/macOS
.venv/bin/pytest
```

## 项目结构

```
openclaw_trias/                      # Git 仓库根目录
├── openclaw_republic/               # Python 主包
│   ├── government.py                # CyberGovernment 入口类
│   ├── agents/                      # Agent 定义
│   │   ├── base.py                  # Agent 基类 & RBAC
│   │   ├── legislative/             # 立法分支
│   │   ├── executive/               # 行政分支
│   │   └── judicial/                # 司法分支
│   ├── schemas/                     # 数据模型
│   ├── bus/                         # 三权通信总线
│   ├── config/                      # 配置加载
│   └── server/                      # API & WebSocket
├── config/souls/                    # SOUL.md 人设文件
├── tests/                           # 测试
├── frontend/                        # 像素演播厅前端
├── assets/                          # 美术资源
├── scripts/                         # 开发/部署脚本
├── docs/                            # 文档
└── pyproject.toml                   # 项目配置
```

## ⚠️ 环境规约

> **严禁污染系统 Python 环境。** 所有 `pip` / `python` / `pytest` 命令必须使用 `.venv` 中的可执行文件。

## 开发状态

- [x] Phase 0 · Task 0-A — 项目骨架搭建
- [ ] Phase 0 · Task 0-B — 配置体系 & 数据模型
- [ ] Phase 0 · Task 0-C — Dev 工具链
- [ ] Phase 1 — 三权 Agent 状态机
- [ ] Phase 2 — API & WebSocket 桥接
- [ ] Phase 3 — 像素演播厅前端
- [ ] Phase 4 — 集成 & UX 优化
- [ ] Phase 5 — 极致发布

## License

See [LICENSE](LICENSE) file.
