"""配置加载器 — 加载 constitution.yaml 和 SOUL.md 文件。"""

from pathlib import Path

import yaml

from .models import ConstitutionConfig


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
    souls: dict[str, str] = {}
    for md_file in sorted(directory.glob("*.md")):
        if md_file.name == "SOUL_TEMPLATE.md":
            continue
        role_name = md_file.stem
        souls[role_name] = md_file.read_text(encoding="utf-8")
    return souls
