from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse
from urllib.request import ProxyHandler, Request, build_opener, urlopen
from xml.etree import ElementTree as ET

if os.getcwd() not in sys.path:
    sys.path.insert(0, os.getcwd())

from avtdl.plugins.youtube.feed_info import (
    ContentTypeNotSupportedException,
    get_video_renderers,
    parse_lockup_view,
    parse_owner_info,
    parse_video_renderer,
)

MOJIBAKE_MARKERS = (
    "\u9358",
    "\u935c",
    "\u6d93",
    "\u68e3",
    "\u9428",
    "\u93c4",
    "\u934a",
    "\u7c21",
    "\u8bb3",
    "\u704f",
    "\u52eb",
    "\u51bf",
    "\u59d8",
    "\u68be",
    "\u20ac",
)

DEFAULT_DISCOVER_SOURCES = [
    ("subscriptions", "https://www.youtube.com/feed/subscriptions"),
    ("trending", "https://www.youtube.com/feed/trending"),
]

SOURCE_ENV_KEYS = (
    "YOUTUBE_DISCOVER_SOURCES",
    "YOUTUBE_MONITOR_SOURCES",
    "YOUTUBE_SOURCE_URLS",
    "YouTube_sources",
)

YOUTUBE_FEED_NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "yt": "http://www.youtube.com/xml/schemas/2015",
    "media": "http://search.yahoo.com/mrss/",
}


def load_env_file(path: Path | None) -> None:
    if path is None or not path.exists():
        return
    text = path.read_text(encoding="utf-8-sig", errors="ignore")
    current_key = ""
    current_value: list[str] = []

    def flush() -> None:
        nonlocal current_key, current_value
        if current_key:
            value = "".join(current_value).strip().strip('"').strip("'")
            os.environ.setdefault(current_key, value)
        current_key = ""
        current_value = []

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            flush()
            key, value = line.split("=", 1)
            current_key = key.strip()
            current_value = [value.strip()]
        elif current_key:
            current_value.append(line)
    flush()


def youtube_headers() -> dict[str, str]:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    cookie = (os.environ.get("YouTube_cookie") or os.environ.get("YOUTUBE_COOKIE") or "").strip()
    if cookie:
        headers["Cookie"] = cookie
    return headers


def fetch_url(url: str, *, use_env_proxy: bool = True, timeout: int = 25) -> str:
    req = Request(url, headers=youtube_headers())
    opener = None if use_env_proxy else build_opener(ProxyHandler({}))
    open_url = urlopen if opener is None else opener.open
    with open_url(req, timeout=timeout) as response:
        raw = response.read()
        charset = response.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="replace")


def fetch_url_with_fallback(url: str, *, timeout: int = 25) -> str:
    last_error: Exception | None = None
    for use_env_proxy in (True, False):
        try:
            return fetch_url(url, use_env_proxy=use_env_proxy, timeout=timeout)
        except Exception as exc:
            last_error = exc
    raise RuntimeError(str(last_error) if last_error else "未知网络错误")


def query_url(query: str) -> str:
    return "https://www.youtube.com/results?" + urlencode({"search_query": query})


def mojibake_score(text: str) -> int:
    return sum(text.count(marker) for marker in MOJIBAKE_MARKERS)


def repair_text(text: str) -> str:
    if not text or mojibake_score(text) == 0:
        return text
    for encoding in ("gb18030", "gbk"):
        try:
            repaired = text.encode(encoding).decode("utf-8")
        except UnicodeError:
            continue
        if mojibake_score(repaired) < mojibake_score(text):
            return repaired
    return text


def repair_value(value: Any) -> Any:
    if isinstance(value, str):
        return repair_text(value)
    if isinstance(value, list):
        return [repair_value(item) for item in value]
    if isinstance(value, dict):
        return {key: repair_value(item) for key, item in value.items()}
    return value


