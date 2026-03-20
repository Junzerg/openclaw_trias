# Task 0-C · Dev 工具链 & 容器化

> **对应 Phase 0 子项**：0.6 Dev 工具链
> **前置依赖**：Task 0-A（项目骨架搭建）— 需要 pyproject.toml 和包结构就位
> **预估工作量**：1 个会话
> **状态**：🔲 待开始

---

## 目标

配置开发工具链（代码质量自动化）和容器化环境（一键启动），确保多人协作和 CI/CD 的基础设施就绪。

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

执行：`pre-commit install` 激活 hooks。

### Step 2：配置 GitHub Actions CI

创建 `.github/workflows/ci.yml`：

```yaml
name: CI

on:
  push:
    branches: [main, dev/*]
  pull_request:
    branches: [main]

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.11", "3.12"]

    steps:
      - uses: actions/checkout@v4

      - name: Set up Python ${{ matrix.python-version }}
        uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -e ".[dev]"

      - name: Lint with ruff
        run: ruff check .

      - name: Format check
        run: ruff format --check .

      - name: Type check with mypy
        run: mypy openclaw_republic/

      - name: Run tests
        run: pytest -v
```

### Step 3：创建 Docker Compose 开发环境

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

### Step 4：创建 Makefile

```makefile
.PHONY: install dev lint format typecheck test docker-up docker-down clean

# 安装
install:
	pip install -e .

dev:
	pip install -e ".[dev]"
	pre-commit install

# 代码质量
lint:
	ruff check .

format:
	ruff format .

typecheck:
	mypy openclaw_republic/

# 测试
test:
	pytest -v

test-cov:
	pytest -v --cov=openclaw_republic --cov-report=term-missing

# Docker
docker-up:
	docker compose up --build -d

docker-down:
	docker compose down

docker-test:
	docker compose run --rm app pytest -v

# 清理
clean:
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type d -name .mypy_cache -exec rm -rf {} +
	find . -type d -name .ruff_cache -exec rm -rf {} +
	find . -type d -name .pytest_cache -exec rm -rf {} +
	rm -rf dist/ build/ *.egg-info
```

### Step 5：创建 `.gitignore`（更新）

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
.vscode/
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

### Step 6：验证全链路

1. `make dev` — 安装开发依赖 + 激活 pre-commit
2. `make lint` — ruff 检查通过
3. `make typecheck` — mypy 检查通过
4. `make test` — pytest 全绿
5. `make docker-up` — Docker 容器启动成功
6. `make docker-test` — 容器内测试通过
7. 故意引入 lint 错误 → `git commit` → pre-commit 拦截 ✅

---

## 产出文件清单

| 文件 | 说明 |
|------|------|
| `.pre-commit-config.yaml` | pre-commit 钩子配置 |
| `.github/workflows/ci.yml` | GitHub Actions CI 流水线 |
| `Dockerfile` | 开发环境容器镜像 |
| `docker-compose.yml` | 开发环境编排 |
| `.dockerignore` | Docker 构建排除规则 |
| `Makefile` | 常用命令快捷方式 |
| `.gitignore` | Git 忽略规则（更新） |

---

## 验收标准

- [ ] `make dev` 成功安装所有开发依赖
- [ ] `pre-commit run --all-files` 通过（或仅有预期的自动修复）
- [ ] `make lint && make typecheck && make test` 全部通过
- [ ] `docker compose up --build` 容器启动无报错
- [ ] `docker compose run --rm app pytest -v` 容器内测试通过
- [ ] `.github/workflows/ci.yml` 语法正确（可用 `actionlint` 校验）
- [ ] `Makefile` 中所有 target 可正常执行
- [ ] pre-commit 可拦截不合规的代码提交

---

## 不包含（由其他 Task / Phase 处理）

- ❌ 生产部署配置（Nginx/Caddy 反代）（→ Phase 5）
- ❌ 前端构建流程（→ Phase 3）
- ❌ Redis / 数据库容器（→ Phase 2 按需添加）

---

## 后续衔接

Task 0-C 完成后，Phase 0 全部完成 ✅

进入 → [Phase 1 · 后端核心：三权 Agent 状态机](../phase1/phase1_overview.md)
