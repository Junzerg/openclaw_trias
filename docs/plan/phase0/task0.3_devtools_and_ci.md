# Task 0-C · Dev 工具链 & 容器化

> **对应 Phase 0 子项**：0.6 Dev 工具链
> **前置依赖**：Task 0-A（项目骨架搭建）— 需要 pyproject.toml 和包结构就位
> **预估工作量**：1 个会话
> **状态**：✅ 已完成
> **备注**：单人开发，不设 CI/CD，聚焦本地工具链 + 容器化部署

---

## 目标

配置本地开发工具链（代码质量自动化）和容器化环境（一键部署/展示），确保代码质量和可移植部署。

---

## 具体步骤

### Step 1：配置 pre-commit

创建 `.pre-commit-config.yaml`：

```yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.4.0    # 实施时更新到最新版
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.10.0   # 实施时更新到最新版
    hooks:
      - id: mypy
        additional_dependencies:
          - pydantic>=2.0
          - pydantic-settings>=2.0

  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-toml
      - id: check-merge-conflict
```

执行：`.venv\Scripts\pre-commit.exe install` 激活 hooks。

### Step 2：创建 Docker Compose 开发/部署环境

创建 `Dockerfile`：

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖
COPY pyproject.toml .
RUN pip install --no-cache-dir -e ".[dev]"

# 复制源码
COPY . .

# 默认命令
CMD ["python", "-m", "openclaw_republic"]
```

创建 `docker-compose.yml`：

```yaml
version: "3.9"

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: openclaw-republic
    volumes:
      - .:/app                    # 开发模式挂载源码
      - /app/.venv                # 避免覆盖容器内 venv
    ports:
      - "8080:8080"               # Phase 2 API 端口预留
    environment:
      - PYTHONPATH=/app
      - LOG_LEVEL=DEBUG
    command: ["pytest", "-v"]     # 开发阶段默认跑测试

  # Phase 2+ 扩展预留
  # redis:
  #   image: redis:7-alpine
  #   ports:
  #     - "6379:6379"
```

创建 `.dockerignore`：

```
.git
.venv
__pycache__
*.pyc
.mypy_cache
.ruff_cache
.pytest_cache
node_modules
frontend/dist
assets/
docs/
```

### Step 3：创建 Makefile（本地快捷命令）

```makefile
.PHONY: install dev lint format typecheck test test-cov docker-up docker-down docker-test clean

# 安装
install:
	.venv\Scripts\pip.exe install -e .

dev:
	.venv\Scripts\pip.exe install -e ".[dev]"
	.venv\Scripts\pre-commit.exe install

# 代码质量
lint:
	.venv\Scripts\ruff.exe check .

format:
	.venv\Scripts\ruff.exe format .

typecheck:
	.venv\Scripts\mypy.exe openclaw_republic/

# 测试
test:
	.venv\Scripts\pytest.exe -v

test-cov:
	.venv\Scripts\pytest.exe -v --cov=openclaw_republic --cov-report=term-missing

# Docker
docker-up:
	docker compose up --build -d

docker-down:
	docker compose down

docker-test:
	docker compose run --rm app pytest -v

# 清理
clean:
	powershell -Command "Get-ChildItem -Recurse -Directory -Filter __pycache__ | Remove-Item -Recurse -Force"
	powershell -Command "Get-ChildItem -Recurse -Directory -Filter .mypy_cache | Remove-Item -Recurse -Force"
	powershell -Command "Get-ChildItem -Recurse -Directory -Filter .ruff_cache | Remove-Item -Recurse -Force"
	powershell -Command "Get-ChildItem -Recurse -Directory -Filter .pytest_cache | Remove-Item -Recurse -Force"
```

> **注意**：Makefile 中本地命令使用 `.venv` 路径，遵守环境规约。Docker 命令在容器内运行，不涉及本地 `.venv`。

### Step 4：更新 `.gitignore`

确保 `.gitignore` 覆盖所有开发工件：

```gitignore
# Python
__pycache__/
*.py[cod]
*$py.class
*.egg-info/
dist/
build/
*.egg

# Virtual Environment
.venv/
venv/

# IDE
.idea/
*.swp
*.swo

# Type Checking
.mypy_cache/

# Linting
.ruff_cache/

# Testing
.pytest_cache/
htmlcov/
.coverage

# Docker
docker-compose.override.yml

# OS
.DS_Store
Thumbs.db

# Environment
.env
.env.local
```

### Step 5：验证全链路

1. `make dev` — 安装开发依赖 + 激活 pre-commit
2. `make lint` — ruff 检查通过
3. `make typecheck` — mypy 检查通过
4. `make test` — pytest 全绿
5. `docker compose up --build` — 容器启动成功
6. `docker compose run --rm app pytest -v` — 容器内测试通过
7. 故意引入 lint 错误 → `git commit` → pre-commit 拦截 ✅

---

## 产出文件清单

| 文件 | 说明 |
|------|------|
| `.pre-commit-config.yaml` | pre-commit 钩子配置 |
| `Dockerfile` | 开发/部署容器镜像 |
| `docker-compose.yml` | 开发环境编排 |
| `.dockerignore` | Docker 构建排除规则 |
| `Makefile` | 常用命令快捷方式 |
| `.gitignore` | Git 忽略规则（更新） |

---

## 验收标准

- [x] `make dev` 成功安装所有开发依赖 — ✅
- [x] `pre-commit run --all-files` 通过 — ✅ ruff + mypy + hooks 全绿
- [x] `make lint && make typecheck && make test` 全部通过 — ✅ 50 passed
- [ ] `docker compose up --build` 容器启动 — ⏳ 待用户本地验证（需 Docker Desktop）
- [ ] `docker compose run --rm app pytest -v` 容器内测试 — ⏳ 待用户本地验证
- [x] pre-commit 可拦截不合规的代码提交 — ✅ hooks 已激活

---

## 不包含（由其他 Task / Phase 处理）

- ❌ GitHub Actions CI（单人开发暂不需要，后续按需添加）
- ❌ 生产部署配置（Nginx/Caddy 反代）（→ Phase 5）
- ❌ 前端构建流程（→ Phase 3）
- ❌ Redis / 数据库容器（→ Phase 2 按需添加）

---

## 后续衔接

Task 0-C 完成后，Phase 0 全部完成 ✅

进入 → [Phase 1 · 后端核心：三权 Agent 状态机](../phase1/phase1_overview.md)

---

## 完成记录

- **完成时间**：2026-03-20
- **验收结果**：4/6 通过（Docker 待用户本地验证）
- **测试概况**：50 passed, mypy strict 0 errors, pre-commit all green
- **额外修复**：7 个占位文件的泛型类型标注（mypy strict 兼容）、安装 types-PyYAML