def published_age_seconds(text: str) -> int | None:
    value = text.strip().casefold()
    if not value:
        return None
    if any(marker in value for marker in ("just now", "now", "刚刚", "剛剛")):
        return 0

    match = re.search(
        r"(\d+(?:\.\d+)?)\s*"
        r"(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|"
        r"秒|分鐘|分钟|分|小時|小时|時|时|天|日|週|周|星期|月|年)",
        value,
    )
    if not match:
        return None

    number = float(match.group(1))
    unit = match.group(2)
    if unit.startswith(("second", "sec")) or unit == "秒":
        return int(number)
    if unit.startswith(("minute", "min")) or unit in {"分鐘", "分钟", "分"}:
        return int(number * 60)
    if unit.startswith(("hour", "hr")) or unit in {"小時", "小时", "時", "时"}:
        return int(number * 3600)
    if unit.startswith("day") or unit in {"天", "日"}:
        return int(number * 86400)
    if unit.startswith("week") or unit in {"週", "周", "星期"}:
        return int(number * 7 * 86400)
    if unit.startswith("month") or unit == "月":
        return int(number * 30 * 86400)
    if unit.startswith("year") or unit == "年":
        return int(number * 365 * 86400)
    return None


def parse_iso_timestamp(value: str) -> int | None:
    text = value.strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp())


def relative_published_text(published_at: int, now: int) -> str:
    age_seconds = max(0, now - published_at)
    if age_seconds < 60:
        return "刚刚"
    if age_seconds < 3600:
        return f"{age_seconds // 60}分钟前"
    if age_seconds < 86400:
        return f"{age_seconds // 3600}小时前"
    if age_seconds < 30 * 86400:
        return f"{age_seconds // 86400}天前"
    return datetime.fromtimestamp(published_at, tz=timezone.utc).strftime("%Y-%m-%d")


