from __future__ import annotations

import argparse
import json
import re
import time
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable
from urllib.parse import quote, urljoin

import requests
from bs4 import BeautifulSoup
from urllib3.exceptions import InsecureRequestWarning


BASE_URL = "https://www.ptt.cc"
DEFAULT_BOARDS = ["Gossiping", "HatePolitics", "Military", "CrossStrait"]
DEFAULT_OUTPUT = Path("output/ptt_latest_articles.json")
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)


@dataclass
class SearchHit:
    board: str
    title: str
    href: str
    author: str | None = None
    list_date: str | None = None
    push_number: str | None = None
    matched_event_filters: set[str] = field(default_factory=set)

    @property
    def url(self) -> str:
        return urljoin(BASE_URL, self.href)

    @property
    def timestamp(self) -> int:
        match = re.search(r"/M\.(\d+)\.A\.", self.href)
        return int(match.group(1)) if match else 0


def parse_csv_arg(value: str | None, default: list[str]) -> list[str]:
    if not value:
        return default
    return [item.strip() for item in value.split(",") if item.strip()]


def build_session(insecure: bool, no_proxy: bool) -> requests.Session:
    if insecure:
        warnings.simplefilter("ignore", InsecureRequestWarning)

    session = requests.Session()
    if no_proxy:
        session.trust_env = False
    session.headers.update({"User-Agent": USER_AGENT})
    session.cookies.set("over18", "1", domain="www.ptt.cc")
    session.verify = not insecure
    return session


def request_soup(session: requests.Session, url: str, timeout: int, retries: int = 2) -> BeautifulSoup:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            response = session.get(url, timeout=timeout)
            response.raise_for_status()
            return BeautifulSoup(response.text, "html.parser")
        except Exception as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(0.8 * (attempt + 1))
    raise last_error


def parse_search_hits(soup: BeautifulSoup, board: str, event_filter: str) -> list[SearchHit]:
    hits: list[SearchHit] = []
    for row in soup.select("div.r-ent"):
        title_anchor = row.select_one("div.title a")
        if title_anchor is None:
            continue

        href = title_anchor.get("href")
        if not href:
            continue

        hit = SearchHit(
            board=board,
            title=title_anchor.get_text(strip=True),
            href=href,
            author=text_or_none(row.select_one("div.author")),
            list_date=text_or_none(row.select_one("div.date")),
            push_number=text_or_none(row.select_one("div.nrec")),
        )
        hit.matched_event_filters.add(event_filter)
        hits.append(hit)
    return hits


def parse_board_hits(soup: BeautifulSoup, board: str) -> list[SearchHit]:
    hits: list[SearchHit] = []
    for row in soup.select("div.r-ent"):
        title_anchor = row.select_one("div.title a")
        if title_anchor is None:
            continue

        href = title_anchor.get("href")
        if not href:
            continue

        hits.append(
            SearchHit(
                board=board,
                title=title_anchor.get_text(strip=True),
                href=href,
                author=text_or_none(row.select_one("div.author")),
                list_date=text_or_none(row.select_one("div.date")),
                push_number=text_or_none(row.select_one("div.nrec")),
            )
        )
    return hits


def text_or_none(node) -> str | None:
    if node is None:
        return None
    text = node.get_text(strip=True)
    return text if text else None


def find_older_search_page(soup: BeautifulSoup) -> str | None:
    for anchor in soup.select("a.btn.wide"):
        text = anchor.get_text(strip=True)
        href = anchor.get("href")
        if "上頁" in text and href:
            return urljoin(BASE_URL, href)
    return None


def find_older_board_page(soup: BeautifulSoup) -> str | None:
    for anchor in soup.select("a.btn.wide"):
        text = anchor.get_text(strip=True)
        href = anchor.get("href")
        if href and ("上頁" in text or "‹" in text):
            return urljoin(BASE_URL, href)
    return None


def collect_latest_hits(
    session: requests.Session,
    boards: Iterable[str],
    max_pages: int,
    delay: float,
    timeout: int,
) -> dict[str, SearchHit]:
    hits: dict[str, SearchHit] = {}

    for board in boards:
        url = f"{BASE_URL}/bbs/{board}/index.html"
        for _ in range(max_pages):
            try:
                soup = request_soup(session, url, timeout)
            except Exception as exc:
                print(f"skip latest {board}: {exc}")
                break
            for hit in parse_board_hits(soup, board):
                hits.setdefault(hit.href, hit)

            older_url = find_older_board_page(soup)
            if older_url is None or older_url == url:
                break
            url = older_url
            if delay:
                time.sleep(delay)

    return hits


