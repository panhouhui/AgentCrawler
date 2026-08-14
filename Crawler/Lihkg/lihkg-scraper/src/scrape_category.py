import argparse
import json
import os
import random
import re
import string
import sys
import time
import warnings
from html import unescape
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple
from urllib.parse import urlsplit, urlunsplit

import requests
from bs4 import BeautifulSoup, MarkupResemblesLocatorWarning
from requests import HTTPError
from requests.exceptions import ProxyError
from tqdm import tqdm

CRAWLER_ROOT = Path(__file__).resolve().parents[3]
if str(CRAWLER_ROOT) not in sys.path:
    sys.path.insert(0, str(CRAWLER_ROOT))

from kan_push_bridge import KanPushError, dispatch_kan_message

BASE_URL = "https://lihkg.com"
API_BASE_URL = f"{BASE_URL}/api_v2"
DEFAULT_ENV_FILE = r"F:\AgentHub\env\Crawler_env\Lihkg_env"
DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/127.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "zh-HK,zh-TW;q=0.9,zh-CN;q=0.8,en;q=0.7",
}

warnings.filterwarnings("ignore", category=MarkupResemblesLocatorWarning)


class RateLimitedError(RuntimeError):
    pass


def random_session_id() -> str:
    alphabet = string.ascii_lowercase + string.digits
    return "s" + "".join(random.choice(alphabet) for _ in range(10))


def rotate_brightdata_proxy_url(proxy_url: str) -> Optional[str]:
    if not proxy_url or "brd.superproxy.io" not in proxy_url:
        return None

    parts = urlsplit(proxy_url)
    if "@" not in parts.netloc or ":" not in parts.netloc.rsplit("@", 1)[0]:
        return None

    userpass, host = parts.netloc.rsplit("@", 1)
    username, password = userpass.split(":", 1)
    username_base = username.split("-session-")[0]
    username_new = f"{username_base}-session-{random_session_id()}"
    return urlunsplit((parts.scheme, f"{username_new}:{password}@{host}", "", "", ""))


def rotate_session_proxy(session: requests.Session) -> bool:
    current = session.proxies.get("https") or session.proxies.get("http")
    rotated = rotate_brightdata_proxy_url(current or "")
    if not rotated:
        return False
    session.proxies.update({"http": rotated, "https": rotated})
    session.proxy_rotations = getattr(session, "proxy_rotations", 0) + 1
    return True


