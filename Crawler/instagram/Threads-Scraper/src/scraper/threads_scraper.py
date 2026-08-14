from __future__ import annotations

import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import requests

from .utils.error_handler import retry
from .utils.logger import get_logger
from .utils.proxy_manager import ProxyManager

logger = get_logger(__name__)


class ThreadsScraper:
    """Fetch raw Threads-like post dictionaries for the parser/export pipeline."""

    def __init__(self, settings: Dict[str, Any], config_dir: Path, data_dir: Path):
        self.settings = settings
        self.config_dir = Path(config_dir)
        self.data_dir = Path(data_dir)
        self.base_url = str(settings.get("base_url", "https://www.threads.net")).rstrip("/")
        self.timeout = int(settings.get("timeout", 15))
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/125.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            }
        )

        cookie = os.getenv("THREADS_COOKIE") or str(settings.get("cookie", "")).strip()
        if cookie:
            self.session.headers["Cookie"] = cookie

        proxies_path = self.data_dir / "raw" / "proxies.json"
        self.proxy_manager = ProxyManager(proxies_path) if settings.get("use_proxies") else None

    def fetch_user_threads(self, username: str, limit: int = 50) -> List[Dict[str, Any]]:
        username = username.strip().lstrip("@")
        if not username:
            return []
        if self.settings.get("use_offline", False):
            return self._offline_items(username, limit)
        return self._online_items(username, limit)

    def _offline_items(self, username: str, limit: int) -> List[Dict[str, Any]]:
        sample_path = self.data_dir / "raw" / f"{username}.json"
        if sample_path.exists():
            with open(sample_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            items = data.get("items", data) if isinstance(data, dict) else data
            if isinstance(items, list):
                return items[:limit]

        now = datetime.now(timezone.utc).isoformat()
        return [
            {
                "id": f"{username}-sample-1",
                "username": username,
                "text": (
                    f"Offline sample thread for @{username}. "
                    f"Add data/raw/{username}.json or run --online for live data."
                ),
                "like_count": 0,
                "reply_count": 0,
                "repost_count": 0,
                "created_at": now,
                "url": f"{self.base_url}/@{username}",
            }
        ][:limit]

    @retry((requests.RequestException,), tries=3, delay=1.0, backoff=2.0)
    def _get(self, url: str) -> requests.Response:
        proxies = self.proxy_manager.get_proxy() if self.proxy_manager else None
        response = self.session.get(url, timeout=self.timeout, proxies=proxies)
        response.raise_for_status()
        return response

    def _online_items(self, username: str, limit: int) -> List[Dict[str, Any]]:
        url = f"{self.base_url}/@{username}"
        response = self._get(url)
        html = response.text
        self._save_raw(username, html)
        items = self._extract_items_from_html(html, username=username, limit=limit)
        if not items and self.settings.get("use_browser", True):
            html = self._render_with_browser(url, username=username)
            if html:
                self._save_raw(username, html)
                items = self._extract_items_from_html(html, username=username, limit=limit)
                if not items:
                    items = self._extract_items_from_rendered_text(html, username=username, limit=limit)
        if not items:
            logger.warning(
                "No posts found for @%s. Threads may require login or changed its page data format.",
                username,
            )
        return items

    def _save_raw(self, username: str, html: str) -> None:
        raw_dir = self.data_dir / "raw"
        raw_dir.mkdir(parents=True, exist_ok=True)
        with open(raw_dir / f"{username}.html", "w", encoding="utf-8") as f:
            f.write(html)

    def _render_with_browser(self, url: str, username: str) -> str:
        try:
            from playwright.sync_api import Error as PlaywrightError
            from playwright.sync_api import sync_playwright
        except ImportError:
            logger.warning("Playwright is not installed; skipping browser rendering.")
            return ""

        channel = str(self.settings.get("browser_channel", "msedge")).strip() or "msedge"
        executable_path = self._browser_executable_path(channel)
        try:
            with sync_playwright() as playwright:
                launch_options: Dict[str, Any] = {"headless": True}
                if executable_path:
                    launch_options["executable_path"] = executable_path
                else:
                    launch_options["channel"] = channel
                browser = playwright.chromium.launch(**launch_options)
                context = browser.new_context(
                    user_agent=self.session.headers["User-Agent"],
                    locale="en-US",
                    viewport={"width": 1280, "height": 900},
                )
                cookie_header = self.session.headers.get("Cookie")
                if cookie_header:
                    context.add_cookies(self._cookies_from_header(cookie_header))
                page = context.new_page()
                page.goto(url, wait_until="domcontentloaded", timeout=self.timeout * 1000)
                page.wait_for_timeout(5000)
                for _ in range(3):
                    page.mouse.wheel(0, 1200)
                    page.wait_for_timeout(1500)
                html = page.content()
                text = page.locator("body").inner_text(timeout=5000)
                browser.close()
                return f"{html}\n<!-- rendered_text_start\n{text}\nrendered_text_end -->"
        except PlaywrightError as exc:
            logger.warning("Browser rendering failed for @%s: %s", username, exc)
            return ""

    def _browser_executable_path(self, channel: str) -> str:
        candidates = []
        if channel == "msedge":
            candidates.extend(
                [
                    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                ]
            )
        if channel in {"chrome", "chromium"}:
            candidates.extend(
                [
                    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                ]
            )
        for name in (channel, "msedge", "chrome", "chromium"):
            found = shutil.which(name)
            if found:
                candidates.append(found)
        for candidate in candidates:
            if candidate and Path(candidate).exists():
                return candidate
        return ""

    def _cookies_from_header(self, cookie_header: str) -> List[Dict[str, Any]]:
        cookies = []
        domain = self.base_url.replace("https://", "").replace("http://", "").split("/", 1)[0]
        for part in cookie_header.split(";"):
            if "=" not in part:
                continue
            name, value = part.split("=", 1)
            cookies.append(
                {
                    "name": name.strip(),
                    "value": value.strip(),
                    "domain": domain,
                    "path": "/",
                    "secure": self.base_url.startswith("https://"),
                }
            )
        return cookies

    def _extract_items_from_html(self, html: str, username: str, limit: int) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        seen_keys: set[str] = set()
        seen_texts: set[str] = set()
        for data in self._json_blobs(html):
            for post in self._walk_posts(data):
                item = self._normalize_embedded_post(post, username)
                if not item:
                    continue
                key = str(item.get("id") or item.get("url") or item.get("text"))
                text_key = str(item.get("text") or "").strip()
                if key in seen_keys or text_key in seen_texts:
                    continue
                seen_keys.add(key)
                seen_texts.add(text_key)
                items.append(item)
                if len(items) >= limit:
                    return items
        return items

    def _extract_items_from_rendered_text(self, html: str, username: str, limit: int) -> List[Dict[str, Any]]:
        match = re.search(r"rendered_text_start\n(.*?)\nrendered_text_end", html, re.S)
        if not match:
            return []
        lines = [line.strip() for line in match.group(1).splitlines() if line.strip()]
        ignored = {
            "threads",
            "log in",
            "sign up",
            "like",
            "reply",
            "repost",
            "share",
            "follow",
            "more",
        }
        items = []
        seen = set()
        for line in lines:
            normalized = line.lower()
            if normalized in ignored or normalized.startswith("@"):
                continue
            if len(line) < 20 or line in seen:
                continue
            seen.add(line)
            items.append(
                {
                    "id": f"{username}-rendered-{len(items) + 1}",
                    "username": username,
                    "text": line,
                    "like_count": 0,
                    "reply_count": 0,
                    "repost_count": 0,
                    "created_at": "",
                    "url": f"{self.base_url}/@{username}",
                }
            )
            if len(items) >= limit:
                break
        return items

    def _json_blobs(self, html: str) -> Iterable[Any]:
        script_patterns = [
            r'<script[^>]+type=["\']application/json["\'][^>]*>(.*?)</script>',
            r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',
        ]
        for pattern in script_patterns:
            for match in re.finditer(pattern, html, re.S):
                text = self._html_unescape(match.group(1)).strip()
                if not text:
                    continue
                try:
                    yield json.loads(text)
                except json.JSONDecodeError:
                    continue

    def _walk_posts(self, value: Any) -> Iterable[Dict[str, Any]]:
        if isinstance(value, dict):
            if self._looks_like_post(value):
                yield value
            for child in value.values():
                yield from self._walk_posts(child)
        elif isinstance(value, list):
            for child in value:
                yield from self._walk_posts(child)

    def _looks_like_post(self, value: Dict[str, Any]) -> bool:
        text = self._extract_text(value)
        has_metrics = any(k in value for k in ("like_count", "reply_count", "repost_count", "text_post_app_info"))
        has_id = any(k in value for k in ("id", "pk", "code"))
        return bool(text and (has_id or has_metrics))

    def _normalize_embedded_post(self, post: Dict[str, Any], username: str) -> Optional[Dict[str, Any]]:
        text = self._extract_text(post)
        if not text:
            return None

        code = str(post.get("code") or post.get("id") or post.get("pk") or "")
        user = post.get("user") if isinstance(post.get("user"), dict) else {}
        post_username = user.get("username") or username
        return {
            "id": code or f"{post_username}-{abs(hash(text))}",
            "username": post_username,
            "text": text,
            "like_count": self._extract_count(post, "like_count"),
            "reply_count": self._extract_count(post, "reply_count"),
            "repost_count": self._extract_count(post, "repost_count"),
            "created_at": post.get("taken_at") or post.get("timestamp") or post.get("created_at") or "",
            "url": f"{self.base_url}/@{post_username}/post/{code}" if code else f"{self.base_url}/@{post_username}",
        }

    def _extract_text(self, value: Dict[str, Any]) -> str:
        candidates = [value.get("text"), value.get("caption"), value.get("accessibility_caption")]
        caption = value.get("caption")
        if isinstance(caption, dict):
            candidates.append(caption.get("text"))
        text_post_app_info = value.get("text_post_app_info")
        if isinstance(text_post_app_info, dict):
            share_info = text_post_app_info.get("share_info")
            if isinstance(share_info, dict):
                candidates.append(share_info.get("quoted_post_caption"))
        for candidate in candidates:
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        return ""

    def _extract_count(self, value: Dict[str, Any], key: str) -> int:
        raw = value.get(key)
        if raw is None and key == "reply_count":
            raw = value.get("comment_count")
        try:
            return int(raw or 0)
        except (TypeError, ValueError):
            return 0

    def _html_unescape(self, text: str) -> str:
        return (
            text.replace("&quot;", '"')
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&#x27;", "'")
        )
