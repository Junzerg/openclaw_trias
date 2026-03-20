"""配置加载器 — 加载 constitution.yaml 和 SOUL.md 文件。"""

from __future__ import annotations

import re
from pathlib import Path
from threading import Lock

import yaml

from .models import ConstitutionConfig


# ---------------------------------------------------------------------------
# constitution.yaml 加载
# ---------------------------------------------------------------------------


def load_constitution(path: str | Path) -> ConstitutionConfig:
    """加载并校验 constitution.yaml。

    Args:
        path: constitution.yaml 文件路径。

    Returns:
        类型安全的 ConstitutionConfig 实例。

    Raises:
        FileNotFoundError: 配置文件不存在。
        yaml.YAMLError: YAML 解析错误。
        pydantic.ValidationError: 配置校验失败。
    """
    path = Path(path)
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    return ConstitutionConfig.model_validate(raw)


# ---------------------------------------------------------------------------
# SOUL.md 加载
# ---------------------------------------------------------------------------


def load_soul(path: str | Path) -> str:
    """加载单个 SOUL.md 文件，返回其内容。

    Args:
        path: SOUL.md 文件路径。

    Returns:
        SOUL.md 文件的完整文本内容。

    Raises:
        FileNotFoundError: 文件不存在。
    """
    path = Path(path)
    return path.read_text(encoding="utf-8")


def load_all_souls(directory: str | Path) -> dict[str, str]:
    """加载目录下所有 SOUL.md 文件，返回 {角色名: 内容} 字典。

    遍历目录中所有 .md 文件（排除 SOUL_TEMPLATE.md），
    以文件名（不含扩展名）作为角色名。

    Args:
        directory: 包含 SOUL.md 文件的目录路径。

    Returns:
        {角色名: 文件内容} 字典。

    Raises:
        FileNotFoundError: 目录不存在。
    """
    directory = Path(directory)
    if not directory.is_dir():
        msg = f"SOUL.md 目录不存在: {directory}"
        raise FileNotFoundError(msg)
    souls: dict[str, str] = {}
    for md_file in sorted(directory.glob("*.md")):
        if md_file.name == "SOUL_TEMPLATE.md":
            continue
        role_name = md_file.stem
        souls[role_name] = md_file.read_text(encoding="utf-8")
    return souls


# ---------------------------------------------------------------------------
# System Prompt 提取
# ---------------------------------------------------------------------------

# 匹配 ## System Prompt 标题行（允许前后空白）
_SYSTEM_PROMPT_HEADING_RE = re.compile(r"^##\s+System\s+Prompt\s*$", re.MULTILINE)


def extract_system_prompt(content: str) -> str:
    """从 SOUL.md 全文中提取 ``## System Prompt`` 段落以下的文本。

    提取规则：
    1. 找到 ``## System Prompt`` 标题行
    2. 跳过标题行及紧随其后的可选引用提示行（以 ``>`` 开头）
    3. 返回标题之后、下一个同级或更高级标题（``#`` / ``##``）之前的全部文本
    4. 若未找到标题，返回空字符串

    Args:
        content: SOUL.md 的完整文本。

    Returns:
        提取出的 System Prompt 文本（已 strip）。
    """
    match = _SYSTEM_PROMPT_HEADING_RE.search(content)
    if match is None:
        return ""

    # 从标题行之后开始
    after_heading = content[match.end() :]
    lines = after_heading.split("\n")

    result_lines: list[str] = []
    skip_blockquote = True  # 跳过标题后紧随的 blockquote 提示行

    for line in lines:
        stripped = line.strip()

        # 跳过标题紧随的 blockquote 行
        if skip_blockquote:
            if stripped == "":
                continue
            if stripped.startswith(">"):
                continue
            skip_blockquote = False

        # 遇到同级或更高级标题（# 或 ##）时停止，### 以下属于段内子标题
        if stripped.startswith("#") and not stripped.startswith("###"):
            break

        result_lines.append(line)

    return "\n".join(result_lines).strip()


# ---------------------------------------------------------------------------
# SoulCache — 缓存已加载的 System Prompt
# ---------------------------------------------------------------------------


class SoulCache:
    """线程安全的 SOUL System Prompt 缓存。

    避免重复读取文件 IO。提供 ``get()`` 获取缓存的 System Prompt，
    ``invalidate()`` 清除缓存（为后续热更新预留）。
    """

    def __init__(self) -> None:
        self._cache: dict[str, str] = {}
        self._lock = Lock()

    def get(self, path: str | Path) -> str:
        """获取指定 SOUL.md 的完整内容（带缓存）。

        Args:
            path: SOUL.md 文件路径。

        Returns:
            文件完整文本内容。

        Raises:
            FileNotFoundError: 文件不存在。
        """
        key = str(Path(path).resolve())
        with self._lock:
            if key in self._cache:
                return self._cache[key]
        # 在锁外读文件，避免长时间持锁
        content = load_soul(path)
        with self._lock:
            # 双重检查：可能其他线程已经写入
            if key not in self._cache:
                self._cache[key] = content
            return self._cache[key]

    def invalidate(self, path: str | Path | None = None) -> None:
        """清除缓存。

        Args:
            path: 指定文件路径则只清除该条目；None 则清除全部缓存。
        """
        with self._lock:
            if path is None:
                self._cache.clear()
            else:
                key = str(Path(path).resolve())
                self._cache.pop(key, None)


# 模块级别单例
soul_cache = SoulCache()
