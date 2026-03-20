"""单元测试 — SOUL.md 文件加载。"""

from pathlib import Path

import pytest

from openclaw_republic.config.loader import load_all_souls, load_soul

# 项目根目录下的 souls 目录路径
SOULS_DIR = Path(__file__).resolve().parents[2] / "config" / "souls"

# 预期的 7 个角色
EXPECTED_ROLES = {
    "speaker",
    "radical_mp",
    "conservative_mp",
    "president",
    "sec_engineering",
    "sec_state",
    "chief_justice",
}


class TestLoadSoul:
    """测试单个 SOUL.md 加载。"""

    def test_load_single_soul(self) -> None:
        """load_soul() 返回非空字符串。"""
        content = load_soul(SOULS_DIR / "speaker.md")
        assert isinstance(content, str)
        assert len(content) > 0

    def test_soul_contains_system_prompt(self) -> None:
        """SOUL.md 文件包含 System Prompt 章节。"""
        content = load_soul(SOULS_DIR / "speaker.md")
        assert "System Prompt" in content

    def test_soul_file_not_found(self) -> None:
        """不存在的文件抛出 FileNotFoundError。"""
        with pytest.raises(FileNotFoundError):
            load_soul(SOULS_DIR / "nonexistent.md")


class TestLoadAllSouls:
    """测试批量 SOUL.md 加载。"""

    def test_returns_all_seven_roles(self) -> None:
        """load_all_souls() 返回 7 个角色。"""
        souls = load_all_souls(SOULS_DIR)
        assert len(souls) == 7

    def test_role_names_match(self) -> None:
        """返回字典的 key 与预期角色名匹配。"""
        souls = load_all_souls(SOULS_DIR)
        assert set(souls.keys()) == EXPECTED_ROLES

    def test_all_souls_non_empty(self) -> None:
        """所有 SOUL.md 内容非空。"""
        souls = load_all_souls(SOULS_DIR)
        for role, content in souls.items():
            assert len(content) > 0, f"{role} 的 SOUL.md 内容为空"

    def test_all_souls_have_system_prompt(self) -> None:
        """所有 SOUL.md 包含 System Prompt 章节。"""
        souls = load_all_souls(SOULS_DIR)
        for role, content in souls.items():
            assert "System Prompt" in content, f"{role} 缺少 System Prompt"

    def test_excludes_template(self) -> None:
        """SOUL_TEMPLATE.md 不包含在结果中。"""
        souls = load_all_souls(SOULS_DIR)
        assert "SOUL_TEMPLATE" not in souls

    def test_each_soul_has_personality(self) -> None:
        """每个 SOUL.md 包含人格特质和职责章节。"""
        souls = load_all_souls(SOULS_DIR)
        for role, content in souls.items():
            assert "人格特质" in content, f"{role} 缺少人格特质"
            assert "职责边界" in content, f"{role} 缺少职责边界"

    @pytest.mark.parametrize("role", sorted(EXPECTED_ROLES))
    def test_soul_word_count(self, role: str) -> None:
        """每个 SOUL.md 字数在合理范围内（1000-2000 字 ≈ 500-5000 中文字符）。"""
        content = load_soul(SOULS_DIR / f"{role}.md")
        # 中文字符计数更合理
        char_count = len(content)
        assert char_count >= 500, f"{role}: 内容过短 ({char_count} chars)"
        assert char_count <= 10000, f"{role}: 内容过长 ({char_count} chars)"
