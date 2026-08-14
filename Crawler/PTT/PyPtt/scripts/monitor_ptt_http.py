from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests

CRAWLER_ROOT = Path(__file__).resolve().parents[3]
if str(CRAWLER_ROOT) not in sys.path:
    sys.path.insert(0, str(CRAWLER_ROOT))

from kan_push_bridge import KanPushError, dispatch_kan_message

try:
    from crawl_ptt_http import (
        DEFAULT_BOARDS,
        build_session,
        collect_latest_hits,
        collect_search_hits,
        parse_article,
        parse_csv_arg,
    )
    from minimax_ai import (
        DEFAULT_MINIMAX_API_URL,
        DEFAULT_MINIMAX_MODEL,
        MiniMaxAPIError,
        PTTMiniMaxAnalyzer,
        load_env_file,
        minimax_api_key_for,
        minimax_trust_env_for,
    )
except ModuleNotFoundError:
    from scripts.crawl_ptt_http import (
        DEFAULT_BOARDS,
        build_session,
        collect_latest_hits,
        collect_search_hits,
        parse_article,
        parse_csv_arg,
    )
    from scripts.minimax_ai import (
        DEFAULT_MINIMAX_API_URL,
        DEFAULT_MINIMAX_MODEL,
        MiniMaxAPIError,
        PTTMiniMaxAnalyzer,
        load_env_file,
        minimax_api_key_for,
        minimax_trust_env_for,
    )


DEFAULT_STATE = Path("output/ptt_monitor_seen.json")
DEFAULT_EVENTS = Path("output/ptt_monitor_events.jsonl")
DEFAULT_AI_EVENTS = Path("output/ptt_ai_analysis.jsonl")
DEFAULT_ENV_FILE = Path(os.getenv("AGENTHUB_ROOT", Path(__file__).resolve().parents[4])) / "env" / "Crawler_env" / "PTT_env"
LOCAL_TZ = ZoneInfo("Asia/Shanghai")


def today_string() -> str:
    return datetime.now(LOCAL_TZ).strftime("%Y-%m-%d")


def monitor_date(args: argparse.Namespace) -> str:
    return args.date or today_string()


def day_window(date_text: str) -> tuple[int, int]:
    start = datetime.strptime(date_text, "%Y-%m-%d").replace(tzinfo=LOCAL_TZ)
    end = start + timedelta(days=1)
    return int(start.timestamp()), int(end.timestamp())


def load_seen(path: Path) -> set[str]:
    if not path.exists():
        return set()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return set()
    return set(data if isinstance(data, list) else data.get("seen", []))


