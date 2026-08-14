from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MonitorEvent:
    platform: str
    target: str
    post_id: str
    url: str
    author: str = ""
    author_url: str = ""
    text: str = ""
    created_at: str = ""
    likes: int | str = ""
    comments: int | str = ""
    reposts: int | str = ""

    @property
    def dedupe_key(self) -> str:
        return f"{self.platform}:{self.post_id or self.url}"
