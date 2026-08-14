# -*- coding: utf-8 -*-
"""X API fallback for AgentHub.

The primary X crawler uses Playwright so it can read rendered timelines and
comments. X sometimes serves HTML while the client scripts fail to render in
headless Chromium. This module keeps the agent useful in that case by querying
the same authenticated GraphQL search endpoint used by the X web client.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any

import requests

import config


REQUEST_TIMEOUT = 30
WEB_HOSTS = ("https://x.com", "https://twitter.com")
GRAPHQL_HOSTS = ("https://x.com", "https://api.x.com", "https://api.twitter.com", "https://twitter.com")
WEB_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)


def _cookie_dict(cookie_text: str) -> dict[str, str]:
    cookies: dict[str, str] = {}
    for item in cookie_text.split(";"):
        if "=" not in item:
            continue
        name, value = item.strip().split("=", 1)
        if name:
            cookies[name] = value
    return cookies


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _safe_int(value: Any) -> int:
    if value is None:
        return 0
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _extract_string_list(raw: str) -> list[str]:
    return [match.group(1) for match in re.finditer(r'"([^"]+)"', raw)]


def _extract_operation(main_js: str, operation_name: str) -> tuple[str, dict[str, bool], dict[str, bool]]:
    pattern = (
        rf'queryId:"([^"]+)",operationName:"{re.escape(operation_name)}",'
        r'operationType:"query",metadata:\{featureSwitches:\[(.*?)\],fieldToggles:\[(.*?)\]\}'
    )
    match = re.search(pattern, main_js)
    if not match:
        raise RuntimeError(f"未能从 X 前端脚本提取 {operation_name} GraphQL 元数据")
    query_id, feature_text, field_text = match.groups()
    features = {item: True for item in _extract_string_list(feature_text)}
    field_toggles = {item: True for item in _extract_string_list(field_text)}
    return query_id, features, field_toggles


def _request_with_retries(session: requests.Session, method: str, url: str, **kwargs) -> requests.Response:
    last_exc: Exception | None = None
    for _ in range(3):
        try:
            response = session.request(method, url, timeout=kwargs.pop("timeout", REQUEST_TIMEOUT), **kwargs)
            response.raise_for_status()
            return response
        except Exception as exc:
            last_exc = exc
    if last_exc:
        raise last_exc
    raise RuntimeError(f"请求失败：{url}")


def _iter_dicts(value: Any):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _iter_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from _iter_dicts(child)


def _tweet_result_from_container(container: dict[str, Any]) -> dict[str, Any] | None:
    tweet_results = container.get("tweet_results")
    if not isinstance(tweet_results, dict):
        return None
    result = tweet_results.get("result")
    if not isinstance(result, dict):
        return None
    if result.get("__typename") == "TweetWithVisibilityResults":
        nested = result.get("tweet")
        if isinstance(nested, dict):
            return nested
    if result.get("__typename") == "TweetTombstone":
        return None
    if isinstance(result.get("tweet"), dict):
        return result["tweet"]
    return result


def _full_text(tweet: dict[str, Any]) -> str:
    note = tweet.get("note_tweet")
    if isinstance(note, dict):
        note_result = note.get("note_tweet_results")
        if isinstance(note_result, dict):
            result = note_result.get("result")
            if isinstance(result, dict):
                text = result.get("text")
                if isinstance(text, str) and text.strip():
                    return _clean_text(text)
    legacy = tweet.get("legacy")
    if isinstance(legacy, dict):
        for key in ("full_text", "text"):
            text = legacy.get(key)
            if isinstance(text, str) and text.strip():
                return _clean_text(text)
    return ""


def _iso_time(raw: str) -> str:
    if not raw:
        return ""
    try:
        return parsedate_to_datetime(raw).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError, OSError):
        return raw


def _user_from_tweet(tweet: dict[str, Any]) -> dict[str, str]:
    core = tweet.get("core")
    if not isinstance(core, dict):
        return {"screen_name": "", "name": ""}
    user_results = core.get("user_results")
    if not isinstance(user_results, dict):
        return {"screen_name": "", "name": ""}
    result = user_results.get("result")
    if not isinstance(result, dict):
        return {"screen_name": "", "name": ""}
    user_core = result.get("core")
    if not isinstance(user_core, dict):
        return {"screen_name": "", "name": ""}
    return {
        "screen_name": str(user_core.get("screen_name") or ""),
        "name": str(user_core.get("name") or ""),
    }


def _tweet_to_record(tweet: dict[str, Any], source_label: str, source_type: str) -> dict[str, Any] | None:
    tweet_id = str(tweet.get("rest_id") or "")
    legacy = tweet.get("legacy")
    if not tweet_id or not isinstance(legacy, dict):
        return None
    user = _user_from_tweet(tweet)
    screen_name = user["screen_name"]
    content = _full_text(tweet)
    if not screen_name or not content:
        return None

    url = f"https://x.com/{screen_name}/status/{tweet_id}"
    views = tweet.get("views")
    metrics = {
        "reply_count": _safe_int(legacy.get("reply_count")),
        "repost_count": _safe_int(legacy.get("retweet_count")) + _safe_int(legacy.get("quote_count")),
        "like_count": _safe_int(legacy.get("favorite_count")),
        "view_count": _safe_int(views.get("count") if isinstance(views, dict) else 0),
        "bookmark_count": _safe_int(legacy.get("bookmark_count")),
    }
    published_at = _iso_time(str(legacy.get("created_at") or ""))
    return {
        "type": "tweet",
        "platform": "x",
        "source_type": source_type,
        "discovery_source": source_label,
        "event_query": source_label if source_type == "event_search" else "",
        "title": content[:140],
        "content": content,
        "tweet_text": content,
        "url": url,
        "tweet_url": url,
        "tweet_link": url,
        "tweet_id": tweet_id,
        "author": f"@{screen_name}",
        "handle": f"@{screen_name}",
        "name": user["name"] or screen_name,
        "published_at": published_at,
        "tweet_time": published_at,
        "metrics": metrics,
        "reply_count": metrics["reply_count"],
        "repost_count": metrics["repost_count"],
        "like_count": metrics["like_count"],
        "view_count": metrics["view_count"],
        "comments": [],
        "comment_count": 0,
        "collector": "x_graphql_fallback",
    }


class XApiFallbackCrawler:
    def __init__(self) -> None:
        if not config.TWITTER_COOKIES:
            raise ValueError("缺少 X Cookie，请在 Crawler_env/X_env 配置 TWITTER_COOKIES 或 X_COOKIE")
        self.cookies = _cookie_dict(config.TWITTER_COOKIES)
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": WEB_USER_AGENT,
                "Cookie": config.TWITTER_COOKIES,
                "Accept": "*/*",
            }
        )
        if config.PROXY:
            self.session.proxies.update({"http": config.PROXY, "https": config.PROXY})
        self._bearer = ""
        self._search_meta: tuple[str, dict[str, bool], dict[str, bool]] | None = None
        self._tweet_detail_meta: tuple[str, dict[str, bool], dict[str, bool]] | None = None

    def _load_web_metadata(self) -> None:
        if self._search_meta and self._bearer:
            return
        response = None
        last_error: Exception | None = None
        for host in WEB_HOSTS:
            try:
                response = _request_with_retries(self.session, "GET", f"{host}/home")
                break
            except Exception as exc:
                last_error = exc
        if response is None:
            raise RuntimeError(f"无法读取 X Web 元数据：{last_error}")

        script_urls: list[str] = []
        for match in re.finditer(r'<script[^>]+src="([^"]+)"', response.text):
            url = match.group(1)
            if url.startswith("//"):
                url = f"https:{url}"
            elif url.startswith("/"):
                url = f"https://x.com{url}"
            script_urls.append(url)

        main_js = ""
        for url in script_urls:
            if "main." not in url:
                continue
            script_response = _request_with_retries(self.session, "GET", url)
            main_js = script_response.text
            break
        if not main_js:
            raise RuntimeError("未能下载 X 前端 main 脚本")

        bearer_match = re.search(r"Bearer\s+([A-Za-z0-9%._\-]+)", main_js)
        if not bearer_match:
            raise RuntimeError("未能从 X 前端脚本提取 Bearer Token")
        self._bearer = bearer_match.group(1)
        self._search_meta = _extract_operation(main_js, "SearchTimeline")
        self._tweet_detail_meta = _extract_operation(main_js, "TweetDetail")

    def _search(self, query: str, limit: int, source_type: str, source_label: str) -> list[dict[str, Any]]:
        self._load_web_metadata()
        if not self._search_meta:
            raise RuntimeError("X GraphQL 搜索元数据未初始化")
        query_id, features, field_toggles = self._search_meta
        headers = {
            "Authorization": f"Bearer {self._bearer}",
            "Cookie": config.TWITTER_COOKIES,
            "Origin": "https://x.com",
            "Referer": f"https://x.com/search?q={requests.utils.quote(query)}&src=typed_query&f=top",
            "Content-Type": "application/json",
            "x-csrf-token": self.cookies.get("ct0", ""),
            "x-twitter-auth-type": "OAuth2Session",
            "x-twitter-active-user": "yes",
            "x-twitter-client-language": "zh-cn",
        }
        payload = {
            "variables": {
                "rawQuery": query,
                "count": max(1, min(limit * 3, 50)),
                "querySource": "typed_query",
                "product": "Top",
            },
            "features": features,
            "fieldToggles": field_toggles,
            "queryId": query_id,
        }
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        response = None
        last_error: Exception | None = None
        for host in GRAPHQL_HOSTS:
            url = f"{host}/i/api/graphql/{query_id}/SearchTimeline" if host.endswith("x.com") or host.endswith("twitter.com") else f"{host}/graphql/{query_id}/SearchTimeline"
            if host.startswith("https://api."):
                url = f"{host}/graphql/{query_id}/SearchTimeline"
            try:
                response = _request_with_retries(
                    self.session,
                    "POST",
                    url,
                    headers=headers,
                    data=body,
                )
                break
            except Exception as exc:
                last_error = exc
        if response is None:
            raise RuntimeError(f"X GraphQL 搜索失败：{last_error}")
        data = response.json()
        records: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in _iter_dicts(data):
            tweet = _tweet_result_from_container(item)
            if not tweet:
                continue
            record = _tweet_to_record(tweet, source_label=source_label, source_type=source_type)
            if not record:
                continue
            key = str(record.get("tweet_url") or record.get("tweet_id") or "")
            if not key or key in seen:
                continue
            seen.add(key)
            records.append(record)
            if len(records) >= limit:
                break
        return records

    def attach_comments(self, tweets: list[dict[str, Any]], comments_per_tweet: int | None) -> list[dict[str, Any]]:
        per_tweet = config.MAX_COMMENTS_PER_TWEET if comments_per_tweet is None else comments_per_tweet
        if per_tweet <= 0 or not tweets:
            return tweets
        self._load_web_metadata()
        if not self._tweet_detail_meta:
            return tweets
        for tweet in tweets:
            tweet_id = str(tweet.get("tweet_id") or "")
            if not tweet_id:
                continue
            try:
                comments = self._tweet_comments(tweet_id, per_tweet)
            except Exception:
                comments = []
            tweet["comments"] = comments
            tweet["comment_count"] = len(comments)
            metrics = tweet.setdefault("metrics", {})
            if isinstance(metrics, dict):
                metrics["comment_count"] = len(comments)
        return tweets

    def _tweet_comments(self, tweet_id: str, limit: int) -> list[dict[str, Any]]:
        if not self._tweet_detail_meta:
            return []
        query_id, features, field_toggles = self._tweet_detail_meta
        headers = {
            "Authorization": f"Bearer {self._bearer}",
            "Cookie": config.TWITTER_COOKIES,
            "Origin": "https://x.com",
            "Referer": f"https://x.com/i/status/{tweet_id}",
            "Content-Type": "application/json",
            "x-csrf-token": self.cookies.get("ct0", ""),
            "x-twitter-auth-type": "OAuth2Session",
            "x-twitter-active-user": "yes",
            "x-twitter-client-language": "zh-cn",
        }
        payload = {
            "variables": {
                "focalTweetId": tweet_id,
                "with_rux_injections": False,
                "rankingMode": "Relevance",
                "includePromotedContent": False,
                "withCommunity": True,
                "withQuickPromoteEligibilityTweetFields": True,
                "withBirdwatchNotes": True,
                "withVoice": True,
            },
            "features": features,
            "fieldToggles": field_toggles,
            "queryId": query_id,
        }
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        response = None
        last_error: Exception | None = None
        for host in GRAPHQL_HOSTS:
            url = f"{host}/i/api/graphql/{query_id}/TweetDetail"
            if host.startswith("https://api."):
                url = f"{host}/graphql/{query_id}/TweetDetail"
            try:
                response = _request_with_retries(
                    self.session,
                    "POST",
                    url,
                    headers=headers,
                    data=body,
                )
                break
            except Exception as exc:
                last_error = exc
        if response is None:
            raise RuntimeError(f"X TweetDetail 失败：{last_error}")
        comments: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in _iter_dicts(response.json()):
            tweet = _tweet_result_from_container(item)
            if not tweet:
                continue
            record = _tweet_to_record(tweet, source_label=tweet_id, source_type="tweet_comment")
            if not record or record.get("tweet_id") == tweet_id:
                continue
            legacy = tweet.get("legacy") if isinstance(tweet, dict) else {}
            if isinstance(legacy, dict) and str(legacy.get("conversation_id_str") or "") != tweet_id:
                continue
            comment_id = str(record.get("tweet_id") or "")
            if not comment_id or comment_id in seen:
                continue
            seen.add(comment_id)
            comments.append(
                {
                    "type": "tweet_comment",
                    "author": record.get("author") or "",
                    "name": record.get("name") or "",
                    "content": record.get("content") or "",
                    "published_at": record.get("published_at") or "",
                    "url": record.get("url") or "",
                    "tweet_id": comment_id,
                }
            )
            if len(comments) >= limit:
                break
        return comments

    def search_event_evidence(self, event_query: str, limit: int) -> list[dict[str, Any]]:
        query = event_query.strip()
        if not query:
            return []
        if config.SEARCH_DAYS > 0 and " since:" not in query:
            since_date = (datetime.now() - timedelta(days=config.SEARCH_DAYS)).strftime("%Y-%m-%d")
            query = f"{query} since:{since_date}"
        return self._search(query, limit, source_type="event_search", source_label=event_query.strip())

    def discover_hot_tweets(self, limit: int) -> list[dict[str, Any]]:
        since_date = (datetime.now() - timedelta(days=max(1, config.SEARCH_DAYS))).strftime("%Y-%m-%d")
        queries = [
            f"min_replies:50 -filter:replies since:{since_date}",
            f"China min_replies:20 -filter:replies since:{since_date}",
            f"Hong Kong OR Taiwan min_replies:20 -filter:replies since:{since_date}",
        ]
        records: list[dict[str, Any]] = []
        seen: set[str] = set()
        for query in queries:
            for record in self._search(query, limit=limit, source_type="hot_filter", source_label=query):
                key = str(record.get("tweet_url") or "")
                if key and key not in seen:
                    seen.add(key)
                    record["discovery_source"] = "graphql_hot_search"
                    records.append(record)
                if len(records) >= limit:
                    return records
        return records
