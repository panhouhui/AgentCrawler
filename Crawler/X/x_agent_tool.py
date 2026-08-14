# -*- coding: utf-8 -*-
"""AgentHub 可调用的 X 爬虫工具入口。"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import os
import sys
from pathlib import Path
from typing import Any


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent
MODULE_DIR = ROOT / "X网站评论爬取"
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))


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


def load_env_file(path: str | None) -> None:
    if not path:
        return
    env_path = Path(path)
    if not env_path.exists():
        return
    current_key = ""
    current_value = ""

    def flush() -> None:
        nonlocal current_key, current_value
        if current_key and current_key not in os.environ:
            os.environ[current_key] = _clean_env_value(current_value)
        current_key = ""
        current_value = ""

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" in line:
            flush()
            key, value = line.split("=", 1)
            current_key = key.strip()
            current_value = value.strip()
        elif current_key:
            current_value += line
    flush()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="X 平台自主发现/事件复核工具")
    parser.add_argument("--phase", choices=["discover", "search"], default="discover")
    parser.add_argument("--event-query", "--event-title", dest="event_query", default="")
    parser.add_argument("--limit", type=int, default=3)
    parser.add_argument("--comments-per-tweet", type=int, default=None)
    parser.add_argument("--no-comments", action="store_true")
    parser.add_argument("--output", default="")
    parser.add_argument("--env-file", default="")
    parser.add_argument("--proxy", default="")
    parser.add_argument("--headful", action="store_true")
    return parser


def bootstrap_env(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--env-file", default="")
    parser.add_argument("--proxy", default="")
    known, _ = parser.parse_known_args(argv)
    load_env_file(known.env_file)
    if known.proxy:
        os.environ["X_PROXY"] = known.proxy


def aggregate_metrics(records: list[dict[str, Any]]) -> dict[str, int]:
    totals = {
        "tweet_count": len(records),
        "comment_count": 0,
        "reply_count": 0,
        "repost_count": 0,
        "like_count": 0,
        "view_count": 0,
    }
    for record in records:
        totals["comment_count"] += len(record.get("comments") or [])
        metrics = record.get("metrics") if isinstance(record.get("metrics"), dict) else {}
        totals["reply_count"] += int(metrics.get("reply_count") or record.get("reply_count") or 0)
        totals["repost_count"] += int(metrics.get("repost_count") or record.get("repost_count") or 0)
        totals["like_count"] += int(metrics.get("like_count") or record.get("like_count") or 0)
        totals["view_count"] += int(metrics.get("view_count") or record.get("view_count") or 0)
    return totals


def compact_record(record: dict[str, Any]) -> dict[str, Any]:
    next_record = {key: value for key, value in record.items() if not key.startswith("_")}
    comments = next_record.get("comments")
    if isinstance(comments, list):
        next_record["comments"] = [
            {key: value for key, value in comment.items() if not key.startswith("_")}
            for comment in comments
            if isinstance(comment, dict)
        ]
    return next_record


def is_render_failure(exc: Exception) -> bool:
    message = str(exc)
    return any(
        text in message
        for text in [
            "X 页面为空白",
            "Cloudflare 前端脚本未完成加载",
            "script-load-failure",
            "ERR_CONNECTION_CLOSED",
        ]
    )


def run_api_fallback(
    args: argparse.Namespace,
    limit: int,
    comments_per_tweet: int | None,
) -> list[dict[str, Any]]:
    from x_api_fallback import XApiFallbackCrawler

    crawler = XApiFallbackCrawler()
    if args.phase == "search":
        event_query = str(args.event_query or "").strip()
        if not event_query:
            raise ValueError("search 阶段必须提供 event_query")
        records = crawler.search_event_evidence(event_query, limit=limit)
    else:
        records = crawler.discover_hot_tweets(limit=limit)
    return crawler.attach_comments(records, comments_per_tweet)


def build_success_payload(args: argparse.Namespace, records: list[dict[str, Any]]) -> tuple[int, dict[str, Any]]:
    compact_records = [compact_record(record) for record in records]
    payload = {
        "ok": True,
        "platform": "x",
        "phase": args.phase,
        "records": compact_records,
        "metrics": aggregate_metrics(compact_records),
        "fallback": bool(records and records[0].get("collector") == "x_graphql_fallback"),
    }
    return 0, payload


async def run(args: argparse.Namespace) -> tuple[int, dict[str, Any]]:
    from twitter_search import TwitterSearcher

    limit = max(1, min(int(args.limit or 3), 30))
    comments_per_tweet = 0 if args.no_comments else args.comments_per_tweet
    searcher = TwitterSearcher(headless=not args.headful)
    try:
        with contextlib.redirect_stdout(sys.stderr):
            if args.phase == "search":
                event_query = str(args.event_query or "").strip()
                if not event_query:
                    return (
                        2,
                        {
                            "ok": False,
                            "platform": "x",
                            "phase": args.phase,
                            "records": [],
                            "error": "search 阶段必须提供 event_query",
                        },
                    )
                records = await searcher.search_event_evidence(event_query, limit=limit)
            else:
                records = await searcher.discover_hot_tweets(limit=limit)

            records = await searcher.attach_comments(records, comments_per_tweet)
            if records and comments_per_tweet and comments_per_tweet > 0:
                needs_comment_fallback = any(
                    int(record.get("comment_count") or 0) == 0
                    and int((record.get("metrics") or {}).get("reply_count") or record.get("reply_count") or 0) > 0
                    for record in records
                    if isinstance(record, dict)
                )
                if needs_comment_fallback:
                    print("[X] 页面评论抓取为空，改用 GraphQL TweetDetail 补评论")
                    records = run_api_fallback(args, limit, comments_per_tweet)
            if records:
                return build_success_payload(args, records)
            print("[X] 页面爬取没有返回推文，改用 GraphQL API 兜底")
            records = run_api_fallback(args, limit, comments_per_tweet)
            return build_success_payload(args, records)
    except Exception as exc:
        if not is_render_failure(exc):
            message = str(exc)
            error_type = exc.__class__.__name__
            return (
                2 if "Cookie" in message or "缺少" in message else 1,
                {
                    "ok": False,
                    "platform": "x",
                    "phase": args.phase,
                    "records": [],
                    "error": message,
                    "error_type": error_type,
                },
            )
        with contextlib.redirect_stdout(sys.stderr):
            print(f"[X] 页面渲染失败，改用 GraphQL API 兜底: {exc}")
        try:
            records = run_api_fallback(args, limit, comments_per_tweet)
        except Exception as fallback_exc:
            return (
                1,
                {
                    "ok": False,
                    "platform": "x",
                    "phase": args.phase,
                    "records": [],
                    "error": f"页面爬取失败，API 兜底也失败：{fallback_exc}",
                    "error_type": fallback_exc.__class__.__name__,
                    "primary_error": str(exc),
                },
            )
        return build_success_payload(args, records)
    finally:
        with contextlib.suppress(Exception):
            await searcher.close()


def write_payload(path: str, payload: dict[str, Any]) -> None:
    if not path:
        return
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    args_list = list(sys.argv[1:] if argv is None else argv)
    bootstrap_env(args_list)
    parser = build_parser()
    args = parser.parse_args(args_list)
    exit_code, payload = asyncio.run(run(args))
    write_payload(args.output, payload)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
