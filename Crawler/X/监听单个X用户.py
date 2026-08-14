import argparse
import asyncio
import json
import os
import random
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from playwright.async_api import BrowserContext, Page, async_playwright


STATUS_RE = re.compile(r"/status/(\d+)")


@dataclass
class Post:
    post_id: str
    url: str
    text: str
    posted_at: str
    account: str
    captured_at: str


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_account(raw: str) -> str:
    s = (raw or "").strip()
    if s.startswith("@"):
        s = s[1:]
    if not re.fullmatch(r"[A-Za-z0-9_]{1,15}", s):
        raise ValueError("account 格式不正确，示例: @elonmusk 或 elonmusk")
    return s


def parse_cookie_input(raw: str) -> list[dict[str, Any]]:
    value = (raw or "").strip()
    if not value:
        return []

    # Supports JSON array from storage tools.
    if value.startswith("["):
        loaded = json.loads(value)
        if not isinstance(loaded, list):
            raise ValueError("cookies JSON 必须是数组")
        cookies: list[dict[str, Any]] = []
        for item in loaded:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name", "")).strip()
            cookie_value = str(item.get("value", "")).strip()
            if not name:
                continue
            cookies.append(
                {
                    "name": name,
                    "value": cookie_value,
                    "domain": item.get("domain") or ".x.com",
                    "path": item.get("path") or "/",
                }
            )
        return cookies

    # Supports "name=value; name2=value2"
    cookies = []
    for part in value.split(";"):
        p = part.strip()
        if not p or "=" not in p:
            continue
        name, cookie_value = p.split("=", 1)
        name = name.strip()
        cookie_value = cookie_value.strip()
        if not name:
            continue
        cookies.append(
            {
                "name": name,
                "value": cookie_value,
                "domain": ".x.com",
                "path": "/",
            }
        )
    return cookies


def load_seen_ids(path: Path) -> list[str]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        ids = data.get("seen_ids", [])
        if isinstance(ids, list):
            return [str(x) for x in ids if str(x).strip()]
    except Exception:
        return []
    return []


def save_seen_ids(path: Path, seen_ids: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "saved_at": _now_iso(),
        "seen_ids": seen_ids,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def append_events(path: Path, posts: list[Post]) -> None:
    if not posts:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        for post in posts:
            f.write(json.dumps(asdict(post), ensure_ascii=False) + "\n")


class XRealtimeListener:
    def __init__(
        self,
        account: str,
        cookies: list[dict[str, Any]],
        proxy: str,
        headful: bool,
        timeout_ms: int,
    ) -> None:
        self.account = account
        self.cookies = cookies
        self.proxy = proxy
        self.headful = headful
        self.timeout_ms = timeout_ms
        self.page: Page | None = None
        self.context: BrowserContext | None = None
        self._playwright = None
        self._browser = None

    async def start(self) -> None:
        self._playwright = await async_playwright().start()
        launch_kwargs = {"headless": (not self.headful)}
        if self.proxy:
            launch_kwargs["proxy"] = {"server": self.proxy}
        self._browser = await self._playwright.chromium.launch(**launch_kwargs)
        self.context = await self._browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1366, "height": 900},
        )
        if self.cookies:
            await self.context.add_cookies(self.cookies)
        self.page = await self.context.new_page()
        await self.goto_profile()

    async def goto_profile(self) -> None:
        if not self.page:
            raise RuntimeError("page 未初始化")
        await self.page.goto(
            f"https://x.com/{self.account}",
            wait_until="commit",
            timeout=self.timeout_ms,
        )
        await self.page.wait_for_timeout(2500)

    async def reload_profile(self) -> None:
        if not self.page:
            raise RuntimeError("page 未初始化")
        await self.page.reload(wait_until="commit", timeout=self.timeout_ms)
        await self.page.wait_for_timeout(1800)

    async def fetch_recent_posts(self, max_items: int) -> list[Post]:
        if not self.page:
            raise RuntimeError("page 未初始化")

        posts: list[Post] = []
        articles = self.page.locator('article[data-testid="tweet"]')
        total = await articles.count()
        total = min(total, max_items)

        for idx in range(total):
            article = articles.nth(idx)
            status_links = article.locator('a[href*="/status/"]')
            if await status_links.count() == 0:
                continue

            href = (await status_links.first.get_attribute("href")) or ""
            if not href:
                continue
            if href.startswith("/"):
                url = "https://x.com" + href
            else:
                url = href

            m = STATUS_RE.search(url)
            if not m:
                continue
            post_id = m.group(1)

            posted_at = ""
            time_el = article.locator("time")
            if await time_el.count() > 0:
                posted_at = (await time_el.first.get_attribute("datetime")) or ""

            text = ""
            text_el = article.locator('div[data-testid="tweetText"]')
            if await text_el.count() > 0:
                text = (await text_el.first.inner_text()) or ""
                text = text.strip()

            posts.append(
                Post(
                    post_id=post_id,
                    url=url,
                    text=text,
                    posted_at=posted_at,
                    account=self.account,
                    captured_at=_now_iso(),
                )
            )
        return posts

    async def close(self) -> None:
        if self.context:
            await self.context.close()
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()


