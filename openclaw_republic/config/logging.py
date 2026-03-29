"""统一日志配置 — 基于 structlog。"""

import logging

import structlog


def setup_logging(log_level: str = "INFO") -> None:
    """初始化 structlog 统一日志。

    配置 structlog 处理器链，提供结构化日志输出。
    开发环境使用 ConsoleRenderer 彩色输出，
    生产环境可切换为 JSONRenderer。

    Args:
        log_level: 日志级别（DEBUG / INFO / WARNING / ERROR / CRITICAL）。
    """
    # 将字符串级别转换为 logging 模块的整数级别
    numeric_level = getattr(logging, log_level.upper(), logging.INFO)

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.StackInfoRenderer(),
            structlog.dev.ConsoleRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(numeric_level),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