def source_name_from_url(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path.strip("/")
    if path == "feed/subscriptions":
        return "subscriptions"
    if path in {"feed/trending", "feed/explore"}:
        return path.split("/")[-1]
    if not path:
        return "home"
    return path.split("/")[0] or parsed.netloc or "youtube"


def parse_source_value(value: str, index: int) -> tuple[str, str] | None:
    text = value.strip()
    if not text:
        return None
    name = ""
    url = text
    for delimiter in ("|", "="):
        if delimiter in text and text.index(delimiter) < 80:
            left, right = text.split(delimiter, 1)
            if right.strip().startswith("http"):
                name = left.strip()
                url = right.strip()
                break
    if not url.startswith("http"):
        return None
    return (name or source_name_from_url(url) or f"source-{index + 1}", url)


def split_source_text(text: str) -> list[str]:
    stripped = text.strip()
    if not stripped:
        return []
    if stripped.startswith("["):
        try:
            parsed = json.loads(stripped)
            if isinstance(parsed, list):
                return [str(item) for item in parsed]
        except Exception:
            pass
    return [item for item in re.split(r"[\n;,]+", stripped) if item.strip()]


def sources_from_file(path: str) -> list[tuple[str, str]]:
    file_path = Path(path)
    if not file_path.exists():
        return []
    sources: list[tuple[str, str]] = []
    for index, line in enumerate(file_path.read_text(encoding="utf-8-sig", errors="ignore").splitlines()):
        value = line.strip()
        if not value or value.startswith("#"):
            continue
        source = parse_source_value(value, index)
        if source:
            sources.append(source)
    return sources


def discover_sources(args: argparse.Namespace) -> list[tuple[str, str]]:
    sources: list[tuple[str, str]] = []
    source_files = [
        args.sources_file,
        os.environ.get("YOUTUBE_DISCOVER_SOURCES_FILE", ""),
        os.environ.get("YOUTUBE_SOURCES_FILE", ""),
        str(Path.cwd() / "youtube_sources.txt"),
    ]
    for source_file in source_files:
        if source_file:
            sources.extend(sources_from_file(source_file))

    raw_values: list[str] = []
    for key in SOURCE_ENV_KEYS:
        raw = os.environ.get(key, "")
        if raw:
            raw_values.extend(split_source_text(raw))
    raw_values.extend(args.source_url or [])

    for index, raw in enumerate(raw_values):
        source = parse_source_value(raw, index)
        if source:
            sources.append(source)

    if not sources:
        sources = list(DEFAULT_DISCOVER_SOURCES)

    deduped: list[tuple[str, str]] = []
    seen: set[str] = set()
    for name, url in sources:
        key = url.rstrip("/")
        if key in seen:
            continue
        seen.add(key)
        deduped.append((name, url))
    max_sources = max(1, min(int(os.environ.get("YOUTUBE_DISCOVER_MAX_SOURCES", "2") or 2), 8))
    return deduped[:max_sources]


def record_to_dict(record: Any, *, source_name: str, source_url: str) -> dict[str, Any]:
    data = record.model_dump(mode="json")
    now = int(time.time())
    published_text = repair_text(data.get("published_text") or "")
    age_seconds = published_age_seconds(published_text)
    channel_link = repair_text(data.get("channel_link") or "")
    author = repair_text(data.get("author") or "")
    item = repair_value(
        {
            "type": "youtube_video",
            "platform": "youtube",
            "video_id": data.get("video_id", ""),
            "url": data.get("url", ""),
            "title": data.get("title", ""),
            "summary": data.get("summary") or "",
            "published_text": published_text,
            "published_at": now - age_seconds if age_seconds is not None else "",
            "captured_at": now,
            "author": author,
            "channel_name": author,
            "channel_link": channel_link,
            "channel_url": channel_link,
            "channel_id": data.get("channel_id") or "",
            "length": data.get("length") or "",
            "is_live": bool(data.get("is_live")),
            "is_upcoming": bool(data.get("is_upcoming")),
            "is_member_only": bool(data.get("is_member_only")),
            "source_name": source_name,
            "source_url": source_url,
            "discovery_source": source_name,
            "metrics": {
                "age_seconds": age_seconds if age_seconds is not None else 0,
            },
        }
    )
    return item


def parse_records(
    page_text: str,
    limit: int,
    *,
    source_name: str,
    source_url: str,
    max_age_hours: float,
) -> list[dict[str, Any]]:
    video_renderers, lockup_views, _continuation_token, page = get_video_renderers(page_text)
    owner_info = parse_owner_info(page)
    records: list[dict[str, Any]] = []
    seen: set[str] = set()

    for item, parser in [
        *[(item, parse_video_renderer) for item in video_renderers],
        *[(item, parse_lockup_view) for item in lockup_views],
    ]:
        if len(records) >= limit:
            break
        try:
            record = parser(item, owner_info)
        except ContentTypeNotSupportedException:
            continue
        except Exception:
            continue
        data = record_to_dict(record, source_name=source_name, source_url=source_url)
        uid = data.get("video_id") or data.get("url")
        if not uid or uid in seen:
            continue
        seen.add(str(uid))

        age_seconds = published_age_seconds(str(data.get("published_text") or ""))
        if age_seconds is not None and age_seconds > max_age_hours * 3600:
            continue
        records.append(data)

    return records


def xml_text(element: ET.Element | None, path: str) -> str:
    if element is None:
        return ""
    found = element.find(path, YOUTUBE_FEED_NS)
    return repair_text((found.text or "").strip()) if found is not None else ""


def xml_attr(element: ET.Element | None, path: str, attr: str) -> str:
    if element is None:
        return ""
    found = element.find(path, YOUTUBE_FEED_NS)
    return repair_text((found.attrib.get(attr) or "").strip()) if found is not None else ""


def parse_feed_records(
    feed_text: str,
    limit: int,
    *,
    source_name: str,
    source_url: str,
    max_age_hours: float,
) -> list[dict[str, Any]]:
    root = ET.fromstring(feed_text)
    now = int(time.time())
    records: list[dict[str, Any]] = []
    seen: set[str] = set()

    for entry in root.findall("atom:entry", YOUTUBE_FEED_NS):
        if len(records) >= limit:
            break
        video_id = xml_text(entry, "yt:videoId")
        url = xml_attr(entry, "atom:link", "href") or (
            f"https://www.youtube.com/watch?v={video_id}" if video_id else ""
        )
        key = video_id or url
        if not key or key in seen:
            continue
        seen.add(key)

        published_at = parse_iso_timestamp(xml_text(entry, "atom:published"))
        updated_at = parse_iso_timestamp(xml_text(entry, "atom:updated"))
        event_time = published_at or updated_at or now
        age_seconds = max(0, now - event_time)
        if age_seconds > max_age_hours * 3600:
            continue

        media_group = entry.find("media:group", YOUTUBE_FEED_NS)
        community = media_group.find("media:community", YOUTUBE_FEED_NS) if media_group is not None else None
        views = xml_attr(community, "media:statistics", "views")
        rating_count = xml_attr(community, "media:starRating", "count")

        item = repair_value(
            {
                "type": "youtube_video",
                "platform": "youtube",
                "video_id": video_id,
                "url": url,
                "title": xml_text(entry, "atom:title"),
                "summary": xml_text(media_group, "media:description"),
                "published_text": relative_published_text(event_time, now),
                "published_at": event_time,
                "captured_at": now,
                "author": xml_text(entry, "atom:author/atom:name"),
                "channel_name": xml_text(entry, "atom:author/atom:name"),
                "channel_link": xml_text(entry, "atom:author/atom:uri"),
                "channel_url": xml_text(entry, "atom:author/atom:uri"),
                "channel_id": xml_text(entry, "yt:channelId"),
                "length": "",
                "is_live": False,
                "is_upcoming": False,
                "is_member_only": False,
                "source_name": source_name,
                "source_url": source_url,
                "discovery_source": source_name,
                "metrics": {
                    "age_seconds": age_seconds,
                    "view_count": int(views) if views.isdigit() else 0,
                    "rating_count": int(rating_count) if rating_count.isdigit() else 0,
                },
            }
        )
        records.append(item)

    return records


def is_youtube_feed(source_url: str, page_text: str) -> bool:
    parsed = urlparse(source_url)
    if parsed.path.endswith("/feeds/videos.xml"):
        return True
    prefix = page_text.lstrip()[:500].casefold()
    return "<feed" in prefix and "youtube.com" in page_text[:5000].casefold()


def parse_discover_page(
    page_text: str,
    limit: int,
    *,
    source_name: str,
    source_url: str,
    max_age_hours: float,
) -> list[dict[str, Any]]:
    if is_youtube_feed(source_url, page_text):
        return parse_feed_records(
            page_text,
            limit,
            source_name=source_name,
            source_url=source_url,
            max_age_hours=max_age_hours,
        )
    return parse_records(
        page_text,
        limit,
        source_name=source_name,
        source_url=source_url,
        max_age_hours=max_age_hours,
    )


def discover_records(args: argparse.Namespace, limit: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    records: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    seen: set[str] = set()
    sources = discover_sources(args)
    per_source_limit = max(limit, min(limit * 2, 12))

    for source_name, source_url in sources:
        try:
            page_text = fetch_url_with_fallback(source_url, timeout=args.request_timeout)
            source_records = parse_discover_page(
                page_text,
                per_source_limit,
                source_name=source_name,
                source_url=source_url,
                max_age_hours=args.max_age_hours,
            )
        except Exception as exc:
            errors.append({"source_name": source_name, "source_url": source_url, "error": str(exc)})
            continue

        for record in source_records:
            key = str(record.get("video_id") or record.get("url") or "")
            if not key or key in seen:
                continue
            seen.add(key)
            records.append(record)
            if len(records) >= limit:
                return records, errors

    return records[:limit], errors


def query_records(args: argparse.Namespace, limit: int) -> list[dict[str, Any]]:
    page_text = fetch_url_with_fallback(query_url(args.query), timeout=args.request_timeout)
    return parse_records(
        page_text,
        limit,
        source_name="search",
        source_url=query_url(args.query),
        max_age_hours=args.max_age_hours,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="AgentHub YouTube avtdl one-shot probe")
    parser.add_argument("--query", default="")
    parser.add_argument("--discover", action="store_true")
    parser.add_argument("--source-url", action="append", default=[])
    parser.add_argument("--sources-file", default="")
    parser.add_argument("--limit", type=int, default=3)
    parser.add_argument("--max-age-hours", type=float, default=24 * 30)
    parser.add_argument("--request-timeout", type=int, default=20)
    parser.add_argument("--env-file", default="")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    limit = max(1, min(args.limit, 20))
    args.request_timeout = max(5, min(int(args.request_timeout or 20), 60))
    args.max_age_hours = max(1, min(float(args.max_age_hours or 24 * 30), 24 * 60))
    load_env_file(Path(args.env_file) if args.env_file else None)

    mode = "discover" if args.discover or not args.query.strip() else "search"
    try:
        if mode == "discover":
            records, errors = discover_records(args, limit)
        else:
            records = query_records(args, limit)
            errors = []
    except Exception as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "mode": mode,
                    "query": args.query,
                    "error": f"YouTube 真实查询失败: {exc}",
                },
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return 1

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "ok": True,
                "mode": mode,
                "query": args.query if mode == "search" else "",
                "sources": [
                    {"name": name, "url": url}
                    for name, url in (discover_sources(args) if mode == "discover" else [])
                ],
                "count": len(records),
                "errors": errors,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
