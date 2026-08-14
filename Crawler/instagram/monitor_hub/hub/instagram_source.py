from __future__ import annotations

import os
import re
import shutil
import sys
from pathlib import Path
from typing import Iterable
from urllib.parse import quote

from .events import MonitorEvent


class InstagramSource:
    def __init__(self, project_root: Path, login: str, request_timeout: float = 20.0):
        if str(project_root) not in sys.path:
            sys.path.insert(0, str(project_root))
        import instaloader

        self.instaloader = instaloader
        self.loader = instaloader.Instaloader(
            download_pictures=False,
            download_videos=False,
            download_video_thumbnails=False,
            save_metadata=False,
            request_timeout=request_timeout,
            max_connection_attempts=1,
        )
        self.login = login
        cookie_header = os.environ.get("INSTAGRAM_COOKIE", "").strip()
        self.cookie_header = cookie_header
        self.request_timeout = request_timeout
        if cookie_header:
            self._load_cookie_header(cookie_header)
        else:
            self.loader.load_session_from_file(login)

    def fetch_hashtag(self, hashtag: str, limit: int) -> Iterable[MonitorEvent]:
        normalized = hashtag.strip().lstrip("#")
        if not normalized:
            return []
        try:
            return self._fetch_hashtag_with_instaloader(normalized, limit)
        except Exception as exc:
            print(
                f"Instagram #{normalized}: Instaloader failed, falling back to browser: {exc}",
                file=sys.stderr,
                flush=True,
            )
            return self._fetch_hashtag_with_browser(normalized, limit)

    def _fetch_hashtag_with_instaloader(self, hashtag: str, limit: int) -> list[MonitorEvent]:
        hashtag_obj = self.instaloader.Hashtag.from_name(self.loader.context, hashtag)
        events = []
        for index, post in enumerate(hashtag_obj.get_posts_resumable()):
            if index >= limit:
                break
            shortcode = post.shortcode
            author = post.owner_username
            events.append(
                MonitorEvent(
                    platform="Instagram",
                    target=f"#{normalized}",
                    post_id=shortcode,
                    url=f"https://www.instagram.com/p/{shortcode}/",
                    author=author,
                    author_url=f"https://www.instagram.com/{author}/",
                    text=post.caption or "",
                    created_at=post.date_utc.isoformat(),
                    likes=post.likes,
                    comments=post.comments,
                )
            )
        return events

    def _fetch_hashtag_with_browser(self, hashtag: str, limit: int) -> list[MonitorEvent]:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            raise RuntimeError("Playwright is required for Instagram browser fallback.") from exc

        target_url = f"https://www.instagram.com/explore/tags/{quote(hashtag)}/"
        shortcodes: list[str] = []
        with sync_playwright() as playwright:
            launch_options = self._browser_launch_options()
            browser = playwright.chromium.launch(**launch_options)
            context = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
                ),
                locale="en-US",
                viewport={"width": 1280, "height": 900},
            )
            if self.cookie_header:
                context.add_cookies(self._cookies_for_playwright(self.cookie_header))
            page = context.new_page()
            page.goto(target_url, wait_until="domcontentloaded", timeout=int(self.request_timeout * 1000))
            page.wait_for_timeout(5000)
            for _ in range(4):
                self._collect_shortcodes(page.content(), shortcodes, limit)
                if len(shortcodes) >= limit:
                    break
                page.mouse.wheel(0, 1400)
                page.wait_for_timeout(2000)
            self._collect_shortcodes(page.content(), shortcodes, limit)
            browser.close()

        return [
            MonitorEvent(
                platform="Instagram",
                target=f"#{hashtag}",
                post_id=shortcode,
                url=f"https://www.instagram.com/p/{shortcode}/",
            )
            for shortcode in shortcodes[:limit]
        ]

    def _collect_shortcodes(self, html: str, shortcodes: list[str], limit: int) -> None:
        for match in re.finditer(r"/p/([A-Za-z0-9_-]+)/", html):
            shortcode = match.group(1)
            if shortcode not in shortcodes:
                shortcodes.append(shortcode)
            if len(shortcodes) >= limit:
                return

    def _browser_launch_options(self) -> dict:
        channel = os.environ.get("INSTAGRAM_BROWSER_CHANNEL", "msedge")
        executable = self._browser_executable_path(channel)
        options = {"headless": True}
        if executable:
            options["executable_path"] = executable
        else:
            options["channel"] = channel
        return options

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

    def _cookies_for_playwright(self, cookie_header: str) -> list[dict]:
        cookies = []
        for name, value in self._parse_cookie_header(cookie_header).items():
            cookies.append(
                {
                    "name": name,
                    "value": value,
                    "domain": ".instagram.com",
                    "path": "/",
                    "secure": True,
                    "httpOnly": False,
                    "sameSite": "Lax",
                }
            )
        return cookies

    def _load_cookie_header(self, cookie_header: str) -> None:
        cookie_dict = self._parse_cookie_header(cookie_header)
        if not cookie_dict:
            raise ValueError("INSTAGRAM_COOKIE is set but no cookies could be parsed.")
        self.loader.context.update_cookies(cookie_dict)
        username = self.loader.test_login()
        if username:
            self.loader.context.username = username

    def _parse_cookie_header(self, cookie_header: str) -> dict[str, str]:
        if cookie_header.lower().startswith("cookie:"):
            cookie_header = cookie_header.split(":", 1)[1].strip()
        cookies: dict[str, str] = {}
        for part in cookie_header.split(";"):
            if "=" not in part:
                continue
            name, value = part.split("=", 1)
            name = name.strip()
            value = value.strip()
            if name:
                cookies[name] = value
        return cookies