def save_seen(path: Path, seen: set[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"seen": sorted(seen), "updated_at": datetime.now(LOCAL_TZ).isoformat()}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def append_events(path: Path, articles: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        for article in articles:
            f.write(json.dumps(article, ensure_ascii=False) + "\n")


def article_summary(article: dict[str, Any]) -> str:
    summary = (
        f"[{article.get('board')}] {article.get('title')}\n"
        f"{article.get('date')}\n"
        f"{article.get('url')}"
    )
    analysis = article.get("ai_analysis")
    if isinstance(analysis, dict):
        summary += (
            f"\nAI: {analysis.get('anti_china_tendency', '-')}"
            f" confidence={analysis.get('confidence', '-')}"
            f"\n理由：{analysis.get('reason', '-') or '-'}"
        )
    return summary


def format_mattermost_message(article: dict[str, Any]) -> str:
    analysis = article.get("ai_analysis")
    if not isinstance(analysis, dict):
        analysis = {}

    event_queries = article.get("matched_event_queries") or article.get("matched_keywords") or []
    if isinstance(event_queries, list):
        event_query_text = ",".join(str(event_query) for event_query in event_queries)
    else:
        event_query_text = str(event_queries)

    return "\n".join(
        [
            f"事件复核条件：{event_query_text or '-'}",
            f"判断：{analysis.get('anti_china_tendency', '-') or '-'}",
            f"置信度：{analysis.get('confidence', '-')}",
            f"理由：{analysis.get('reason', '-') or '-'}",
            f"看板：{article.get('board', '-') or '-'}",
            f"标题：{article.get('title', '-') or '-'}",
            f"链接：{article.get('url', '-') or '-'}",
        ]
    )


def post_mattermost(
    session: requests.Session,
    server_url: str,
    bot_token: str,
    channel_id: str,
    article: dict[str, Any],
    timeout: int,
) -> None:
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            dispatch_kan_message(
                platform="ptt",
                route_id="ptt-kan",
                message=format_mattermost_message(article),
                channel_ids=[channel_id],
                source="ptt-monitor",
                dedupe_key=str(article.get("url") or ""),
                metadata={
                    "article": article,
                    "legacy_server_url": server_url,
                    "opencrow_token_configured": bool(bot_token),
                    "session_reused": session is not None,
                },
                timeout=timeout,
            )
            return
        except KanPushError as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"OpenCrow Kan 推送失败：{last_error}")


def post_mattermost_channels(
    session: requests.Session,
    server_url: str | None,
    bot_token: str | None,
    channel_ids: str | None,
    article: dict[str, Any],
    timeout: int,
) -> int:
    if not channel_ids:
        return 0

    sent = 0
    for channel_id in [item.strip() for item in channel_ids.split(",") if item.strip()]:
        post_mattermost(session, server_url or "", bot_token or "", channel_id, article, timeout)
        sent += 1
    return sent


def webhook_payload(article: dict[str, Any], webhook_type: str) -> Any:
    text = article_summary(article)
    if webhook_type == "dingtalk":
        return {"msgtype": "text", "text": {"content": text}}
    if webhook_type == "feishu":
        return {"msg_type": "text", "content": {"text": text}}
    if webhook_type == "wechat":
        return {"msgtype": "text", "text": {"content": text}}
    if webhook_type == "serverchan":
        return {"title": article.get("title"), "desp": text}
    if webhook_type == "ntfy":
        return text
    return article


def push_article(
    session: requests.Session,
    article: dict[str, Any],
    webhook_url: str | None,
    webhook_type: str,
    timeout: int,
    mattermost_server_url: str | None = None,
    mattermost_bot_token: str | None = None,
    mattermost_channel_id: str | None = None,
) -> bool:
    print(article_summary(article))
    print("-" * 60)

    mattermost_sent = post_mattermost_channels(
        session,
        mattermost_server_url,
        mattermost_bot_token,
        mattermost_channel_id,
        article,
        timeout,
    )

    if not webhook_url:
        return mattermost_sent > 0

    payload = webhook_payload(article, webhook_type)
    headers = {}
    data = None
    json_payload = None

    if webhook_type == "ntfy":
        headers["Title"] = str(article.get("title") or "PTT monitor")
        data = str(payload).encode("utf-8")
    else:
        json_payload = payload

    response = session.post(webhook_url, json=json_payload, data=data, headers=headers, timeout=timeout)
    response.raise_for_status()
    return True


def scan_once(args: argparse.Namespace, seen: set[str]) -> list[dict[str, Any]]:
    session = build_session(args.insecure, args.no_proxy)
    boards = parse_csv_arg(args.boards, DEFAULT_BOARDS)
    event_filters = parse_csv_arg(args.event_filters, [])

    print(f"boards={','.join(boards)} event_filters={len(event_filters)}")
    date_text = monitor_date(args)
    start_ts, end_ts = day_window(date_text)

    if event_filters:
        hits = collect_search_hits(
            session=session,
            boards=boards,
            event_filters=event_filters,
            max_pages_per_query=args.max_pages_per_query,
            delay=args.delay,
            timeout=args.timeout,
        )
    else:
        hits = collect_latest_hits(
            session=session,
            boards=boards,
            max_pages=args.max_pages_per_query,
            delay=args.delay,
            timeout=args.timeout,
        )

    candidates = [
        hit
        for hit in hits.values()
        if start_ts <= hit.timestamp < end_ts and hit.url not in seen
    ]
    candidates.sort(key=lambda item: item.timestamp)

    new_articles: list[dict[str, Any]] = []
    for hit in candidates:
        try:
            article = parse_article(session, hit, args.timeout)
        except Exception as exc:
            print(f"skip {hit.url}: {exc}")
            continue

        haystack = f"{article.get('title')}\n{article.get('content')}"
        if event_filters and not any(event_filter in haystack for event_filter in event_filters):
            continue

        article["detected_at"] = datetime.now(LOCAL_TZ).isoformat()
        new_articles.append(article)
        seen.add(hit.url)

        if args.limit and len(new_articles) >= args.limit:
            break

        if args.delay:
            time.sleep(args.delay)

    return new_articles


def build_analyzer(args: argparse.Namespace) -> PTTMiniMaxAnalyzer | None:
    if not args.ai_analysis:
        return None

    if args.env_file:
        load_env_file(args.env_file)

    api_url = args.minimax_api_url or os.getenv("MINIMAX_API_URL", DEFAULT_MINIMAX_API_URL)
    model = args.minimax_model or os.getenv("MINIMAX_MODEL", DEFAULT_MINIMAX_MODEL)
    api_key = minimax_api_key_for(api_url, args.minimax_api_key)
    return PTTMiniMaxAnalyzer(
        api_key=api_key,
        api_url=api_url,
        model=model,
        timeout=args.minimax_timeout,
        trust_env=minimax_trust_env_for(api_url),
        content_max_chars=args.ai_content_max_chars,
        max_comments=args.ai_max_comments,
    )


def resolve_mattermost_config(args: argparse.Namespace) -> tuple[str | None, str | None, str | None]:
    if args.env_file:
        load_env_file(args.env_file)
    server_url = args.mattermost_server_url or os.getenv("OPENCROW_KAN_PUSH_URL") or ""
    bot_token = args.mattermost_bot_token or os.getenv("MATTERMOST_BOT_TOKEN")
    channel_id = args.mattermost_channel_id or os.getenv("MATTERMOST_CHANNEL_ID")
    return server_url, bot_token, channel_id


def analyze_articles(
    analyzer: PTTMiniMaxAnalyzer | None,
    articles: list[dict[str, Any]],
    continue_on_error: bool,
) -> None:
    if analyzer is None:
        return

    for article in articles:
        try:
            article["ai_analysis"] = analyzer.analyze(article)
        except MiniMaxAPIError as exc:
            error_text = str(exc)
            if "output new_sensitive" in error_text:
                article["ai_analysis"] = {
                    "anti_china_tendency": "yes",
                    "confidence": 1.0,
                    "reason": "敏感内容过滤了，但信息和指定的事件复核条件相关。",
                    "evidence": "",
                    "model": analyzer.model,
                }
                continue
            if not continue_on_error:
                raise
            article["ai_analysis"] = {
                "anti_china_tendency": "unclear",
                "confidence": 0.0,
                "reason": f"MiniMax 分析失败：{exc}",
                "evidence": "",
                "model": analyzer.model,
            }


def should_push_article(article: dict[str, Any], push_only_ai_yes: bool) -> bool:
    if not push_only_ai_yes:
        return True
    analysis = article.get("ai_analysis")
    if not isinstance(analysis, dict):
        return False
    return analysis.get("anti_china_tendency") == "yes"


def run(args: argparse.Namespace) -> None:
    seen = load_seen(args.state)
    pushed = load_seen(args.pushed_state)
    analyzer = build_analyzer(args)
    mattermost_server_url, mattermost_bot_token, mattermost_channel_id = resolve_mattermost_config(args)
    has_push_destination = bool(
        args.webhook_url or mattermost_channel_id
    )

    if args.reset_seen:
        seen.clear()

    if args.dry_run:
        boards = parse_csv_arg(args.boards, DEFAULT_BOARDS)
        event_filters = parse_csv_arg(args.event_filters, [])
        print(f"date={monitor_date(args)}")
        print(f"boards={len(boards)}")
        for i, board in enumerate(boards, 1):
            print(f"board {i}: {board}")
        print(f"event_filters={len(event_filters)}")
        for i, event_filter in enumerate(event_filters, 1):
            print(f"event_filter {i}: {event_filter}")
        return

    if not has_push_destination:
        print("warning: no Kan channel or webhook configured; matched articles will only be printed.")

    while True:
        date_text = monitor_date(args)
        print(f"scan {date_text} at {datetime.now(LOCAL_TZ).strftime('%Y-%m-%d %H:%M:%S')}")
        new_articles = scan_once(args, seen)

        if args.skip_initial and not args._initial_done:
            print(f"initial scan found {len(new_articles)} articles; marked as seen without pushing")
            args._initial_done = True
        else:
            analyze_articles(analyzer, new_articles, args.continue_on_analysis_error)
            if new_articles:
                append_events(args.events, new_articles)
                if analyzer is not None:
                    append_events(args.ai_events, new_articles)
            push_session = build_session(args.insecure, args.no_proxy)
            for article in new_articles:
                article_url = str(article.get("url") or "")
                if article_url in pushed:
                    continue
                if not should_push_article(article, args.push_only_ai_yes):
                    continue
                try:
                    delivered = push_article(
                        push_session,
                        article,
                        args.webhook_url,
                        args.webhook_type,
                        args.timeout,
                        mattermost_server_url=mattermost_server_url,
                        mattermost_bot_token=mattermost_bot_token,
                        mattermost_channel_id=mattermost_channel_id,
                    )
                    if delivered:
                        pushed.add(article_url)
                except Exception as exc:
                    print(f"push failed {article.get('url')}: {exc}")
            print(f"new articles: {len(new_articles)}")

        save_seen(args.state, seen)
        save_seen(args.pushed_state, pushed)

        if args.once:
            break

        time.sleep(args.interval)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Monitor latest PTT articles or review candidate event matches and push new articles.")
    parser.add_argument("--boards", help="Comma-separated board names.")
    parser.add_argument("--event-filter", dest="event_filters", metavar="EVENT_FILTER", help="Comma-separated candidate event expressions.")
    parser.add_argument("--date", default=None, help="Date to monitor, YYYY-MM-DD. Defaults to the current day on each scan.")
    parser.add_argument("--limit", type=int, default=0, help="Maximum new articles per scan, 0 means unlimited.")
    parser.add_argument("--max-pages-per-query", type=int, default=2, help="Search pages per board and event filter; in latest mode, latest board pages per scan.")
    parser.add_argument("--interval", type=int, default=60, help="Polling interval in seconds.")
    parser.add_argument("--delay", type=float, default=0.15, help="Delay between requests in seconds.")
    parser.add_argument("--timeout", type=int, default=20, help="HTTP timeout in seconds.")
    parser.add_argument("--insecure", action="store_true", help="Disable TLS certificate verification.")
    parser.add_argument("--no-proxy", action="store_true", help="Ignore proxy settings from the environment.")
    parser.add_argument("--once", action="store_true", help="Scan once and exit.")
    parser.add_argument("--dry-run", action="store_true", help="Print parsed boards and event filters, then exit.")
    parser.add_argument("--skip-initial", action="store_true", help="On first scan, mark matches as seen without pushing.")
    parser.add_argument("--reset-seen", action="store_true", help="Clear the seen state before starting.")
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE, help="Seen-state JSON file.")
    parser.add_argument("--events", type=Path, default=DEFAULT_EVENTS, help="JSONL file for pushed events.")
    parser.add_argument("--ai-events", type=Path, default=DEFAULT_AI_EVENTS, help="JSONL file for AI analysis results.")
    parser.add_argument("--pushed-state", type=Path, default=Path("output/ptt_monitor_pushed.json"), help="Pushed URL state file.")
    parser.add_argument("--webhook-url", help="Optional webhook URL for push notifications.")
    parser.add_argument(
        "--webhook-type",
        choices=["generic", "dingtalk", "feishu", "wechat", "serverchan", "ntfy"],
        default="generic",
        help="Webhook payload format.",
    )
    parser.add_argument("--mattermost-server-url", help="兼容旧参数；现在使用 OpenCrow Kan 推送入口。")
    parser.add_argument("--mattermost-bot-token", help="兼容旧参数；OpenCrow 鉴权请使用 OPENCROW_KAN_PUSH_TOKEN。")
    parser.add_argument("--mattermost-channel-id", help="Kan 频道 ID，多个频道用英文逗号分隔；默认读取 MATTERMOST_CHANNEL_ID。")
    parser.add_argument("--ai-analysis", action="store_true", help="Call MiniMax to analyze each new article before pushing.")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE, help="Optional .env file for MiniMax settings.")
    parser.add_argument("--minimax-api-key", help="MiniMax API Key; overrides environment variables.")
    parser.add_argument("--minimax-api-url", default=None)
    parser.add_argument("--minimax-model", default=None)
    parser.add_argument("--minimax-timeout", type=float, default=60.0)
    parser.add_argument("--ai-content-max-chars", type=int, default=6000, help="Maximum article content characters sent to AI.")
    parser.add_argument("--ai-max-comments", type=int, default=40, help="Maximum comments sent to AI.")
    parser.add_argument("--push-only-ai-yes", action="store_true", help="When AI is enabled, push only yes results.")
    parser.add_argument(
        "--continue-on-analysis-error",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Keep processing if MiniMax analysis fails; default true.",
    )
    args = parser.parse_args()
    args._initial_done = False
    return args


if __name__ == "__main__":
    try:
        run(parse_args())
    except KeyboardInterrupt:
        print("stopped")
        sys.exit(0)
