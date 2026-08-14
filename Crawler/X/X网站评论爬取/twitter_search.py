# -*- coding: utf-8 -*-
"""X 平台自主发现与事件复核爬虫。

这个模块只负责和 X 页面交互：
- discover_hot_tweets: 不依赖静态词表，自主发现热门/高互动推文。
- search_event_evidence: 接收总控下发的候选事件，复核 X 上是否也有证据。
- attach_comments: 针对已发现推文继续抓取评论。
"""

from __future__ import annotations

import random
import re
import contextlib
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Any

from playwright.async_api import async_playwright

import config


EXCLUDED_LINK_PREFIXES = {
    "i",
    "search",
    "explore",
    "home",
    "settings",
    "hashtag",
    "notifications",
    "messages",
}

LOW_VALUE_DISCOVERY_TERMS = {
    "nsfw",
    "porn",
    "sex",
    "onlyfans",
    "勃起",
    "约炮",
    "成人视频",
    "成人",
    "裸聊",
}


def parse_cookie_string(cookie_str: str) -> list[dict[str, str]]:
    """把浏览器复制的 cookie 字符串转成 Playwright cookie 列表。"""
    cookies: list[dict[str, str]] = []
    for item in cookie_str.split(";"):
        item = item.strip()
        if "=" not in item:
            continue
        name, value = item.split("=", 1)
        name = name.strip()
        if not name:
            continue
        cookies.append(
            {
                "name": name,
                "value": value.strip(),
                "domain": ".x.com",
                "path": "/",
            }
        )
    return cookies


def parse_metric_number(raw: str) -> int:
    value = raw.strip().replace(",", "")
    multiplier = 1
    suffix = value[-1:].lower()
    if suffix == "k":
        multiplier = 1_000
        value = value[:-1]
    elif suffix == "m":
        multiplier = 1_000_000
        value = value[:-1]
    elif suffix == "b":
        multiplier = 1_000_000_000
        value = value[:-1]
    elif value.endswith("万"):
        multiplier = 10_000
        value = value[:-1]
    elif value.endswith(("亿", "億")):
        multiplier = 100_000_000
        value = value[:-1]
    try:
        return int(float(value) * multiplier)
    except ValueError:
        return 0


def parse_metric_label(label: str) -> dict[str, int]:
    text = label.replace("\u00a0", " ")
    metric_aliases = {
        "reply_count": ["reply", "replies", "回复", "回覆"],
        "repost_count": ["repost", "reposts", "retweet", "retweets", "转帖", "轉帖", "转发", "轉發"],
        "like_count": ["like", "likes", "喜欢", "喜歡", "赞", "讚"],
        "view_count": ["view", "views", "查看", "瀏覽", "浏览", "观看"],
        "bookmark_count": ["bookmark", "bookmarks", "书签", "書籤"],
    }
    metrics = {
        "reply_count": 0,
        "repost_count": 0,
        "like_count": 0,
        "view_count": 0,
        "bookmark_count": 0,
    }
    for metric, aliases in metric_aliases.items():
        for alias in aliases:
            pattern = rf"([0-9][0-9,]*(?:\.[0-9]+)?\s*(?:[KMBkmb]|万|亿|億)?)\s*{re.escape(alias)}"
            match = re.search(pattern, text, flags=re.IGNORECASE)
            if match:
                metrics[metric] = parse_metric_number(match.group(1))
                break
    return metrics


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def tweet_id_from_url(url: str) -> str:
    match = re.search(r"/status/(\d+)", url)
    return match.group(1) if match else ""


def rank_tweet(tweet: dict[str, Any]) -> int:
    metrics = tweet.get("metrics") if isinstance(tweet.get("metrics"), dict) else {}
    return (
        int(metrics.get("reply_count") or 0) * 8
        + int(metrics.get("repost_count") or 0) * 6
        + int(metrics.get("like_count") or 0) * 2
        + int(metrics.get("view_count") or 0) // 500
    )


def is_recent_tweet(tweet: dict[str, Any]) -> bool:
    if config.SEARCH_DAYS <= 0:
        return True
    published_at = str(tweet.get("published_at") or tweet.get("tweet_time") or "")
    if not published_at:
        return True
    try:
        parsed = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
    except ValueError:
        return True
    return parsed >= datetime.now(timezone.utc) - timedelta(days=config.SEARCH_DAYS + 1)


