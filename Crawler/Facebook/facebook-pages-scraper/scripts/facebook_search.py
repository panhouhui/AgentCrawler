from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import quote, unquote, urljoin, urlparse, urlunparse

from curl_cffi import requests
from selectolax.parser import HTMLParser

from facebook_page_scraper.request_handler import FacebookScraperError, RequestHandler

try:
    from scripts.mattermost_client import push_posts_to_mattermost
except ModuleNotFoundError:
    from mattermost_client import push_posts_to_mattermost


SEARCH_TYPES = {
    "all": "top",
    "posts": "posts",
    "pages": "pages",
    "groups": "groups",
    "people": "people",
}

BEIJING_TZ = timezone(timedelta(hours=8))


def clean_facebook_url(url: str) -> Optional[str]:
    if not url:
        return None

    absolute = urljoin("https://www.facebook.com", url)
    parsed = urlparse(absolute)

    if parsed.netloc not in {"www.facebook.com", "facebook.com", "m.facebook.com"}:
        return None

    path = unquote(parsed.path)
    skip_prefixes = (
        "/ajax",
        "/login",
        "/search",
        "/legal",
        "/help",
        "/privacy",
        "/policies",
        "/recover",
        "/reg",
        "/watch",
        "/reel",
        "/stories",
        "/notifications",
        "/messages",
        "/friends",
        "/groups",
        "/marketplace",
        "/memories",
        "/events",
        "/find-friends",
        "/pokes",
        "/settings",
    )
    if not path or path == "/" or path.startswith(skip_prefixes):
        return None

    query = parsed.query
    query = re.sub(r"(^|&)__cft__\[[^&]+", "", query)
    query = re.sub(r"(^|&)(__tn__|ref|refid|mibextid|locale)=[^&]*", "", query)
    query = query.strip("&")

    return urlunparse(("https", "www.facebook.com", parsed.path, "", query, ""))


def extract_links(html: str) -> List[str]:
    parser = HTMLParser(html)
    links: List[str] = []
    seen = set()

    for anchor in parser.css("a[href]"):
        cleaned = clean_facebook_url(anchor.attrs.get("href", ""))
        if not cleaned or cleaned in seen:
            continue

        seen.add(cleaned)
        links.append(cleaned)

    escaped_url_patterns = (
        r"https:\\/\\/www\.facebook\.com\\/[^\"\\]+",
        r'"(?:profile_url|url)":"(https:\\/\\/www\.facebook\.com\\/[^\"\\]+)',
    )

    for pattern in escaped_url_patterns:
        for match in re.findall(pattern, html):
            raw_url = match[0] if isinstance(match, tuple) else match
            try:
                unescaped_url = json.loads(f'"{raw_url}"')
            except json.JSONDecodeError:
                unescaped_url = raw_url.replace("\\/", "/")

            cleaned = clean_facebook_url(unescaped_url)
            if not cleaned or cleaned in seen:
                continue

            seen.add(cleaned)
            links.append(cleaned)

    return links