def collect_search_hits(
    session: requests.Session,
    boards: Iterable[str],
    event_filters: Iterable[str],
    max_pages_per_query: int,
    delay: float,
    timeout: int,
) -> dict[str, SearchHit]:
    hits: dict[str, SearchHit] = {}

    for board in boards:
        for event_filter in event_filters:
            url = f"{BASE_URL}/bbs/{board}/search?q={quote(event_filter)}"
            for _ in range(max_pages_per_query):
                try:
                    soup = request_soup(session, url, timeout)
                except Exception as exc:
                    print(f"skip search {board} {event_filter}: {exc}")
                    break
                for hit in parse_search_hits(soup, board, event_filter):
                    existing = hits.get(hit.href)
                    if existing is None:
                        hits[hit.href] = hit
                    else:
                        existing.matched_event_filters.update(hit.matched_event_filters)

                older_url = find_older_search_page(soup)
                if older_url is None or older_url == url:
                    break
                url = older_url
                if delay:
                    time.sleep(delay)

    return hits


def parse_article(session: requests.Session, hit: SearchHit, timeout: int) -> dict:
    soup = request_soup(session, hit.url, timeout)
    main = soup.select_one("#main-content")
    if main is None:
        raise ValueError(f"article content not found: {hit.url}")

    meta_values = [node.get_text(strip=True) for node in main.select("span.article-meta-value")]
    author = meta_values[0] if len(meta_values) > 0 else hit.author
    title = meta_values[2] if len(meta_values) > 2 else hit.title
    date = meta_values[3] if len(meta_values) > 3 else hit.list_date

    comments = []
    for push in main.select("div.push"):
        comments.append(
            {
                "type": clean_push_text(push.select_one("span.push-tag")),
                "author": clean_push_text(push.select_one("span.push-userid")),
                "content": clean_push_content(push.select_one("span.push-content")),
                "time": clean_push_text(push.select_one("span.push-ipdatetime")),
            }
        )

    full_text = main.get_text("\n", strip=False)
    content_node = BeautifulSoup(str(main), "html.parser")
    for selector in ["div.article-metaline", "div.article-metaline-right", "div.push"]:
        for node in content_node.select(selector):
            node.decompose()

    content_text = content_node.get_text("\n", strip=True)
    content = content_text.split("※ 發信站", 1)[0].strip()
    ip = parse_ip(full_text)

    matched_event_queries = sorted(
        {
            event_filter
            for event_filter in hit.matched_event_filters
            if event_filter in title or event_filter in content or event_filter in full_text
        }
    )
    if not matched_event_queries:
        matched_event_queries = sorted(hit.matched_event_filters)

    return {
        "board": hit.board,
        "title": title,
        "url": hit.url,
        "author": author,
        "date": date,
        "content": content,
        "comments": comments,
        "ip": ip,
        "push_number": hit.push_number,
        "list_date": hit.list_date,
        "timestamp": hit.timestamp,
        "matched_event_queries": matched_event_queries,
    }


def clean_push_text(node) -> str | None:
    text = text_or_none(node)
    return text.strip() if text else None


def clean_push_content(node) -> str | None:
    text = text_or_none(node)
    if text and text.startswith(":"):
        text = text[1:].strip()
    return text


def parse_ip(text: str) -> str | None:
    match = re.search(r"來自:\s*([\d.]+)", text)
    if match:
        return match.group(1)
    match = re.search(r"From:\s*([\d.]+)", text)
    if match:
        return match.group(1)
    return None


def crawl(args: argparse.Namespace) -> list[dict]:
    session = build_session(args.insecure, args.no_proxy)
    boards = parse_csv_arg(args.boards, DEFAULT_BOARDS)
    event_filters = parse_csv_arg(args.event_filters, [])

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

    sorted_hits = sorted(hits.values(), key=lambda item: item.timestamp, reverse=True)
    results = []

    for hit in sorted_hits:
        try:
            article = parse_article(session, hit, args.timeout)
        except Exception as exc:
            print(f"skip {hit.url}: {exc}")
            continue

        haystack = f"{article['title']}\n{article['content']}"
        if event_filters and not any(event_filter in haystack for event_filter in event_filters):
            continue

        results.append(article)
        if len(results) >= args.limit:
            break

        if args.delay:
            time.sleep(args.delay)

    return results


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Crawl latest PTT articles or review a candidate event over HTTPS.")
    parser.add_argument("--boards", help="Comma-separated board names.")
    parser.add_argument("--event-filter", dest="event_filters", metavar="EVENT_FILTER", help="Comma-separated candidate event expressions for cross-platform review.")
    parser.add_argument("--limit", type=int, default=100, help="Maximum article count.")
    parser.add_argument(
        "--max-pages-per-query",
        type=int,
        default=8,
        help="Search result pages per board and event filter; in latest mode, latest board pages to scan.",
    )
    parser.add_argument("--delay", type=float, default=0.2, help="Delay between requests in seconds.")
    parser.add_argument("--timeout", type=int, default=20, help="HTTP timeout in seconds.")
    parser.add_argument("--insecure", action="store_true", help="Disable TLS certificate verification.")
    parser.add_argument("--no-proxy", action="store_true", help="Ignore proxy settings from the environment.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Output JSON path.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    results = crawl(args)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"saved {len(results)} articles to {args.output}")


if __name__ == "__main__":
    main()
