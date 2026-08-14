from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Iterable

import yaml

from .events import MonitorEvent


class ThreadsSource:
    def __init__(self, project_root: Path, online: bool = True, request_limit: int = 20):
        src_root = project_root / "src"
        if str(src_root) not in sys.path:
            sys.path.insert(0, str(src_root))

        from scraper.parser import ThreadsParser
        from scraper.threads_scraper import ThreadsScraper

        self.project_root = project_root
        self.config_dir = project_root / "config"
        self.data_dir = project_root / "data"
        self.settings = self._load_settings(self.config_dir / "settings.yaml")
        self.settings["use_offline"] = not online
        self.settings["limit"] = request_limit
        self.scraper = ThreadsScraper(
            settings=self.settings,
            config_dir=self.config_dir,
            data_dir=self.data_dir,
        )
        self.parser = ThreadsParser()

    def fetch_user(self, username: str, limit: int, event_filters: list[str]) -> Iterable[MonitorEvent]:
        username = username.strip().lstrip("@")
        if not username:
            return []
        raw_items = self.scraper.fetch_user_threads(username=username, limit=limit)
        events = []
        for raw in raw_items:
            item = self.parser.parse_item(raw, default_username=username)
            if not item:
                continue
            text = str(item.get("text") or "")
            matched = self._matched_event_filters(text, event_filters)
            if event_filters and not matched:
                continue
            events.append(self._event_from_item(item, matched or [username]))
        return events

    def _event_from_item(self, item: dict[str, Any], matched_event_filters: list[str]) -> MonitorEvent:
        username = str(item.get("username") or "")
        post_id = str(item.get("id") or item.get("url") or "")
        return MonitorEvent(
            platform="Threads",
            target=",".join(matched_event_filters),
            post_id=post_id,
            url=str(item.get("url") or f"https://www.threads.net/@{username}"),
            author=username,
            author_url=f"https://www.threads.net/@{username}" if username else "",
            text=str(item.get("text") or ""),
            created_at=str(item.get("created_at") or ""),
            likes=item.get("like_count", ""),
            comments=item.get("reply_count", ""),
            reposts=item.get("repost_count", ""),
        )

    def _matched_event_filters(self, text: str, event_filters: list[str]) -> list[str]:
        lowered = text.lower()
        return [event_filter for event_filter in event_filters if event_filter.lower() in lowered]

    def _load_settings(self, path: Path) -> dict[str, Any]:
        if not path.exists():
            return {}
        with path.open("r", encoding="utf-8") as file:
            return yaml.safe_load(file) or {}