def walk_json(value: Any) -> Iterable[Any]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk_json(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_json(child)


def text_matches(text: str, event_query: str) -> bool:
    if not event_query.strip():
        return True
    return event_query.lower() in text.lower()


def safe_print(value: str) -> None:
    encoding = sys.stdout.encoding or "utf-8"
    print(value.encode(encoding, errors="replace").decode(encoding, errors="replace"))


def find_matching_text(value: Any, event_query: str) -> Optional[str]:
    if isinstance(value, dict):
        message = value.get("message")
        if isinstance(message, dict):
            text = message.get("text")
            if isinstance(text, str) and text_matches(text, event_query):
                return text

        text = value.get("text")
        if isinstance(text, str) and text_matches(text, event_query):
            return text

        for child in value.values():
            found = find_matching_text(child, event_query)
            if found:
                return found
    elif isinstance(value, list):
        for child in value:
            found = find_matching_text(child, event_query)
            if found:
                return found

    return None


def find_first_text(value: Any) -> Optional[str]:
    if isinstance(value, dict):
        message = value.get("message")
        if isinstance(message, dict):
            text = message.get("text")
            if isinstance(text, str) and text.strip():
                return text

        for key in ("text", "title", "description", "body"):
            text = value.get(key)
            if isinstance(text, str) and text.strip():
                return text

        for child in value.values():
            found = find_first_text(child)
            if found:
                return found
    elif isinstance(value, list):
        for child in value:
            found = find_first_text(child)
            if found:
                return found

    return None


def find_first_key(value: Any, keys: set[str]) -> Optional[Any]:
    if isinstance(value, dict):
        for key in keys:
            if value.get(key):
                return value[key]

        for child in value.values():
            found = find_first_key(child, keys)
            if found:
                return found
    elif isinstance(value, list):
        for child in value:
            found = find_first_key(child, keys)
            if found:
                return found

    return None


def find_actor(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        actors = value.get("actors")
        if (
            isinstance(actors, list)
            and actors
            and isinstance(actors[0], dict)
            and actors[0].get("name")
        ):
            return actors[0]

        feedback = value.get("feedback")
        if isinstance(feedback, dict):
            owning_profile = feedback.get("owning_profile")
            if isinstance(owning_profile, dict) and owning_profile.get("name"):
                return owning_profile

        for child in value.values():
            actor = find_actor(child)
            if actor:
                return actor
    elif isinstance(value, list):
        for child in value:
            actor = find_actor(child)
            if actor:
                return actor

    return {}


def extract_posts(html: str, event_query: str) -> List[Dict[str, str]]:
    parser = HTMLParser(html)
    posts: List[Dict[str, str]] = []
    seen = set()

    for script in parser.css('script[type="application/json"]'):
        script_text = script.text(strip=True)
        if "serpResponse" not in script_text or "wwwURL" not in script_text:
            continue

        try:
            payload = json.loads(script_text)
        except json.JSONDecodeError:
            continue

        for item in walk_json(payload):
            if "creation_time" not in item or "post_id" not in item:
                continue

            text = find_matching_text(item, event_query) if event_query.strip() else find_first_text(item)
            if not text:
                continue

            post_url = (
                item.get("wwwURL")
                or item.get("permalink_url")
                or find_first_key(item, {"wwwURL", "permalink_url", "url"})
                or ""
            )
            post_id = str(item.get("post_id") or item.get("id") or post_url)
            if post_id in seen:
                continue

            seen.add(post_id)
            actor = find_actor(item)
            creation_time = item.get("creation_time")
            created_at = ""
            age_days = ""

            if isinstance(creation_time, (int, float)):
                created_datetime = datetime.fromtimestamp(creation_time, tz=timezone.utc)
                created_at = created_datetime.astimezone(BEIJING_TZ).strftime(
                    "%Y-%m-%d %H:%M:%S"
                )
                age_days = str(
                    (datetime.now(timezone.utc) - created_datetime).days
                )

            posts.append(
                {
                    "post_id": post_id,
                    "creation_time": str(creation_time or ""),
                    "created_at": created_at,
                    "age_days": age_days,
                    "source_name": str(actor.get("name") or ""),
                    "source_url": str(actor.get("url") or ""),
                    "post_url": str(post_url),
                    "matched_event_query": event_query,
                    "text": text,
                }
            )

    return posts


def filter_posts_by_days(posts: List[Dict[str, str]], days: Optional[int]) -> List[Dict[str, str]]:
    if days is None:
        return posts

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    filtered = []

    for post in posts:
        creation_time = post.get("creation_time")
        try:
            created_datetime = datetime.fromtimestamp(int(creation_time), tz=timezone.utc)
        except (TypeError, ValueError):
            continue

        if created_datetime >= cutoff:
            filtered.append(post)

    return filtered


def fetch_search_html(event_query: str, search_type: str) -> str:
    handler = RequestHandler()
    path = SEARCH_TYPES[search_type]
    url = f"https://www.facebook.com/search/{path}/?q={quote(event_query)}"
    response = requests.get(
        url,
        headers=handler.headers,
        proxies=handler.proxies,
        timeout=30,
        impersonate="chrome",
    )

    if response.status_code in {401, 403, 404}:
        raise FacebookScraperError(
            "Facebook search requires your logged-in browser cookie. Set "
            "FACEBOOK_COOKIE or FACEBOOK_COOKIE_FILE before running this script."
        )

    response.raise_for_status()
    return response.text


def fetch_discover_html() -> str:
    handler = RequestHandler()
    response = requests.get(
        "https://www.facebook.com/",
        headers=handler.headers,
        proxies=handler.proxies,
        timeout=30,
        impersonate="chrome",
    )

    if response.status_code in {401, 403, 404}:
        raise FacebookScraperError(
            "Facebook discovery requires your logged-in browser cookie. Set "
            "FACEBOOK_COOKIE or FACEBOOK_COOKIE_FILE before running this script."
        )

    response.raise_for_status()
    return response.text


def search_facebook(event_query: str, search_type: str) -> List[Any]:
    html = fetch_discover_html() if not event_query.strip() and search_type == "posts" else fetch_search_html(event_query, search_type)

    if search_type == "posts":
        return extract_posts(html, event_query)

    links = extract_links(html)

    return links


def search_event_queries(
    event_queries: List[str],
    search_type: str,
    days: Optional[int] = None,
    limit: Optional[int] = None,
) -> List[Any]:
    results: List[Any] = []
    seen_post_ids = set()

    for event_query in event_queries:
        query_results = search_facebook(event_query, search_type)

        if search_type == "posts":
            posts = [
                result for result in query_results
                if isinstance(result, dict)
            ]
            posts = filter_posts_by_days(posts, days)

            for post in posts:
                post_id = post.get("post_id") or post.get("post_url")
                if post_id in seen_post_ids:
                    continue
                seen_post_ids.add(post_id)
                results.append(post)
                if limit is not None and len(results) >= limit:
                    return results
        else:
            results.extend(query_results)
            if limit is not None and len(results) >= limit:
                return results[:limit]

    return results


def write_links(path: Path, links: List[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.writer(file)
        writer.writerow(["url"])
        for link in links:
            writer.writerow([link])


def write_posts(path: Path, posts: List[Dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as file:
        fieldnames = [
            "post_id",
            "creation_time",
            "created_at",
            "age_days",
            "source_name",
            "source_url",
            "post_url",
            "matched_event_query",
            "text",
        ]
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(posts)


def run_once(args: argparse.Namespace, event_queries: List[str]) -> int:
    try:
        results = search_event_queries(event_queries, args.type, days=args.days, limit=args.limit)
    except FacebookScraperError as exc:
        output = args.output or (
            "data/search_posts.csv" if args.type == "posts" else "data/search_results.csv"
        )
        phase = "discovery" if args.discover else "search"
        if args.type == "posts":
            write_posts(Path(output), [])
            print(f"[WARN] Facebook {phase} did not return posts: {exc}")
            print("Found posts: 0")
        else:
            write_links(Path(output), [])
            print(f"[WARN] Facebook {phase} did not return links: {exc}")
            print("Found links: 0")
        return 0

    output = args.output or (
        "data/search_posts.csv" if args.type == "posts" else "data/search_results.csv"
    )

    if args.type == "posts":
        posts = [result for result in results if isinstance(result, dict)]
        write_posts(Path(output), posts)
        print(f"Found posts: {len(posts)}")
        for post in posts[:10]:
            safe_print(f"{post['source_name']} | {post['post_url']}")
            safe_print(post["text"][:300].replace("\n", " "))

        if args.push:
            try:
                pushed_count = push_posts_to_mattermost(
                    posts,
                    seen_file=Path(args.seen_file),
                    dry_run=args.dry_run,
                )
            except FacebookScraperError as exc:
                print(f"[ERROR] {exc}")
                return 1
            print(f"Mattermost pushed posts: {pushed_count}")
    elif args.push:
        print("[ERROR] --push only works with --type posts.")
        return 1
    else:
        links = [str(result) for result in results]
        write_links(Path(output), links)
        print(f"Found links: {len(links)}")
        for link in links[:20]:
            print(link)

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Search Facebook and extract results.")
    parser.add_argument("event_query", nargs="?", default="", help="Candidate event text to search.")
    parser.add_argument(
        "--type",
        choices=sorted(SEARCH_TYPES),
        default="all",
        help="Facebook search result type.",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=None,
        help="Only keep posts created within the last N days. Only works with --type posts.",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="CSV file for extracted results.",
    )
    parser.add_argument(
        "--discover",
        action="store_true",
        help="Use the logged-in home feed as an autonomous one-shot discovery source.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum records to write.",
    )
    parser.add_argument(
        "--push",
        action="store_true",
        help="Push matched posts to Mattermost. Only works with --type posts.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be pushed without sending Mattermost messages.",
    )
    parser.add_argument(
        "--seen-file",
        default="data/mattermost_seen_posts.json",
        help="JSON file used to avoid pushing the same post twice.",
    )
    parser.add_argument(
        "--watch",
        action="store_true",
        help="Keep searching in a loop.",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=300,
        help="Seconds between search rounds when --watch is enabled.",
    )
    args = parser.parse_args()

    event_queries = [""] if args.discover else list(dict.fromkeys([args.event_query] if args.event_query else []))
    if not event_queries:
        print("[ERROR] Provide candidate event text.")
        return 2

    print(f"Event queries: {', '.join(event_queries)}")
    if args.days is not None:
        print(f"Date filter: last {args.days} days")

    if not args.watch:
        return run_once(args, event_queries)

    while True:
        started_at = datetime.now(BEIJING_TZ).strftime("%Y-%m-%d %H:%M:%S")
        print(f"Watch round started at {started_at} Beijing time")
        run_once(args, event_queries)
        print(f"Sleeping {args.interval} seconds")
        time.sleep(args.interval)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