def is_low_value_discovery(tweet: dict[str, Any]) -> bool:
    if tweet.get("source_type") == "event_search":
        return False
    text = f"{tweet.get('title', '')} {tweet.get('content', '')} {tweet.get('author', '')}".lower()
    return any(term.lower() in text for term in LOW_VALUE_DISCOVERY_TERMS)


class TwitterSearcher:
    """X 自主发现/复核爬虫。"""

    def __init__(self, headless: bool = True):
        self.pw = None
        self.browser = None
        self.context = None
        self.page = None
        self.headless = headless

    async def _ensure_browser(self) -> None:
        if self.page:
            return
        await self._init_browser()

    async def _init_browser(self) -> None:
        cookies = parse_cookie_string(config.TWITTER_COOKIES)
        if not cookies:
            raise ValueError("缺少 X Cookie，请在 Crawler_env/X_env 配置 TWITTER_COOKIES 或 X_COOKIE")

        self.pw = await async_playwright().start()
        proxy = {"server": config.PROXY} if config.PROXY else None
        if proxy:
            print("[X] 已启用代理")

        self.browser = await self.pw.chromium.launch(headless=self.headless, proxy=proxy)
        self.context = await self.browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 900},
            locale="zh-CN",
            ignore_https_errors=True,
        )
        await self.context.add_cookies(cookies)
        self.page = await self.context.new_page()

        print(f"[X] 已注入 {len(cookies)} 个 cookie，正在验证登录状态")
        await self._goto_x_page("https://x.com/home", settle_ms=3_000)
        body_text, tweet_count = await self._read_page_state(max_wait_ms=18_000)
        login_wall = any(
            text in body_text
            for text in ["Happening now", "Email or username", "Continue with Google", "登录"]
        )
        logged_in_shell = any(
            text in body_text
            for text in ["Home", "Explore", "Notifications", "Bookmarks", "Profile", "Post", "主页"]
        )
        if "login" in self.page.url or "flow" in self.page.url or login_wall:
            raise ConnectionError("X Cookie 登录态不可用，请在 Crawler_env/X_env 更新 Cookie")
        if not body_text.strip() and tweet_count == 0:
            raise ConnectionError("X 页面为空白，可能是代理或 Cloudflare 前端脚本未完成加载")
        if tweet_count == 0 and logged_in_shell:
            print("[X] 登录壳已加载，但首页暂未出现推文，将使用搜索/Explore 继续采集")
        print("[X] 登录状态有效")

    async def _goto_x_page(self, url: str, settle_ms: int = 3_000, timeout: int = 20_000) -> None:
        if not self.page:
            raise RuntimeError("X 页面尚未初始化")
        await self.page.goto(url, wait_until="commit", timeout=timeout)
        await self.page.wait_for_timeout(settle_ms)

    async def _read_page_state(self, max_wait_ms: int = 18_000) -> tuple[str, int]:
        if not self.page:
            raise RuntimeError("X 页面尚未初始化")
        deadline = datetime.now().timestamp() + max_wait_ms / 1000
        last_body = ""
        last_tweet_count = 0
        while datetime.now().timestamp() < deadline:
            with contextlib.suppress(Exception):
                last_body = await self.page.locator("body").inner_text(timeout=2_000)
            with contextlib.suppress(Exception):
                last_tweet_count = await self.page.locator('article[data-testid="tweet"]').count()
            logged_in_shell = any(
                text in last_body
                for text in ["Home", "Explore", "Notifications", "Bookmarks", "Profile", "Post", "主页"]
            )
            login_wall = any(
                text in last_body
                for text in ["Happening now", "Email or username", "Continue with Google", "登录"]
            )
            if last_tweet_count > 0 or logged_in_shell or login_wall:
                return last_body, last_tweet_count
            await self.page.wait_for_timeout(1_000)
        return last_body, last_tweet_count

    async def discover_hot_tweets(self, limit: int | None = None) -> list[dict[str, Any]]:
        """自主发现当前热门/高互动推文，不读取静态词表。"""
        await self._ensure_browser()
        target = limit or config.MAX_DISCOVER_RESULTS
        strategies = {
            item.strip().lower()
            for item in config.DISCOVERY_STRATEGY.split(",")
            if item.strip()
        }
        collected: list[dict[str, Any]] = []

        if "trending" in strategies:
            try:
                trend_names = await self._discover_trend_names(max(6, target * 2))
                print(f"[X] Explore 发现 {len(trend_names)} 个趋势")
                for trend in trend_names[: max(3, target)]:
                    tweets = await self.search_query(
                        trend,
                        limit=max(1, min(3, target)),
                        sort="top",
                        source_type="trend",
                    )
                    for tweet in tweets:
                        tweet["discovery_source"] = f"trend:{trend}"
                    collected.extend(tweets)
                    if len(self._dedupe_and_rank(collected)) >= target:
                        break
                    await self.page.wait_for_timeout(int(random.uniform(*config.TWITTER_SEARCH_DELAY) * 1000))
            except Exception as exc:
                print(f"[X] Explore 发现入口跳过: {exc}")

        if len(self._dedupe_and_rank(collected)) < target and "home" in strategies:
            try:
                home_tweets = await self._discover_from_home(target * 2)
                collected.extend(home_tweets)
            except Exception as exc:
                print(f"[X] Home 发现入口跳过: {exc}")

        if len(self._dedupe_and_rank(collected)) < target:
            # 兜底使用 X 高互动搜索过滤器，不来自任何用户维护的词表。
            hot_query = "min_replies:50 -filter:replies"
            try:
                fallback_tweets = await self.search_query(
                    hot_query,
                    limit=target,
                    sort="top",
                    source_type="hot_filter",
                    add_since=True,
                )
                for tweet in fallback_tweets:
                    tweet["discovery_source"] = "hot_filter:min_replies"
                collected.extend(fallback_tweets)
            except Exception as exc:
                print(f"[X] 高互动兜底入口跳过: {exc}")

        return self._dedupe_and_rank(collected)[:target]

    async def search_event_evidence(
        self,
        event_query: str,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        """按总控下发的候选事件复核 X 是否存在同一事件证据。"""
        event_query = event_query.strip()
        if not event_query:
            return []
        return await self.search_query(
            event_query,
            limit=limit or config.MAX_SEARCH_RESULTS,
            sort="top",
            source_type="event_search",
        )

    async def search_query(
        self,
        query_text: str,
        limit: int,
        sort: str = "top",
        source_type: str = "event_search",
        add_since: bool = True,
    ) -> list[dict[str, Any]]:
        """搜索一段事件描述或 X 动态趋势文本。"""
        await self._ensure_browser()
        query = query_text.strip()
        if not query:
            return []
        if add_since and config.SEARCH_DAYS > 0:
            since_date = (datetime.now() - timedelta(days=config.SEARCH_DAYS)).strftime("%Y-%m-%d")
            query = f"{query} since:{since_date}"

        f_value = "live" if sort == "live" else "top"
        encoded = urllib.parse.quote(query)
        url = f"https://x.com/search?q={encoded}&src=typed_query&f={f_value}"
        print(f"[X] 搜索事件/趋势: {query_text}")
        await self._goto_x_page(url, settle_ms=3_000)

        try:
            await self.page.locator('article[data-testid="tweet"]').first.wait_for(timeout=15_000)
        except Exception:
            await self.page.wait_for_timeout(4_000)

        if "login" in self.page.url or "flow" in self.page.url:
            raise ConnectionError("X Cookie 已失效，请更新 Cookie")

        tweets = await self._scroll_and_collect(
            source_label=query_text,
            source_type=source_type,
            max_count=max(1, limit),
        )
        tweets.sort(key=rank_tweet, reverse=True)
        return tweets[:limit]

    async def attach_comments(
        self,
        tweets: list[dict[str, Any]],
        comments_per_tweet: int | None = None,
    ) -> list[dict[str, Any]]:
        """抓取推文评论，并把评论合并回对应推文。"""
        per_tweet = config.MAX_COMMENTS_PER_TWEET if comments_per_tweet is None else comments_per_tweet
        if per_tweet <= 0 or not tweets:
            return tweets

        from comment_scraper import CommentScraper

        for tweet in tweets:
            tweet["comments"] = []
            tweet["comment_count"] = 0

        scraper = CommentScraper(self.page)
        original_limit = config.MAX_COMMENTS_PER_TWEET
        config.MAX_COMMENTS_PER_TWEET = per_tweet
        try:
            comments = await scraper.scrape_all(tweets)
        finally:
            config.MAX_COMMENTS_PER_TWEET = original_limit

        by_link: dict[str, list[dict[str, Any]]] = {}
        for comment in comments:
            link = comment.get("tweet_link") or ""
            if not link:
                continue
            by_link.setdefault(link, []).append(
                {
                    "type": "tweet_comment",
                    "author": comment.get("handle") or "",
                    "name": comment.get("name") or "",
                    "content": comment.get("comment_text") or "",
                    "published_at": comment.get("comment_time") or "",
                    "location": comment.get("location") or "",
                    "bio": comment.get("bio") or "",
                }
            )

        for tweet in tweets:
            tweet_comments = by_link.get(tweet.get("tweet_link") or "", [])
            tweet["comments"] = tweet_comments
            tweet["comment_count"] = len(tweet_comments)
            metrics = tweet.setdefault("metrics", {})
            if isinstance(metrics, dict):
                metrics["comment_count"] = len(tweet_comments)
        return tweets

    async def _discover_trend_names(self, limit: int) -> list[str]:
        await self._goto_x_page("https://x.com/explore/tabs/trending", settle_ms=4_000)
        trend_names: list[str] = []
        seen: set[str] = set()

        blocks = self.page.locator('[data-testid="trend"]')
        count = await blocks.count()
        for index in range(count):
            text = await blocks.nth(index).inner_text()
            trend = self._best_trend_line(text)
            if trend and trend.lower() not in seen:
                seen.add(trend.lower())
                trend_names.append(trend)
            if len(trend_names) >= limit:
                return trend_names

        # X 页面 DOM 改动时的兜底：从可见文本里提取像趋势名的短行。
        page_text = await self.page.locator("body").inner_text()
        for raw_line in page_text.splitlines():
            trend = self._best_trend_line(raw_line)
            if trend and trend.lower() not in seen:
                seen.add(trend.lower())
                trend_names.append(trend)
            if len(trend_names) >= limit:
                break
        return trend_names

    def _best_trend_line(self, text: str) -> str:
        banned = {
            "trending",
            "for you",
            "following",
            "follow",
            "home",
            "posts",
            "post",
            "explore",
            "notifications",
            "messages",
            "bookmarks",
            "premium",
            "profile",
            "more",
            "grok",
            "chat",
            "show more",
            "promoted",
            "what's happening?",
            "whats happening?",
            "view keyboard shortcuts",
            "趋势",
            "正在流行",
            "帖子",
            "显示更多",
        }
        for line in [clean_text(item) for item in text.splitlines()]:
            if not line or len(line) > 80:
                continue
            lower = line.lower()
            if lower in banned:
                continue
            if "keyboard shortcuts" in lower or "press question mark" in lower:
                continue
            if lower.startswith("to view keyboard shortcuts"):
                continue
            if re.fullmatch(r"[0-9,.\s]+[kmbKMB万亿億]?\s*(posts?|帖子)?", line):
                continue
            if "promoted" in lower or "推广" in line:
                continue
            return line
        return ""

    async def _discover_from_home(self, limit: int) -> list[dict[str, Any]]:
        await self._goto_x_page("https://x.com/home", settle_ms=4_000)
        tweets = await self._scroll_and_collect(
            source_label="home",
            source_type="home_timeline",
            max_count=limit,
        )
        for tweet in tweets:
            tweet["discovery_source"] = "home"
        tweets.sort(key=rank_tweet, reverse=True)
        return tweets

    async def _scroll_and_collect(
        self,
        source_label: str,
        source_type: str,
        max_count: int,
    ) -> list[dict[str, Any]]:
        all_tweets: list[dict[str, Any]] = []
        seen: set[str] = set()
        stale_rounds = 0
        max_scrolls = min(80, max(8, (max_count // 4) + 8))

        for _ in range(max_scrolls):
            page_tweets = await self._parse_tweets(source_label, source_type)
            new_count = 0
            for tweet in page_tweets:
                dedup_key = tweet.get("tweet_url") or f"{tweet.get('author')}:{tweet.get('content', '')[:60]}"
                if dedup_key in seen:
                    continue
                seen.add(dedup_key)
                all_tweets.append(tweet)
                new_count += 1

            if len(all_tweets) >= max_count:
                break
            if new_count == 0:
                stale_rounds += 1
                if stale_rounds >= 2:
                    break
            else:
                stale_rounds = 0

            await self.page.evaluate("window.scrollBy(0, 1200)")
            await self.page.wait_for_timeout(1_800)

        return all_tweets[:max_count]

    async def _parse_tweets(self, source_label: str, source_type: str) -> list[dict[str, Any]]:
        articles = self.page.locator('article[data-testid="tweet"]')
        count = await articles.count()
        tweets: list[dict[str, Any]] = []

        for index in range(count):
            try:
                article = articles.nth(index)
                handle = await self._extract_handle(article)
                if not handle:
                    continue
                name = await self._extract_display_name(article, handle)
                content = await self._extract_tweet_text(article)
                tweet_time = await self._extract_tweet_time(article)
                tweet_url = await self._extract_tweet_url(article)
                metrics = await self._extract_metrics(article)
                tweet_id = tweet_id_from_url(tweet_url)

                if not tweet_url or not content:
                    continue

                tweets.append(
                    {
                        "type": "tweet",
                        "platform": "x",
                        "source_type": source_type,
                        "discovery_source": source_label,
                        "event_query": source_label if source_type == "event_search" else "",
                        "title": clean_text(content[:140]),
                        "content": content,
                        "tweet_text": content,
                        "url": tweet_url,
                        "tweet_url": tweet_url,
                        "tweet_link": tweet_url,
                        "tweet_id": tweet_id,
                        "author": f"@{handle}",
                        "handle": f"@{handle}",
                        "name": name,
                        "published_at": tweet_time,
                        "tweet_time": tweet_time,
                        "metrics": metrics,
                        "reply_count": metrics.get("reply_count", 0),
                        "repost_count": metrics.get("repost_count", 0),
                        "like_count": metrics.get("like_count", 0),
                        "view_count": metrics.get("view_count", 0),
                    }
                )
            except Exception:
                continue

        return tweets

    async def _extract_handle(self, article) -> str:
        links = article.locator('a[href^="/"]')
        link_count = await links.count()
        for index in range(min(link_count, 16)):
            href = await links.nth(index).get_attribute("href") or ""
            parts = href.strip("/").split("/")
            if parts and parts[0] and parts[0] not in EXCLUDED_LINK_PREFIXES:
                if len(parts) >= 3 and parts[1] == "status":
                    return parts[0]
                if len(parts) == 1:
                    return parts[0]
        return ""

    async def _extract_display_name(self, article, handle: str) -> str:
        try:
            user_link = article.locator(f'a[href="/{handle}"]').first
            spans = user_link.locator("span")
            if await spans.count() > 0:
                return clean_text(await spans.first.inner_text()) or handle
        except Exception:
            pass
        return handle

    async def _extract_tweet_text(self, article) -> str:
        try:
            text_el = article.locator('div[data-testid="tweetText"]')
            if await text_el.count() > 0:
                return clean_text(await text_el.first.inner_text())
        except Exception:
            pass
        return ""

    async def _extract_tweet_time(self, article) -> str:
        try:
            time_el = article.locator("time")
            if await time_el.count() > 0:
                return await time_el.first.get_attribute("datetime") or ""
        except Exception:
            pass
        return ""

    async def _extract_tweet_url(self, article) -> str:
        try:
            time_link = article.locator("a:has(time)")
            if await time_link.count() > 0:
                href = await time_link.first.get_attribute("href") or ""
                if href.startswith("/"):
                    return f"https://x.com{href}"
                if href.startswith("http"):
                    return href
        except Exception:
            pass
        return ""

    async def _extract_metrics(self, article) -> dict[str, int]:
        metrics = {
            "reply_count": 0,
            "repost_count": 0,
            "like_count": 0,
            "view_count": 0,
            "bookmark_count": 0,
        }
        try:
            groups = article.locator('[role="group"]')
            group_count = await groups.count()
            for index in range(group_count):
                label = await groups.nth(index).get_attribute("aria-label") or ""
                parsed = parse_metric_label(label)
                for key, value in parsed.items():
                    if value > metrics.get(key, 0):
                        metrics[key] = value
        except Exception:
            pass
        return metrics

    def _dedupe_and_rank(self, tweets: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: set[str] = set()
        unique: list[dict[str, Any]] = []
        for tweet in tweets:
            if is_low_value_discovery(tweet) or not is_recent_tweet(tweet):
                continue
            key = tweet.get("tweet_url") or f"{tweet.get('author')}:{tweet.get('content', '')[:80]}"
            if not key or key in seen:
                continue
            seen.add(key)
            unique.append(tweet)
        unique.sort(key=rank_tweet, reverse=True)
        return unique

    async def close(self) -> None:
        if self.context:
            await self.context.close()
        if self.browser:
            await self.browser.close()
        if self.pw:
            await self.pw.stop()
