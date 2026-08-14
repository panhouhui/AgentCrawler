# -*- coding: utf-8 -*-
"""
评论爬取模块 - 爬取每条帖子下的评论（回复）

原理：复用已有的浏览器会话，逐个访问帖子链接，
     滚动加载评论，解析DOM提取评论人信息，
     再访问评论人主页获取简介和位置。

输出：单独的CSV文件，每行一条评论
"""

import os
import csv
import random
from datetime import datetime

import config


# CSV的列定义
COMMENT_COLUMNS = [
    ("帖子链接", "tweet_link"),       # 原帖链接
    ("帖子内容", "tweet_text"),       # 原帖内容
    ("发帖时间", "tweet_time"),       # 原帖时间
    ("评论人账号", "handle"),          # 评论人 @xxx
    ("评论人昵称", "name"),            # 评论人昵称
    ("评论时间", "comment_time"),     # 评论发布时间
    ("评论内容", "comment_text"),     # 评论正文
    ("评论人主页位置", "location"),    # 评论人主页位置
    ("评论人简介", "bio"),             # 评论人简介
]


class CommentScraper:
    """
    评论爬取器

    接收已有的 Playwright page 实例（复用浏览器会话），
    逐个访问帖子链接，解析评论区回复。
    """

    def __init__(self, page):
        """
        参数:
            page: Playwright page 实例（来自 TwitterSearcher）
        """
        self.page = page

    async def scrape_all(self, tweets: list[dict]) -> list[dict]:
        """
        爬取所有帖子的评论

        参数:
            tweets: 搜索结果列表，每条须含 tweet_link、tweet_text、tweet_time

        返回:
            所有评论的列表
        """
        all_comments = []
        # 过滤出有链接的帖子
        tweets_with_link = [t for t in tweets if t.get('tweet_link')]
        print(f"\n[评论] 共 {len(tweets_with_link)} 条帖子需要爬取评论")

        for idx, tweet in enumerate(tweets_with_link, 1):
            print(f"\n[评论] ({idx}/{len(tweets_with_link)}) {tweet['tweet_link']}")
            comments = await self._scrape_one_tweet(tweet)
            all_comments.extend(comments)
            print(f"  ✓ 获取 {len(comments)} 条评论")

        print(f"\n[评论] 总计采集 {len(all_comments)} 条评论")
        return all_comments

    async def _scrape_one_tweet(self, tweet: dict) -> list[dict]:
        """
        爬取单条帖子下的评论

        流程：
        1. 访问帖子页面，等待原帖加载
        2. 滚动收集评论，直到达到最大数量或连续3轮无新数据
        3. 逐个访问评论人主页获取简介和位置

        返回: 评论列表
        """
        try:
            await self.page.goto(tweet['tweet_link'], wait_until="commit", timeout=20000)
        except Exception as e:
            print(f"  ⚠ 访问帖子失败: {e}")
            return []

        # 检查是否被跳转到登录页
        if "login" in self.page.url or "flow" in self.page.url:
            print("  ⚠ cookie已失效")
            return []

        # 等待原帖加载
        try:
            await self.page.locator('article[data-testid="tweet"]').first.wait_for(timeout=10000)
        except Exception:
            print("  ⚠ 帖子加载超时")
            return []

        delay = random.uniform(*getattr(config, 'COMMENT_PAGE_LOAD_DELAY', (2, 4)))
        await self.page.wait_for_timeout(int(delay * 1000))

        # 滚动收集评论
        max_comments = getattr(config, 'MAX_COMMENTS_PER_TWEET', 20)
        comments_data = await self._scroll_and_parse_comments(tweet, max_comments)

        # 获取评论人主页信息（按handle去重）
        visited = {}
        for comment in comments_data:
            handle = comment['handle'].lstrip('@')
            if handle not in visited:
                visited[handle] = await self._get_user_profile(handle)
                profile_delay = random.uniform(*getattr(config, 'COMMENT_PROFILE_DELAY', (1, 2)))
                await self.page.wait_for_timeout(int(profile_delay * 1000))
            comment['location'] = visited[handle]['location']
            comment['bio'] = visited[handle]['bio']

        return comments_data

    async def _scroll_and_parse_comments(self, tweet: dict, max_comments: int) -> list[dict]:
        """
        滚动页面并解析评论

        帖子详情页的所有 article 中，第一个是原帖本身，后面的都是评论/回复。
        持续滚动直到：达到 max_comments 或 连续3轮无新数据。
        """
        all_comments = []
        seen_keys = set()
        stale_rounds = 0

        # 先获取原帖的handle，用于后续排除
        original_handle = ''
        try:
            first_article = self.page.locator('article[data-testid="tweet"]').first
            links = first_article.locator('a[href^="/"]')
            link_count = await links.count()
            for j in range(min(link_count, 10)):
                href = await links.nth(j).get_attribute("href") or ""
                parts = href.strip("/").split("/")
                if parts and parts[0] and parts[0] not in ["i", "search", "explore", "home", "settings", "hashtag"]:
                    original_handle = parts[0]
                    break
        except Exception:
            pass

        round_num = 0
        while True:
            round_num += 1
            articles = self.page.locator('article[data-testid="tweet"]')
            count = await articles.count()

            new_count = 0
            # 遍历所有article，跳过原帖（通过内容判断而非固定索引）
            for i in range(count):
                try:
                    article = articles.nth(i)

                    # 检查这个article内是否有链接匹配当前帖子URL
                    # 帖子详情页结构：可能有对话线程，原帖不一定在index 0
                    # 用更安全的方式：检查time元素的父a标签href是否匹配原帖
                    is_original = False
                    try:
                        time_link = article.locator('a:has(time)')
                        if await time_link.count() > 0:
                            href = await time_link.first.get_attribute("href") or ""
                            # 如果这个article的链接就是原帖链接，则跳过
                            if tweet['tweet_link'].endswith(href):
                                is_original = True
                    except Exception:
                        pass

                    if is_original:
                        continue

                    comment = await self._parse_one_comment(article, tweet)
                    if comment:
                        dedup_key = f"{comment['handle']}_{comment.get('_text_preview', '')}"
                        if dedup_key not in seen_keys:
                            seen_keys.add(dedup_key)
                            all_comments.append(comment)
                            new_count += 1
                            print(f"    💬 {comment['name']} ({comment['handle']})")
                except Exception:
                    continue

            # 达到目标数量，截取后停止
            if len(all_comments) >= max_comments:
                all_comments = all_comments[:max_comments]
                print(f"  已达到最大评论数 {max_comments}")
                break

            # 连续3轮无新数据，认为到底了
            if new_count == 0:
                stale_rounds += 1
                max_stale = getattr(config, 'COMMENT_STALE_ROUNDS', 3)
                if stale_rounds >= max_stale:
                    break
            else:
                stale_rounds = 0

            # 滚动加载更多评论
            await self.page.evaluate("window.scrollBy(0, 1000)")
            scroll_delay = random.uniform(*getattr(config, 'COMMENT_SCROLL_DELAY', (1.5, 3)))
            await self.page.wait_for_timeout(int(scroll_delay * 1000))

        return all_comments

    async def _parse_one_comment(self, article, tweet: dict) -> dict | None:
        """
        解析单条评论的DOM，提取评论人信息

        返回: 评论数据字典，解析失败返回 None
        """
        # ---- 提取评论人handle ----
        handle = ''
        links = article.locator('a[href^="/"]')
        link_count = await links.count()
        for j in range(min(link_count, 10)):
            href = await links.nth(j).get_attribute("href") or ""
            parts = href.strip("/").split("/")
            if parts and parts[0] and parts[0] not in ["i", "search", "explore", "home", "settings", "hashtag"]:
                handle = parts[0]
                break

        if not handle:
            return None

        # ---- 提取评论人昵称 ----
        name = handle
        try:
            user_link = article.locator(f'a[href="/{handle}"]').first
            spans = user_link.locator("span")
            if await spans.count() > 0:
                name = await spans.first.inner_text()
        except Exception:
            pass

        # ---- 提取评论时间 ----
        comment_time = ''
        try:
            time_el = article.locator('time')
            if await time_el.count() > 0:
                comment_time = await time_el.first.get_attribute("datetime") or ""
        except Exception:
            pass

        # ---- 提取评论内容 ----
        comment_text = ''
        try:
            text_el = article.locator('div[data-testid="tweetText"]')
            if await text_el.count() > 0:
                comment_text = await text_el.first.inner_text()
        except Exception:
            pass

        return {
            'tweet_link': tweet.get('tweet_link', ''),
            'tweet_text': tweet.get('tweet_text', ''),
            'tweet_time': tweet.get('tweet_time', ''),
            'handle': f"@{handle}",
            'name': name if name != handle else handle,
            'comment_time': comment_time,
            'comment_text': comment_text,
            'location': '',   # 后续从主页获取
            'bio': '',        # 后续从主页获取
            '_text_preview': comment_text[:30],  # 仅用于去重
        }

    async def _get_user_profile(self, handle: str) -> dict:
        """访问用户主页，获取简介和位置"""
        try:
            await self.page.goto(f"https://x.com/{handle}", wait_until="commit", timeout=15000)
            await self.page.wait_for_timeout(2000)

            bio = ''
            location = ''

            try:
                bio_el = self.page.locator('div[data-testid="UserDescription"]')
                if await bio_el.count() > 0:
                    bio = await bio_el.first.inner_text()
            except Exception:
                pass

            try:
                loc_el = self.page.locator('span[data-testid="UserLocation"]')
                if await loc_el.count() > 0:
                    location = await loc_el.first.inner_text()
            except Exception:
                pass

            return {'bio': bio, 'location': location}
        except Exception:
            return {'bio': '', 'location': ''}


class CommentRecorder:
    """评论数据导出器 - 保存为独立的CSV文件"""

    def __init__(self):
        os.makedirs(config.OUTPUT_DIR, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.csv_path = os.path.join(config.OUTPUT_DIR, f"comments_{timestamp}.csv")
        self._header_written = False

    def save(self, data: list[dict]) -> str:
        """追加写入评论CSV"""
        if not self._header_written:
            with open(self.csv_path, "w", newline="", encoding="utf-8-sig") as f:
                writer = csv.writer(f)
                writer.writerow([h for h, _ in COMMENT_COLUMNS])
            self._header_written = True

        with open(self.csv_path, "a", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            for row in data:
                writer.writerow([row.get(k, "") for _, k in COMMENT_COLUMNS])

        print(f"  ✓ 评论CSV已保存: {self.csv_path} (本次写入 {len(data)} 条)")
        return self.csv_path