def parse_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def load_env_file(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}

    values = {}
    with path.open(encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                value = value[1:-1]
            values[key] = value
    return values


def env_value(env: Dict[str, str], key: str, default: Any, cast: Any = str) -> Any:
    value = os.environ.get(key, env.get(key))
    if value is None or value == "":
        return default
    if cast is bool:
        return parse_bool(value)
    return cast(value)


def make_thread_url(thread_id: int, page: int = 1) -> str:
    return f"{BASE_URL}/thread/{thread_id}/page/{page}"


def append_jsonl(path: Path, record: Dict[str, Any]) -> None:
    with path.open("a", encoding="utf-8") as f:
        print(json.dumps(record, ensure_ascii=False, separators=(",", ":")), file=f)


def truncate_text(text: str, limit: int) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


def build_mattermost_message(record: Dict[str, Any]) -> str:
    title = record.get("title") or "(untitled)"
    url = record.get("url") or ""
    source_type = record.get("source_type")
    source_list = ",".join(record.get("source_list") or [])
    source_label = {"now": "最新", "hot": "热门"}.get(source_type or source_list, source_type or source_list or "unknown")
    comments = record.get("comments") or []
    comment_count = record.get("new_comment_count", len(comments))
    category = record.get("category") or ""
    parts = [
        f"### LIHKG {source_label}动态",
        f"**{title}**",
        f"- 分类: {category or 'unknown'}",
        f"- 榜单: {source_label}",
        f"- 链接: {url}",
        f"- 新评论: {comment_count}",
    ]
    for comment in comments[:3]:
        text = truncate_text(comment.get("text") or "", 160)
        if not text:
            text = "(无文本内容)"
        comment_url = comment.get("url") or url
        parts.append(f"- [#{comment.get('msg_num')}]({comment_url}) {comment.get('user_nickname') or 'unknown'}: {text}")
    return "\n".join(parts)


def push_mattermost(args: argparse.Namespace, record: Dict[str, Any]) -> Optional[str]:
    if not args.mattermost_enabled:
        return None
    try:
        dispatch_kan_message(
            platform="lihkg",
            route_id="lihkg-kan",
            message=build_mattermost_message(record),
            channel_ids=[args.mattermost_channel_id] if args.mattermost_channel_id else None,
            source="lihkg-scraper",
            dedupe_key=str(record.get("url") or record.get("thread_id") or ""),
            metadata={"record": record},
            timeout=20,
        )
    except KanPushError as exc:
        return str(exc)
    return None


def request_json(
    session: requests.Session,
    url: str,
    referer: str,
    retries: int,
    backoff_base: float,
    max_rate_limit_wait: float,
) -> Dict[str, Any]:
    headers = dict(DEFAULT_HEADERS)
    headers["Referer"] = referer
    if getattr(session, "lihkg_cookie", ""):
        headers["Cookie"] = session.lihkg_cookie

    proxy_rotate_retries = int(getattr(session, "proxy_rotate_retries", 0) or 0)
    attempts_total = max(retries, proxy_rotate_retries)
    for attempt in range(1, attempts_total + 1):
        try:
            response = session.get(url, headers=headers, proxies=session.proxies, timeout=30)
            if response.status_code == 429:
                retry_after = response.headers.get("Retry-After")
                if retry_after and retry_after.isdigit():
                    wait_seconds = int(retry_after)
                else:
                    wait_seconds = backoff_base * attempt * attempt + random.uniform(0, 1)
                if attempt == attempts_total:
                    raise RateLimitedError(f"429 Too Many Requests: {url}")
                if rotate_session_proxy(session):
                    time.sleep(random.uniform(0.2, 0.8))
                    continue
                if wait_seconds > max_rate_limit_wait:
                    raise RateLimitedError(
                        f"429 Too Many Requests, wait {wait_seconds:.1f}s exceeds limit: {url}"
                    )
                time.sleep(wait_seconds)
                continue

            response.raise_for_status()
            return response.json()
        except ProxyError:
            if attempt == attempts_total or not rotate_session_proxy(session):
                raise
            time.sleep(min(backoff_base, 2) + random.uniform(0, 1))
        except (requests.RequestException, ValueError):
            if attempt == attempts_total:
                raise
            rotate_session_proxy(session)
            time.sleep(backoff_base * attempt + random.uniform(0, 1))

    raise RuntimeError("unreachable")


def clean_html(html: str) -> str:
    soup = BeautifulSoup(html or "", "lxml")
    for blockquote in soup.find_all("blockquote"):
        blockquote.decompose()
    text = soup.get_text("\n")
    text = unescape(text)
    text = re.sub(r"\n+", "\n", text)
    return text.strip()


def extract_links(html: str) -> List[str]:
    soup = BeautifulSoup(html or "", "lxml")
    links = []
    for tag in soup.find_all(["a", "img"]):
        value = tag.get("href") or tag.get("src")
        if not value:
            continue
        if value.startswith("/"):
            value = BASE_URL + value
        links.append(value)
    return links


def load_state(path: Path) -> Dict[str, Any]:
    if not path.exists() or path.stat().st_size == 0:
        return {
            "seen_threads": [],
            "seen_posts": [],
            "seen_events": [],
            "threads": {},
            "last_run": None,
        }

    with path.open(encoding="utf-8") as f:
        state = json.load(f)
    state.setdefault("seen_threads", [])
    state.setdefault("seen_posts", [])
    state.setdefault("seen_events", [])
    state.setdefault("threads", {})
    state.setdefault("last_run", None)
    return state


def save_state(path: Path, state: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2, sort_keys=True)
    tmp_path.replace(path)


def state_sets(state: Dict[str, Any]) -> Tuple[Set[int], Set[str]]:
    seen_threads = {int(value) for value in state.get("seen_threads", [])}
    seen_posts = {str(value) for value in state.get("seen_posts", [])}
    return seen_threads, seen_posts


def event_state_set(state: Dict[str, Any]) -> Set[str]:
    return {str(value) for value in state.get("seen_events", [])}


def limit_threads_per_source(threads: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    if limit <= 0:
        return threads

    counts: Dict[str, int] = {}
    limited = []
    for thread in threads:
        source_type = str(thread.get("source_type") or "")
        count = counts.get(source_type, 0)
        if count >= limit:
            continue
        counts[source_type] = count + 1
        limited.append(thread)
    return limited


def is_thread_recent(thread: Dict[str, Any], now: int, max_age_days: float) -> bool:
    if max_age_days <= 0:
        return True
    create_time = thread.get("create_time")
    if not create_time:
        return False
    return now - int(create_time) <= max_age_days * 86400


def filter_recent_threads(threads: List[Dict[str, Any]], max_age_days: float) -> List[Dict[str, Any]]:
    if max_age_days <= 0:
        return threads
    now = int(time.time())
    return [thread for thread in threads if is_thread_recent(thread, now, max_age_days)]


def get_category_page(
    session: requests.Session,
    cat_id: int,
    list_type: str,
    page: int,
    count: int,
    retries: int,
    backoff_base: float,
    max_rate_limit_wait: float,
) -> List[Dict[str, Any]]:
    url = (
        f"{API_BASE_URL}/thread/category"
        f"?cat_id={cat_id}&page={page}&count={count}&type={list_type}"
    )
    obj = request_json(
        session=session,
        url=url,
        referer=f"{BASE_URL}/category/{cat_id}",
        retries=retries,
        backoff_base=backoff_base,
        max_rate_limit_wait=max_rate_limit_wait,
    )
    if obj.get("success") != 1:
        return []
    return obj.get("response", {}).get("items", [])


def get_thread_page(
    session: requests.Session,
    thread_id: int,
    page: int,
    retries: int,
    backoff_base: float,
    max_rate_limit_wait: float,
) -> Dict[str, Any]:
    url = f"{API_BASE_URL}/thread/{thread_id}/page/{page}?order=reply_time"
    return request_json(
        session=session,
        url=url,
        referer=make_thread_url(thread_id, page),
        retries=retries,
        backoff_base=backoff_base,
        max_rate_limit_wait=max_rate_limit_wait,
    )


def normalize_comment(item: Dict[str, Any], thread_id: int) -> Dict[str, Any]:
    html = item.get("msg") or ""
    page = item.get("page") or 1
    msg_num = item.get("msg_num")
    return {
        "post_id": item.get("post_id"),
        "msg_num": msg_num,
        "page": page,
        "url": f"{make_thread_url(thread_id, page)}#{msg_num}" if msg_num else make_thread_url(thread_id, page),
        "user_nickname": item.get("user_nickname"),
        "user_gender": item.get("user_gender"),
        "reply_time": item.get("reply_time"),
        "like_count": item.get("like_count"),
        "dislike_count": item.get("dislike_count"),
        "vote_score": item.get("vote_score"),
        "status": item.get("status"),
        "text": clean_html(html),
        "html": html,
        "links": extract_links(html),
    }


def normalize_thread_summary(item: Dict[str, Any], list_type: str) -> Dict[str, Any]:
    thread_id = int(item["thread_id"])
    return {
        "source_type": list_type,
        "source_list": [list_type],
        "thread_id": thread_id,
        "url": make_thread_url(thread_id),
        "title": item.get("title"),
        "cat_id": item.get("cat_id"),
        "category": (item.get("category") or {}).get("name"),
        "sub_cat_id": item.get("sub_cat_id"),
        "user_nickname": item.get("user_nickname"),
        "user_gender": item.get("user_gender"),
        "create_time": item.get("create_time"),
        "last_reply_time": item.get("last_reply_time"),
        "no_of_reply": item.get("no_of_reply"),
        "no_of_uni_user_reply": item.get("no_of_uni_user_reply"),
        "total_page": item.get("total_page") or 1,
        "like_count": item.get("like_count"),
        "dislike_count": item.get("dislike_count"),
        "reply_like_count": item.get("reply_like_count"),
        "reply_dislike_count": item.get("reply_dislike_count"),
        "status": item.get("status"),
        "is_hot": item.get("is_hot"),
    }


def merge_thread(existing: Dict[str, Any], current: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(existing)
    for key, value in current.items():
        if value is not None:
            merged[key] = value
    merged["source_list"] = sorted(set(existing.get("source_list", [])) | set(current.get("source_list", [])))
    return merged


def discover_threads(
    session: requests.Session,
    cat_id: int,
    list_types: Iterable[str],
    list_pages: int,
    list_count: int,
    retries: int,
    backoff_base: float,
    max_rate_limit_wait: float,
    delay: float,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    threads = []
    errors = []

    for list_type in list_types:
        for page in range(1, list_pages + 1):
            try:
                items = get_category_page(
                    session=session,
                    cat_id=cat_id,
                    list_type=list_type,
                    page=page,
                    count=list_count,
                    retries=retries,
                    backoff_base=backoff_base,
                    max_rate_limit_wait=max_rate_limit_wait,
                )
            except Exception as exc:
                errors.append({"stage": "category", "type": list_type, "page": page, "error": str(exc)})
                break

            if not items:
                break

            for item in items:
                threads.append(normalize_thread_summary(item, list_type))

            if delay:
                time.sleep(delay)

    return threads, errors


def collect_comments(
    session: requests.Session,
    thread_id: int,
    total_page: int,
    seen_posts: Set[str],
    start_page: int,
    retries: int,
    backoff_base: float,
    max_rate_limit_wait: float,
    delay: float,
    max_pages_per_thread: int,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    comments = []
    errors = []
    pages_to_fetch = total_page
    if max_pages_per_thread > 0:
        pages_to_fetch = min(total_page, start_page + max_pages_per_thread - 1)

    for page in range(start_page, pages_to_fetch + 1):
        try:
            obj = get_thread_page(
                session=session,
                thread_id=thread_id,
                page=page,
                retries=retries,
                backoff_base=backoff_base,
                max_rate_limit_wait=max_rate_limit_wait,
            )
        except HTTPError as exc:
            status_code = exc.response.status_code if exc.response is not None else None
            errors.append({"stage": "thread", "thread_id": thread_id, "page": page, "error": str(exc), "status_code": status_code})
            continue
        except Exception as exc:
            errors.append({"stage": "thread", "thread_id": thread_id, "page": page, "error": str(exc), "status_code": None})
            continue

        if obj.get("success") != 1:
            errors.append({"stage": "thread", "thread_id": thread_id, "page": page, "error": "success is not 1", "status_code": None})
            continue

        for item in obj.get("response", {}).get("item_data", []):
            post_id = str(item.get("post_id") or "")
            if not post_id or post_id in seen_posts:
                continue
            comment = normalize_comment(item, thread_id)
            comments.append(comment)
            seen_posts.add(post_id)

        if delay:
            time.sleep(delay)

    return comments, errors


def run_once(args: argparse.Namespace, show_progress: bool = True) -> Dict[str, int]:
    list_types = [value.strip() for value in args.types.split(",") if value.strip()]
    output = Path(args.output)
    error_output = Path(args.error_output)
    state_path = Path(args.state)
    output.parent.mkdir(parents=True, exist_ok=True)
    error_output.parent.mkdir(parents=True, exist_ok=True)

    state = load_state(state_path)
    seen_threads, seen_posts = state_sets(state)
    seen_events = event_state_set(state)
    stats = {
        "discovered_threads": 0,
        "new_threads": 0,
        "new_comments": 0,
        "errors": 0,
    }

    with requests.Session() as session:
        if args.proxy:
            session.proxies.update({"http": args.proxy, "https": args.proxy})
            session.proxy_rotate_retries = args.proxy_rotate_retries
        if args.cookie:
            session.lihkg_cookie = args.cookie

        threads, discovery_errors = discover_threads(
            session=session,
            cat_id=args.cat_id,
            list_types=list_types,
            list_pages=args.list_pages,
            list_count=args.list_count,
            retries=args.retries,
            backoff_base=args.backoff_base,
            max_rate_limit_wait=args.max_rate_limit_wait,
            delay=args.request_delay,
        )
        stats["discovered_threads"] = len(threads)
        stats["errors"] += len(discovery_errors)
        for error in discovery_errors:
            append_jsonl(error_output, error)

        threads = filter_recent_threads(threads, args.max_thread_age_days)
        threads = limit_threads_per_source(threads, args.limit_threads)

        seen_event_keys = set()
        iterator = tqdm(threads, desc="threads") if show_progress else threads
        for thread in iterator:
            thread_id = int(thread["thread_id"])
            source_type = thread.get("source_type") or ",".join(thread.get("source_list") or [])
            event_key = f"{source_type}:{thread_id}"
            if event_key in seen_event_keys:
                continue
            seen_event_keys.add(event_key)

            is_new_thread = thread_id not in seen_threads
            if is_new_thread:
                stats["new_threads"] += 1
                seen_threads.add(thread_id)

            previous_thread = state["threads"].get(str(thread_id), {})
            previous_total_page = int(previous_thread.get("total_page") or 1)
            current_total_page = int(thread.get("total_page") or 1)
            if is_new_thread or not args.tail_existing:
                start_page = 1
                total_page = current_total_page
            else:
                start_page = max(1, min(previous_total_page, current_total_page))
                total_page = current_total_page

            comments, errors = collect_comments(
                session=session,
                thread_id=thread_id,
                total_page=total_page,
                seen_posts=seen_posts,
                start_page=start_page,
                retries=args.retries,
                backoff_base=args.backoff_base,
                max_rate_limit_wait=args.max_rate_limit_wait,
                delay=args.request_delay,
                max_pages_per_thread=args.max_pages_per_thread,
            )
            stats["new_comments"] += len(comments)
            stats["errors"] += len(errors)
            for error in errors:
                append_jsonl(error_output, error)

            state["threads"][str(thread_id)] = merge_thread(state["threads"].get(str(thread_id), {}), thread)

            is_new_source_event = event_key not in seen_events
            should_emit = is_new_source_event or comments
            if should_emit:
                record = dict(thread)
                record["event"] = "thread_update"
                record["comments"] = comments
                record["new_comment_count"] = len(comments)
                record["captured_at"] = int(time.time())
                append_jsonl(output, record)
                push_error = push_mattermost(args, record)
                if push_error:
                    append_jsonl(
                        error_output,
                        {
                            "stage": "mattermost",
                            "thread_id": thread_id,
                            "error": push_error,
                        },
                    )
                seen_events.add(event_key)

            state["seen_threads"] = sorted(seen_threads)
            state["seen_posts"] = sorted(seen_posts)
            state["seen_events"] = sorted(seen_events)
            state["last_run"] = int(time.time())
            save_state(state_path, state)

    return stats


def add_common_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--cat-id", type=int, default=None, help="LIHKG category id. 1 is water cooler.")
    parser.add_argument("--types", default=None, help="Comma-separated category list types, e.g. now,hot.")
    parser.add_argument("--list-pages", type=int, default=None, help="How many category pages to read per type.")
    parser.add_argument("--list-count", type=int, default=None, help="Threads per category page.")
    parser.add_argument("--max-pages-per-thread", type=int, default=None, help="Limit comment pages per thread. 0 means all pages.")
    parser.add_argument("--limit-threads", type=int, default=None, help="Limit total discovered threads per run. 0 means no limit.")
    parser.add_argument("--max-thread-age-days", type=float, default=None, help="Only process threads created within this many days. 0 means no age limit.")
    parser.add_argument("--request-delay", type=float, default=None, help="Delay between API requests.")
    parser.add_argument("--retries", type=int, default=None, help="Retry count for each request.")
    parser.add_argument("--backoff-base", type=float, default=None, help="Base seconds for retry backoff.")
    parser.add_argument("--max-rate-limit-wait", type=float, default=None, help="Skip a request if 429 backoff exceeds this many seconds.")
    parser.add_argument("--proxy", default=None, help="Optional HTTP/SOCKS proxy URL, e.g. http://user:pass@host:port.")
    parser.add_argument("--proxy-rotate-retries", type=int, default=None, help="Retry count using new Bright Data sessions when proxy errors or 429 happen.")
    parser.add_argument("--cookie", default=None, help="Optional raw Cookie header copied from a browser session.")
    parser.add_argument("--tail-existing", action="store_true", default=None, help="For known threads, fetch from the previous last page instead of page 1.")
    parser.add_argument("--state", default=None, help="Deduplication state file.")
    parser.add_argument("--output", default=None, help="Append-only JSONL output file.")
    parser.add_argument("--error-output", default=None, help="Append-only JSONL error file.")
    parser.add_argument("--mattermost-enabled", action="store_true", default=None, help="Push new records to Mattermost.")
    parser.add_argument("--mattermost-url", default=None, help="Mattermost base URL.")
    parser.add_argument("--mattermost-token", default=None, help="Mattermost bot token.")
    parser.add_argument("--mattermost-channel-id", default=None, help="Mattermost channel id.")


def apply_env_defaults(args: argparse.Namespace) -> argparse.Namespace:
    env = load_env_file(Path(args.env_file))
    args.cat_id = args.cat_id if args.cat_id is not None else env_value(env, "LIHKG_CAT_ID", 1, int)
    args.types = args.types if args.types is not None else env_value(env, "LIHKG_TYPES", "now,hot")
    args.list_pages = args.list_pages if args.list_pages is not None else env_value(env, "LIHKG_LIST_PAGES", 1, int)
    args.list_count = args.list_count if args.list_count is not None else env_value(env, "LIHKG_LIST_COUNT", 60, int)
    args.max_pages_per_thread = (
        args.max_pages_per_thread
        if args.max_pages_per_thread is not None
        else env_value(env, "LIHKG_MAX_PAGES_PER_THREAD", 0, int)
    )
    args.limit_threads = args.limit_threads if args.limit_threads is not None else env_value(env, "LIHKG_LIMIT_THREADS", 0, int)
    args.max_thread_age_days = (
        args.max_thread_age_days
        if args.max_thread_age_days is not None
        else env_value(env, "LIHKG_MAX_THREAD_AGE_DAYS", 3.0, float)
    )
    args.request_delay = args.request_delay if args.request_delay is not None else env_value(env, "LIHKG_REQUEST_DELAY", 3.0, float)
    args.retries = args.retries if args.retries is not None else env_value(env, "LIHKG_RETRIES", 5, int)
    args.backoff_base = args.backoff_base if args.backoff_base is not None else env_value(env, "LIHKG_BACKOFF_BASE", 5.0, float)
    args.max_rate_limit_wait = (
        args.max_rate_limit_wait
        if args.max_rate_limit_wait is not None
        else env_value(env, "LIHKG_MAX_RATE_LIMIT_WAIT", 60.0, float)
    )
    args.proxy = args.proxy if args.proxy is not None else env_value(env, "LIHKG_PROXY", "")
    args.proxy_rotate_retries = (
        args.proxy_rotate_retries
        if args.proxy_rotate_retries is not None
        else env_value(env, "LIHKG_PROXY_ROTATE_RETRIES", 30, int)
    )
    args.cookie = args.cookie if args.cookie is not None else env_value(env, "LIHKG_COOKIE", "")
    args.tail_existing = (
        args.tail_existing
        if args.tail_existing is not None
        else env_value(env, "LIHKG_TAIL_EXISTING", True, bool)
    )
    args.state = args.state if args.state is not None else env_value(env, "LIHKG_STATE", "lihkg-state.json")
    args.output = args.output if args.output is not None else env_value(env, "LIHKG_OUTPUT", "lihkg-events.jsonl")
    args.error_output = (
        args.error_output
        if args.error_output is not None
        else env_value(env, "LIHKG_ERROR_OUTPUT", "lihkg-errors.jsonl")
    )
    args.mattermost_enabled = (
        args.mattermost_enabled
        if args.mattermost_enabled is not None
        else env_value(env, "MATTERMOST_ENABLED", False, bool)
    )
    args.mattermost_url = (
        args.mattermost_url
        if args.mattermost_url is not None
        else env_value(env, "MATTERMOST_URL", "")
    )
    args.mattermost_token = (
        args.mattermost_token
        if args.mattermost_token is not None
        else env_value(env, "MATTERMOST_TOKEN", "")
    )
    args.mattermost_channel_id = (
        args.mattermost_channel_id
        if args.mattermost_channel_id is not None
        else env_value(env, "MATTERMOST_CHANNEL_ID", "")
    )
    if hasattr(args, "interval"):
        args.interval = args.interval if args.interval is not None else env_value(env, "LIHKG_INTERVAL", 120.0, float)
    if hasattr(args, "cycles"):
        args.cycles = args.cycles if args.cycles is not None else env_value(env, "LIHKG_CYCLES", 0, int)
    return args


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape and monitor LIHKG latest/hot category threads.")
    parser.add_argument("--env-file", default=DEFAULT_ENV_FILE, help="Path to .env config file.")
    subparsers = parser.add_subparsers(dest="command")

    once_parser = subparsers.add_parser("once", help="Run one discovery and scrape cycle.")
    add_common_args(once_parser)

    watch_parser = subparsers.add_parser("watch", help="Continuously monitor for new threads and comments.")
    add_common_args(watch_parser)
    watch_parser.add_argument("--interval", type=float, default=None, help="Seconds between discovery cycles.")
    watch_parser.add_argument("--cycles", type=int, default=None, help="Stop after N cycles. 0 means forever.")

    args = parser.parse_args()
    if not args.command:
        args.command = "once"
    return apply_env_defaults(args)


def main() -> None:
    args = parse_args()
    if args.command == "watch":
        cycle = 0
        while True:
            cycle += 1
            stats = run_once(args, show_progress=False)
            print(f"cycle={cycle} stats={stats}")
            if args.cycles and cycle >= args.cycles:
                break
            time.sleep(args.interval)
    else:
        stats = run_once(args)
        print(f"stats={stats}")


if __name__ == "__main__":
    main()
