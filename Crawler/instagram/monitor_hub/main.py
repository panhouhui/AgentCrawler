from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

from hub.config import load_dotenv, parse_channel_ids, read_lines
from hub.instagram_source import InstagramSource
from hub.push import MattermostPusher
from hub.state import SeenStore
from hub.threads_source import ThreadsSource


ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parent
AGENTHUB_ROOT = Path(os.getenv("AGENTHUB_ROOT", ROOT.parents[2]))
CENTRAL_ENV_PATH = AGENTHUB_ROOT / "env" / "Crawler_env" / "instagram_env"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Instagram 和 Threads 统一监控。")
    parser.add_argument("--instagram", action="store_true", help="启用 Instagram 话题监控。")
    parser.add_argument("--threads", action="store_true", help="启用 Threads 用户监控。")
    parser.add_argument("--all", action="store_true", help="启用全部来源。")
    parser.add_argument(
        "--threads-users-file",
        default=str(ROOT / "config" / "threads_users.txt"),
        help="Threads 用户名文件。",
    )
    parser.add_argument("--threads-event-filter", default="", help="跨平台复核同一事件时使用的候选事件文本。")
    parser.add_argument("--instagram-limit", type=int, default=20, help="每轮每个 Instagram 话题抓取数量。")
    parser.add_argument("--threads-limit", type=int, default=20, help="每轮每个 Threads 用户抓取数量。")
    parser.add_argument("--interval", type=int, default=300, help="监控轮询间隔秒数。")
    parser.add_argument("--once", action="store_true", help="只运行一轮后退出。")
    parser.add_argument("--push", action="store_true", help="把新事件交给 OpenCrow 统一推送到 Kan。")
    parser.add_argument("--no-threads-online", action="store_true", help="使用 Threads-Scraper 离线模式。")
    parser.add_argument("--state-db", default=str(ROOT / "state" / "seen.sqlite3"), help="SQLite 去重状态库。")
    return parser


def make_pusher() -> MattermostPusher:
    return MattermostPusher(
        base_url=os.environ.get("OPENCROW_KAN_PUSH_URL", "http://127.0.0.1:48080/api/kan-push/dispatch"),
        token=os.environ.get("OPENCROW_KAN_PUSH_TOKEN", os.environ.get("OPENCROW_WEB_TOKEN", "")),
        channel_ids=parse_channel_ids(os.environ.get("MATTERMOST_CHANNEL_IDS")),
    )


def handle_events(events, seen: SeenStore, pusher: MattermostPusher | None) -> tuple[int, int]:
    total = 0
    new = 0
    for event in events:
        total += 1
        if not seen.is_new(event):
            continue
        new += 1
        print(f"[NEW] {event.platform} {event.target} {event.url}", flush=True)
        if pusher:
            pusher.push(event)
    return total, new


def run_cycle(args: argparse.Namespace, seen: SeenStore, pusher: MattermostPusher | None) -> None:
    enable_instagram = args.all or args.instagram
    enable_threads = args.all or args.threads
    if not enable_instagram and not enable_threads:
        enable_instagram = True
        enable_threads = True

    cycle_total = 0
    cycle_new = 0

    if enable_instagram:
        print(
            "Instagram 暂未启用无关键词自主发现入口；当前仅运行 Threads 账号巡检。",
            flush=True,
        )

    if enable_threads:
        users = [value.lstrip("@") for value in read_lines(Path(args.threads_users_file))]
        event_filters = [args.threads_event_filter] if args.threads_event_filter else []
        if users:
            threads = ThreadsSource(
                project_root=WORKSPACE / "Threads-Scraper",
                online=not args.no_threads_online,
                request_limit=args.threads_limit,
            )
            for username in users:
                try:
                    total, new = handle_events(
                        threads.fetch_user(username, args.threads_limit, event_filters),
                        seen,
                        pusher,
                    )
                    cycle_total += total
                    cycle_new += new
                    print(f"Threads @{username}: checked {total}, new {new}", flush=True)
                except Exception as exc:
                    print(f"Threads @{username} failed: {exc}", file=sys.stderr, flush=True)
        else:
            print(f"No Threads users found: {args.threads_users_file}", flush=True)

    print(f"Cycle finished: checked {cycle_total}, new {cycle_new}", flush=True)


def main() -> int:
    load_dotenv(
        [
            CENTRAL_ENV_PATH,
        ]
    )
    args = build_parser().parse_args()
    if args.interval < 30:
        raise ValueError("--interval must be at least 30 seconds.")

    seen = SeenStore(Path(args.state_db))
    pusher = make_pusher() if args.push else None
    try:
        while True:
            run_cycle(args, seen, pusher)
            if args.once:
                break
            print(f"Sleeping {args.interval} seconds...", flush=True)
            time.sleep(args.interval)
    finally:
        seen.close()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nStopped by user.", file=sys.stderr)
        raise SystemExit(130)
