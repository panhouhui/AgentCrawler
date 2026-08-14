from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable


DEFAULT_CHANNEL_IDS = [
    "1a6ftqghrjnd3yhupmmxtth1sc",
    "jou4418abjf6iemtd1unmbprjh",
    "kqunebxqoifoic5m1ybtnsuxmy",
    "d74in5fw7pbm3dbj4dos7bhfba",
]


def load_dotenv(paths: Iterable[Path]) -> None:
    for path in paths:
        if not path.exists():
            continue
        with path.open("r", encoding="utf-8-sig") as file:
            for line in file:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value


def read_lines(path: Path) -> list[str]:
    if not path.exists():
        return []
    values: list[str] = []
    with path.open("r", encoding="utf-8-sig") as file:
        for line in file:
            value = line.strip()
            if not value or value.startswith("# "):
                continue
            values.append(value)
    return values


def parse_channel_ids(value: str | None) -> list[str]:
    if not value:
        return DEFAULT_CHANNEL_IDS
    return [item.strip() for item in value.split(",") if item.strip()]