async def run(args: argparse.Namespace) -> None:
    account = normalize_account(args.account)
    cookies = parse_cookie_input(args.cookies)
    state_file = Path(args.state_file).resolve()
    output_file = Path(args.output_file).resolve() if args.output_file else None

    print(f"[XListener] target=@{account}")
    print(f"[XListener] interval={args.interval}s jitter={args.jitter}s")
    print(f"[XListener] state_file={state_file}")
    if output_file:
        print(f"[XListener] output_file={output_file}")
    print(f"[XListener] cookies_loaded={len(cookies)}")
    if not cookies:
        print("[XListener] 警告: 未提供 cookies，可能会跳到登录页导致抓取失败")

    listener = XRealtimeListener(
        account=account,
        cookies=cookies,
        proxy=args.proxy,
        headful=args.headful,
        timeout_ms=args.timeout_ms,
    )

    loaded_seen = load_seen_ids(state_file)
    seen_ids = list(dict.fromkeys(loaded_seen))
    seen_set = set(seen_ids)
    if seen_ids:
        print(f"[XListener] loaded_seen_ids={len(seen_ids)}")

    try:
        await listener.start()
        baseline = await listener.fetch_recent_posts(args.max_items)
        if baseline:
            baseline_ids = [p.post_id for p in baseline]
            if seen_set:
                new_in_baseline = [x for x in baseline_ids if x not in seen_set]
                seen_ids.extend(new_in_baseline)
                seen_set.update(new_in_baseline)
            else:
                seen_ids.extend(baseline_ids)
                seen_set.update(baseline_ids)
            seen_ids = seen_ids[-args.max_seen :]
            seen_set = set(seen_ids)
        save_seen_ids(state_file, seen_ids)
        print(f"[XListener] baseline_posts={len(baseline)}")
        print("[XListener] start monitoring, Ctrl+C stop")

        while True:
            sleep_s = args.interval + random.uniform(0, args.jitter)
            await asyncio.sleep(max(1.0, sleep_s))

            try:
                await listener.reload_profile()
                latest = await listener.fetch_recent_posts(args.max_items)
            except Exception as e:
                print(f"[XListener] refresh failed: {e}")
                continue

            new_posts = [p for p in latest if p.post_id not in seen_set]
            if not new_posts:
                print(f"[XListener] {datetime.now().strftime('%H:%M:%S')} no new post")
                continue

            # page order is newest->oldest; reverse for chronological output
            new_posts.reverse()
            print(f"[XListener] found {len(new_posts)} new post(s)")
            for post in new_posts:
                print(f"\n=== NEW POST @{post.account} ===")
                print(f"id: {post.post_id}")
                print(f"time: {post.posted_at or 'unknown'}")
                print(f"url: {post.url}")
                print(f"text: {post.text}\n")
                seen_ids.append(post.post_id)
                seen_set.add(post.post_id)

            seen_ids = seen_ids[-args.max_seen :]
            seen_set = set(seen_ids)
            save_seen_ids(state_file, seen_ids)
            if output_file:
                append_events(output_file, new_posts)
    except KeyboardInterrupt:
        print("\n[XListener] stopped by user")
    finally:
        await listener.close()
        save_seen_ids(state_file, seen_ids[-args.max_seen :])


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="实时监听指定 X 账号新帖（独立脚本，不依赖项目业务代码）"
    )
    parser.add_argument("--account", required=True, help="X 账号（支持 @name 或 name）")
    parser.add_argument(
        "--cookies",
        default=os.getenv("XWATCH_TWITTER_COOKIES", ""),
        help="Cookie 字符串（name=value; ...）或 JSON 数组；默认读取 XWATCH_TWITTER_COOKIES",
    )
    parser.add_argument(
        "--proxy",
        default=os.getenv("XWATCH_PROXY", ""),
        help="代理地址，例如 http://127.0.0.1:7897",
    )
    parser.add_argument("--interval", type=float, default=30.0, help="轮询基础间隔（秒）")
    parser.add_argument("--jitter", type=float, default=10.0, help="随机抖动（秒）")
    parser.add_argument(
        "--max-items",
        type=int,
        default=20,
        help="每轮最多解析最新 N 条帖子",
    )
    parser.add_argument(
        "--max-seen",
        type=int,
        default=2000,
        help="内存与状态文件最多保留的已见帖子 ID 数",
    )
    parser.add_argument(
        "--state-file",
        default="./var/x_listener_state.json",
        help="去重状态文件路径",
    )
    parser.add_argument(
        "--output-file",
        default="./var/x_listener_events.jsonl",
        help="新帖事件输出 JSONL 路径；留空表示不落盘",
    )
    parser.add_argument("--headful", action="store_true", help="启用可见浏览器")
    parser.add_argument(
        "--timeout-ms",
        type=int,
        default=30000,
        help="页面加载超时（毫秒）",
    )
    return parser


if __name__ == "__main__":
    parser = build_parser()
    args = parser.parse_args()
    asyncio.run(run(args))
