"""Smoke test — 确认包结构可导入。"""


def test_package_importable():
    """openclaw_republic 包可以被正常导入。"""
    import openclaw_republic

    assert openclaw_republic is not None


def test_version_exists():
    """包版本号已定义。"""
    import openclaw_republic

    assert hasattr(openclaw_republic, "__version__")
    assert openclaw_republic.__version__ == "0.1.0"


def test_government_class_exists():
    """CyberGovernment 类存在且可实例化。"""
    from openclaw_republic.government import CyberGovernment

    gov = CyberGovernment()
    assert gov is not None
