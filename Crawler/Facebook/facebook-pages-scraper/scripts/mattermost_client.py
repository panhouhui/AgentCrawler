from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Dict, Iterable, List

from facebook_page_scraper.request_handler import FacebookScraperError, RequestHandler

CRAWLER_ROOT = Path(__file__).resolve().parents[3]
if str(CRAWLER_ROOT) not in sys.path:
    sys.path.insert(0, str(CRAWLER_ROOT))

from kan_push_bridge import dispatch_kan_message


DEFAULT_MATTERMOST_URL = "http://127.0.0.1:48080/api/kan-push/dispatch"
DEFAULT_CHANNEL_IDS = [
    "dwcybjq3pbdr8k9t8m4e9zmhxw",
    "pj9uywg1c3fdjrjycyrf71euco",
    "em6pwbdfatycub6yzjhknkao1r",
]


def get_mattermost_config(require_token: bool = True) -> tuple[str, str, List[str]]:
    RequestHandler()

    base_url = os.getenv("OPENCROW_KAN_PUSH_URL", DEFAULT_MATTERMOST_URL).rstrip("/")
    token = (
        os.getenv("OPENCROW_KAN_PUSH_TOKEN")
        or os.getenv("OPENCROW_WEB_TOKEN")
        or ""
    ).strip()
    channels_raw = os.getenv("MATTERMOST_CHANNEL_IDS", "")
    channel_ids = [
        channel.strip()
        for channel in channels_raw.split(",")
        if channel.strip()
    ] or DEFAULT_CHANNEL_IDS

    if require_token and not base_url:
        raise FacebookScraperError(
            "请配置 OPENCROW_KAN_PUSH_URL，让 Facebook 爬虫通过 OpenCrow 统一推送。"
        )

    return base_url, token, channel_ids


def load_seen(path: Path) -> set[str]:
    if not path.exists():
        return set()

    try:
        return set(json.loads(path.read_text(encoding="utf-8")))
    except (json.JSONDecodeError, OSError):
        return set()


def save_seen(path: Path, seen: set[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(sorted(seen), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def format_post_message(post: Dict[str, str]) -> str:
    created_at = post.get("created_at") or "unknown time"
    age_days = post.get("age_days") or "?"
    source_name = post.get("source_name") or "Unknown source"
    source_url = post.get("source_url") or ""
    post_url = post.get("post_url") or ""
    event_query = post.get("matched_event_query") or post.get("matched_keyword") or ""
    text = (post.get("text") or "").strip()

    if len(text) > 1200:
        text = text[:1200].rstrip() + "..."

    source_line = f"**来源**: [{source_name}]({source_url})" if source_url else f"**来源**: {source_name}"

    return "\n".join(
        [
            f"### Facebook 事件复核命中: {event_query}",
            source_line,
            f"**发布时间**: {created_at} 北京时间, 约 {age_days} 天前",
            f"**链接**: {post_url}",
            "",
            text,
        ]
    )


def create_mattermost_post(
    base_url: str,
    token: str,
    channel_id: str,
    message: str,
) -> None:
    dispatch_kan_message(
        platform="facebook",
        route_id="facebook-kan",
        message=message,
        channel_ids=[channel_id],
        source="facebook-pages-scraper",
        metadata={
            "legacy_base_url": base_url,
            "opencrow_token_configured": bool(token),
        },
        auth_token=token,
        timeout=30,
    )
    response.raise_for_status()


def push_posts_to_mattermost(
    posts: Iterable[Dict[str, str]],
    seen_file: Path,
    dry_run: bool = False,
) -> int:
    base_url, token, channel_ids = get_mattermost_config(require_token=not dry_run)
    seen = load_seen(seen_file)
    pushed_count = 0

    for post in posts:
        dedupe_key = post.get("post_id") or post.get("post_url") or post.get("text")
        if not dedupe_key or dedupe_key in seen:
            continue

        message = format_post_message(post)

        if dry_run:
            print(f"[DRY-RUN] Would push {dedupe_key} to {len(channel_ids)} channels")
        else:
            for channel_id in channel_ids:
                create_mattermost_post(base_url, token, channel_id, message)
            print(f"[PUSHED] {dedupe_key} to {len(channel_ids)} channels")

        seen.add(dedupe_key)
        pushed_count += 1

    save_seen(seen_file, seen)
    return pushed_count
