# -*- coding: utf-8 -*-
"""X 爬虫运行配置。

所有敏感配置统一从 Crawler_env/X_env 注入，不再在爬虫程序目录中保存
Cookie、账号或静态词表。
"""

from __future__ import annotations

import os


def _clean_env_value(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1]
    return (
        value.replace("\\n", "\n")
        .replace("\\r", "\r")
        .replace('\\"', '"')
        .replace("\\'", "'")
    )


def _env(*names: str, default: str = "") -> str:
    for name in names:
        value = os.getenv(name)
        if value is not None and value.strip():
            return _clean_env_value(value)
    return default


def _env_int(name: str, default: int, minimum: int = 0, maximum: int = 100) -> int:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return max(minimum, min(parsed, maximum))


def _env_range(name: str, default: tuple[float, float]) -> tuple[float, float]:
    raw = os.getenv(name)
    if not raw:
        return default
    parts = [item.strip() for item in raw.split(",", 1)]
    if len(parts) != 2:
        return default
    try:
        low = float(parts[0])
        high = float(parts[1])
    except ValueError:
        return default
    if low < 0 or high < low:
        return default
    return (low, high)


TWITTER_COOKIES = _env(
    "TWITTER_COOKIES",
    "X_COOKIE",
    "X_COOKIES",
    "XWATCH_TWITTER_COOKIES",
)

PROXY = _env(
    "X_PROXY",
    "TWITTER_PROXY",
    "PROXY",
    "XWATCH_PROXY",
    "AGENTHUB_CRAWLER_PROXY_URL",
    "HTTPS_PROXY",
    "HTTP_PROXY",
)

# discover 阶段从 X 自身的 Explore/Home/高互动搜索入口发现候选事件。
DISCOVERY_STRATEGY = _env("X_DISCOVERY_STRATEGY", default="trending,home")
MAX_DISCOVER_RESULTS = _env_int("X_DISCOVER_LIMIT", 5, 1, 30)
MAX_SEARCH_RESULTS = _env_int("X_SEARCH_LIMIT", 5, 1, 30)

# 兼容旧导出器字段名，但它现在代表“单次搜索最多返回推文数”。
MAX_RESULTS = MAX_SEARCH_RESULTS

SEARCH_DAYS = _env_int("X_SEARCH_DAYS", 1, 0, 30)
MAX_COMMENTS_PER_TWEET = _env_int("X_COMMENTS_PER_TWEET", 8, 0, 50)

TWITTER_SEARCH_DELAY = _env_range("X_SEARCH_DELAY", (2, 5))
COMMENT_PAGE_LOAD_DELAY = _env_range("X_COMMENT_PAGE_LOAD_DELAY", (2, 4))
COMMENT_SCROLL_DELAY = _env_range("X_COMMENT_SCROLL_DELAY", (1.5, 3))
COMMENT_PROFILE_DELAY = _env_range("X_COMMENT_PROFILE_DELAY", (1, 2))
COMMENT_STALE_ROUNDS = _env_int("X_COMMENT_STALE_ROUNDS", 3, 1, 10)

# AgentHub 调用时只执行一次，不在爬虫进程内常驻巡逻。
MONITOR_INTERVAL = (0, 0)
COMMENT_MONITOR_LAST_N = 0

OUTPUT_DIR = _env("X_OUTPUT_DIR", default="output")
OUTPUT_FILENAME = _env("X_OUTPUT_FILENAME", default="x_social_events")
