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
