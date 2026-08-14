from __future__ import annotations

import sqlite3
from pathlib import Path

from .events import MonitorEvent


class SeenStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path)
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS seen_posts (
                key TEXT PRIMARY KEY,
                platform TEXT NOT NULL,
                target TEXT NOT NULL,
                post_id TEXT NOT NULL,
                url TEXT NOT NULL,
                first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        self.conn.commit()

    def is_new(self, event: MonitorEvent) -> bool:
        try:
            self.conn.execute(
                """
                INSERT INTO seen_posts (key, platform, target, post_id, url)
                VALUES (?, ?, ?, ?, ?)
                """,
                (event.dedupe_key, event.platform, event.target, event.post_id, event.url),
            )
            self.conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False

    def close(self) -> None:
        self.conn.close()
