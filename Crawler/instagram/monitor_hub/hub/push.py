from __future__ import annotations

import sys
import time
from pathlib import Path

CRAWLER_ROOT = Path(__file__).resolve().parents[3]
if str(CRAWLER_ROOT) not in sys.path:
    sys.path.insert(0, str(CRAWLER_ROOT))

from kan_push_bridge import KanPushError, dispatch_kan_message

from .events import MonitorEvent


def format_message(event: MonitorEvent) -> str:
    text = " ".join((event.text or "").split())
    if len(text) > 500:
        text = text[:497] + "..."

    parts = [
        f"发现 {event.platform} 新内容：{event.target}",
        f"链接：{event.url}",
    ]
    if event.author:
        parts.append(f"发布者：@{event.author}")
    if event.author_url:
        parts.append(f"发布者主页：{event.author_url}")
    if event.created_at:
        parts.append(f"发布时间：{event.created_at}")

    metrics = []
    if event.likes != "":
        metrics.append(f"点赞 {event.likes}")
    if event.comments != "":
        metrics.append(f"评论/回复 {event.comments}")
    if event.reposts != "":
        metrics.append(f"转发 {event.reposts}")
    if metrics:
        parts.append("互动：" + "，".join(metrics))
    if text:
        parts.append(f"正文：{text}")
    return "\n".join(parts)


class MattermostPusher:
    def __init__(
        self,
        base_url: str,
        token: str,
        channel_ids: list[str],
        timeout: float = 10.0,
        retries: int = 2,
    ):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.channel_ids = channel_ids
        self.timeout = timeout
        self.retries = max(1, retries)

    def push(self, event: MonitorEvent) -> None:
        message = format_message(event)
        for channel_id in self.channel_ids:
            self._post_channel(channel_id, message, event)

    def _post_channel(self, channel_id: str, message: str, event: MonitorEvent) -> None:
        last_error = None
        for attempt in range(1, self.retries + 1):
            try:
                dispatch_kan_message(
                    platform="instagram",
                    message=message,
                    channel_ids=[channel_id],
                    source=event.platform,
                    dedupe_key=event.dedupe_key,
                    metadata={
                        "target": event.target,
                        "url": event.url,
                        "author": event.author,
                    },
                    auth_token=self.token,
                    timeout=self.timeout,
                )
                return
            except KanPushError as exc:
                last_error = str(exc)
            if attempt < self.retries:
                time.sleep(attempt)
        print(
            f"OpenCrow Kan push failed for channel {channel_id}: {last_error}",
            file=sys.stderr,
            flush=True,
        )
