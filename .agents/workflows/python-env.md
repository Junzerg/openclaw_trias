---
description: Python 虚拟环境使用规约 — 所有 Python 相关操作必须遵守
---

# Python 环境规约

## ⚠️ 最高优先级规则：严禁污染系统 Python

本项目使用项目根目录下的 `.venv` 虚拟环境，**所有 Python 相关命令都必须使用 `.venv` 中的可执行文件**。

## Windows 环境

```powershell
# ✅ 正确用法 — 始终使用 .venv 路径
.venv\Scripts\python.exe <script>
.venv\Scripts\pip.exe install <package>
.venv\Scripts\pytest.exe
.venv\Scripts\ruff.exe check .
.venv\Scripts\mypy.exe openclaw_republic/

# ❌ 错误用法 — 绝对禁止直接调用系统 Python
python <script>
pip install <package>
pytest
```

## 关键规则

1. **安装依赖**：`.venv\Scripts\pip.exe install -e ".[dev]"`
2. **运行测试**：`.venv\Scripts\pytest.exe -v`
3. **运行脚本**：`.venv\Scripts\python.exe <script.py>`
4. **代码检查**：`.venv\Scripts\ruff.exe check .`
5. **类型检查**：`.venv\Scripts\mypy.exe openclaw_republic/`

## 如何验证使用了正确的环境

```powershell
# 检查 Python 路径 — 必须包含 .venv
.venv\Scripts\python.exe -c "import sys; print(sys.executable)"
# 预期输出: D:\Projects\Privates\openclaw_trias\.venv\Scripts\python.exe
```

## 虚拟环境不存在时

如果 `.venv` 目录不存在，先创建：

```powershell
python -m venv .venv
.venv\Scripts\pip.exe install -e ".[dev]"
```
