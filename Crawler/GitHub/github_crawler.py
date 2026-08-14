#!/usr/bin/env python3
"""Collect GitHub search results by candidate event query with a Personal Access Token."""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import html
import json
import os
import random
import re
import sys
import time
import unicodedata
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from http.client import HTTPException
from pathlib import Path
from typing import Any, Iterable, Iterator
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

CRAWLER_ROOT = Path(__file__).resolve().parents[1]
if str(CRAWLER_ROOT) not in sys.path:
    sys.path.insert(0, str(CRAWLER_ROOT))

from kan_push_bridge import KanPushError, dispatch_kan_message

DEFAULT_API_URL = "https://api.github.com"
DEFAULT_API_VERSION = "2026-03-10"
AGENTHUB_ROOT = Path(os.getenv("AGENTHUB_ROOT", Path(__file__).resolve().parents[2]))
DEFAULT_DOTENV_FILE = AGENTHUB_ROOT / "env" / "Crawler_env" / "GitHub_env"
SEARCH_PATHS = {
    "repositories": "/search/repositories",
    "code": "/search/code",
    "issues": "/search/issues",
    "users": "/search/users",
}
CSV_FIELDS = [
    "event_query",
    "repository_url",
    "content",
]
ALERT_CSV_FIELDS = [
    "fetched_at",
    "event_query",
    "search_type",
    "source_url",
    "repository_url",
    "title",
    "regions",
    "anti_china_tendency",
    "confidence",
    "reason",
    "requires_confirmation",
    "content",
]
DEFAULT_MINIMAX_API_URL = "https://api.minimaxi.com/v1"
DEFAULT_MINIMAX_MODEL = "MiniMax-M2.7-highspeed"
REGION_TERMS = {
    "hong_kong": ["香港", "Hong Kong", "HongKong", "HK"],
    "macau": ["澳门", "澳門", "Macau", "Macao"],
    "taiwan": ["台湾", "台灣", "Taiwan", "TW"],
}
GAME_PROJECT_TERMS = [
    "game",
    "gaming",
    "unity",
    "unreal",
    "godot",
    "rpg",
    "visual novel",
    "renpy",
    "ren'py",
    "pygame",
    "游戏",
    "遊戲",
    "手游",
    "端游",
    "剧情",
    "劇情",
]
GAME_DEEP_PATH_TERMS = [
    "readme",
    "doc",
    "docs",
    "story",
    "stories",
    "plot",
    "scenario",
    "script",
    "scripts",
    "dialog",
    "dialogue",
    "dialogs",
    "quest",
    "quests",
    "mission",
    "missions",
    "character",
    "characters",
    "locale",
    "locales",
    "localization",
    "i18n",
    "lang",
    "language",
    "text",
    "texts",
    "剧情",
    "劇情",
    "对白",
    "對白",
    "任务",
    "任務",
    "角色",
]
GAME_DEEP_TEXT_EXTENSIONS = {
    ".md",
    ".txt",
    ".json",
    ".jsonl",
    ".yaml",
    ".yml",
    ".csv",
    ".tsv",
    ".xml",
    ".ini",
    ".cfg",
    ".toml",
    ".po",
    ".pot",
    ".properties",
    ".rpy",
    ".gd",
    ".lua",
    ".js",
    ".ts",
}


class GitHubAPIError(RuntimeError):
    """Raised when GitHub returns an error that should not be retried."""


class MiniMaxAPIError(RuntimeError):
    """Raised when MiniMax returns an analysis error."""


class PlainTextHTMLParser(HTMLParser):
    """Convert embedded HTML to readable text while discarding non-content elements."""

    BLOCK_TAGS = {
        "blockquote",
        "br",
        "div",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "hr",
        "li",
        "ol",
        "p",
        "pre",
        "table",
        "tr",
        "ul",
    }
    HIDDEN_TAGS = {"script", "style", "svg"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self.HIDDEN_TAGS:
            self.hidden_depth += 1
        elif not self.hidden_depth and tag in self.BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self.HIDDEN_TAGS and self.hidden_depth:
            self.hidden_depth -= 1
        elif not self.hidden_depth and tag in self.BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.hidden_depth:
            self.parts.append(data)


def clean_content(content: str, max_length: int = 500) -> str:
    """Strip embedded HTML and normalize a repository description for readable output."""
    parser = PlainTextHTMLParser()
    parser.feed(content)
    parser.close()
    text = html.unescape("".join(parser.parts))
    text = "".join(
        character
        for character in text
        if character in "\r\n\t" or unicodedata.category(character) not in {"Cc", "Cf", "Co", "Cs"}
    )
    text = re.sub(r"\s+", " ", text, flags=re.UNICODE).strip()
    if max_length > 0 and len(text) > max_length:
        return text[:max_length].rstrip() + "..."
    return text


def content_excerpt(content: str, keyword: str, max_length: int = 500) -> str:
    """Return a compact description excerpt centered near the first matching search term."""
    text = clean_content(content, max_length=0)
    if max_length <= 0 or len(text) <= max_length:
        return text
    positions = [
        text.casefold().find(term)
        for term in search_terms(keyword)
        if text.casefold().find(term) >= 0
    ]
    if not positions:
        return text[:max_length].rstrip() + "..."
    context_before = min(80, max_length // 4)
    start = max(min(positions) - context_before, 0)
    end = min(start + max_length, len(text))
    prefix = "..." if start else ""
    suffix = "..." if end < len(text) else ""
    return prefix + text[start:end].strip() + suffix


def search_terms(keyword: str) -> list[str]:
    """Extract plain-text terms and ignore GitHub search qualifiers such as language:python."""
    terms = []
    for quoted, plain in re.findall(r'"([^"]+)"|(\S+)', keyword):
        term = quoted or plain
        if ":" not in term and term:
            terms.append(term.casefold())
    return terms


def build_region_queries(keywords: list[str], regions: list[str] | None = None) -> list[str]:
    """Combine user keywords with Hong Kong, Macau, and Taiwan search terms."""
    selected_regions = regions or list(REGION_TERMS)
    queries = []
    for keyword in keywords:
        for region in selected_regions:
            for term in REGION_TERMS[region]:
                region_term = f'"{term}"' if " " in term else term
                queries.append(f"{keyword} {region_term}")
    return queries


def search_queries_for_type(keyword: str, search_type: str) -> list[str]:
    if search_type != "issues":
        return [keyword]
    folded = keyword.casefold()
    if "is:issue" in folded or "is:pull-request" in folded or "is:pr" in folded:
        return [keyword]
    return [f"{keyword} is:issue", f"{keyword} is:pull-request"]


def detect_regions(text: str) -> list[str]:
    """Return region keys found in text."""
    folded = text.casefold()
    matches = []
    for region, terms in REGION_TERMS.items():
        if any(term.casefold() in folded for term in terms):
            matches.append(region)
    return matches


def record_url(record: SearchRecord) -> str:
    """Return the best public URL for a GitHub search record."""
    item = record.item
    if record.search_type == "code" and item.get("html_url"):
        return str(item.get("html_url") or "")
    if item.get("html_url"):
        return str(item.get("html_url") or "")
    repository = item.get("repository")
    if isinstance(repository, dict):
        return str(repository.get("html_url") or "")
    return ""


def repository_url(record: SearchRecord) -> str:
    """Return the repository URL when the result has one."""
    item = record.item
    if record.search_type == "repositories":
        return str(item.get("html_url") or "")
    repository = item.get("repository")
    if isinstance(repository, dict):
        return str(repository.get("html_url") or "")
    return str(item.get("repository_url") or "")


def record_title(record: SearchRecord) -> str:
    """Return a compact title/name for a GitHub result."""
    item = record.item
    return str(
        item.get("full_name")
        or item.get("title")
        or item.get("name")
        or item.get("path")
        or item.get("login")
        or ""
    )


def record_identity(record: SearchRecord) -> str:
    """Build a stable identity used to skip results that were already processed."""
    identity_source = "|".join(
        [
            record.search_type,
            str(record.item.get("id") or ""),
            str(record.item.get("sha") or ""),
            record_url(record),
        ]
    )
    return hashlib.sha256(identity_source.encode("utf-8")).hexdigest()


def repository_matches_keyword(keyword: str, item: dict[str, Any], content: str) -> bool:
    """Keep direct matches that remain meaningful in the compact repository output."""
    terms = search_terms(keyword)
    if not terms:
        return True
    haystack = " ".join(
        [
            str(item.get("full_name") or ""),
            str(item.get("html_url") or ""),
            content,
        ]
    ).casefold()
    return all(term in haystack for term in terms)


@dataclass(frozen=True)
class SearchRecord:
    keyword: str
    search_type: str
    fetched_at: str
    item: dict[str, Any]
    content: str = ""
    content_max_length: int = 500

    def as_json(self) -> dict[str, Any]:
        return {
            "event_query": self.keyword,
            "repository_url": self.item.get("html_url", ""),
            "content": content_excerpt(self.content, self.keyword, self.content_max_length),
        }

    def as_csv(self) -> dict[str, Any]:
        return {
            "event_query": self.keyword,
            "repository_url": self.item.get("html_url", ""),
            "content": content_excerpt(self.content, self.keyword, self.content_max_length),
        }


def load_dotenv(path: Path) -> None:
    """Load simple KEY=VALUE pairs without overriding existing environment variables."""
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if key:
            os.environ.setdefault(key, value)


class GitHubClient:
    def __init__(
        self,
        token: str,
        api_url: str = DEFAULT_API_URL,
        api_version: str = DEFAULT_API_VERSION,
        timeout: float = 30.0,
        retries: int = 4,
        request_interval: float = 1.0,
    ) -> None:
        if not token:
            raise ValueError("缺少 GitHub PAT，请设置环境变量 GITHUB_TOKEN 或在 .env 中填写。")
        self.token = token
        self.api_url = api_url.rstrip("/")
        self.api_version = api_version
        self.timeout = timeout
        self.retries = retries
        self.request_interval = request_interval
        self._last_request_at = 0.0

    def _headers(self) -> dict[str, str]:
        return {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {self.token}",
            "User-Agent": "github-event-crawler",
            "X-GitHub-Api-Version": self.api_version,
        }

    def _pace_requests(self) -> None:
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < self.request_interval:
            time.sleep(self.request_interval - elapsed)

    @staticmethod
    def _error_message(error: HTTPError) -> str:
        try:
            payload = json.loads(error.read().decode("utf-8", errors="replace"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return error.reason or "未知错误"
        return str(payload.get("message") or payload)

    @staticmethod
    def _retry_delay(error: HTTPError, attempt: int) -> float | None:
        if error.code not in {403, 429, 500, 502, 503, 504}:
            return None
        retry_after = error.headers.get("Retry-After")
        if retry_after:
            try:
                return max(float(retry_after), 0.0)
            except ValueError:
                pass
        remaining = error.headers.get("X-RateLimit-Remaining")
        reset_at = error.headers.get("X-RateLimit-Reset")
        if remaining == "0" and reset_at:
            try:
                return max(float(reset_at) - time.time(), 0.0) + 1.0
            except ValueError:
                pass
        return min(60.0 * (2**attempt), 15 * 60.0) + random.uniform(0.0, 1.0)

    def get_json(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        query = f"?{urlencode(params)}" if params else ""
        url = f"{self.api_url}{path}{query}"
        for attempt in range(self.retries + 1):
            self._pace_requests()
            request = Request(url, headers=self._headers(), method="GET")
            try:
                with urlopen(request, timeout=self.timeout) as response:
                    self._last_request_at = time.monotonic()
                    return json.load(response)
            except HTTPError as error:
                self._last_request_at = time.monotonic()
                message = self._error_message(error)
                delay = self._retry_delay(error, attempt)
                if delay is None or attempt >= self.retries:
                    raise GitHubAPIError(
                        f"GitHub API 请求失败：HTTP {error.code}，{message}"
                    ) from error
                print(
                    f"GitHub API 暂时不可用或触发限速：HTTP {error.code}，"
                    f"{message}；{delay:.1f} 秒后重试。",
                    file=sys.stderr,
                )
                time.sleep(delay)
            except (OSError, URLError, HTTPException, json.JSONDecodeError) as error:
                self._last_request_at = time.monotonic()
                reason = getattr(error, "reason", str(error))
                if attempt >= self.retries:
                    raise GitHubAPIError(f"网络请求失败：{reason}") from error
                delay = min(2**attempt, 30) + random.uniform(0.0, 1.0)
                print(f"网络请求失败：{reason}；{delay:.1f} 秒后重试。", file=sys.stderr)
                time.sleep(delay)
        raise AssertionError("unreachable")

    def check_token(self) -> dict[str, Any]:
        return self.get_json("/user")

    def search(
        self,
        keyword: str,
        search_type: str,
        max_results: int,
        per_page: int,
        sort: str | None = None,
        order: str = "desc",
    ) -> Iterator[SearchRecord]:
        if search_type not in SEARCH_PATHS:
            raise ValueError(f"不支持的搜索类型：{search_type}")
        if max_results > 1000:
            print("GitHub Search API 每条查询最多提供 1,000 条结果，已自动限制。", file=sys.stderr)
            max_results = 1000
        fetched = 0
        page = 1
        while fetched < max_results:
            params: dict[str, Any] = {
                "q": keyword,
                "page": page,
                "per_page": min(per_page, max_results - fetched),
            }
            if sort:
                params["sort"] = sort
                params["order"] = order
            payload = self.get_json(SEARCH_PATHS[search_type], params)
            items = payload.get("items", [])
            if not items:
                break
            fetched_at = datetime.now(timezone.utc).isoformat()
            for item in items:
                yield SearchRecord(keyword, search_type, fetched_at, item)
                fetched += 1
                if fetched >= max_results:
                    break
            print(
                f"[{search_type}] 事件复核表达式 {keyword!r}：已获取 {fetched} 条，"
                f"GitHub 报告匹配 {payload.get('total_count', '未知')} 条。",
                file=sys.stderr,
            )
            if len(items) < params["per_page"]:
                break
            page += 1

    def search_exhaustive_repositories(
        self,
        keyword: str,
        start_date: date,
        end_date: date,
        per_page: int,
        sort: str | None = None,
        order: str = "desc",
    ) -> Iterator[SearchRecord]:
        """Split repository searches by creation date to work around the 1,000-result cap."""
        if start_date > end_date:
            raise ValueError("--start-date 不能晚于 --end-date")

        def search_range(range_start: date, range_end: date) -> Iterator[SearchRecord]:
            query = f"{keyword} created:{range_start.isoformat()}..{range_end.isoformat()}"
            summary = self.get_json(
                SEARCH_PATHS["repositories"],
                {"q": query, "page": 1, "per_page": 1},
            )
            total_count = int(summary.get("total_count", 0))
            print(
                f"[repositories] 检查区间 {range_start}..{range_end}："
                f"匹配 {total_count} 条。",
                file=sys.stderr,
            )
            if total_count == 0:
                return
            if total_count > 1000 and range_start < range_end:
                middle = range_start + timedelta(days=(range_end - range_start).days // 2)
                yield from search_range(range_start, middle)
                yield from search_range(middle + timedelta(days=1), range_end)
                return
            if total_count > 1000:
                print(
                    f"警告：{range_start} 当天仍匹配 {total_count} 条，"
                    "GitHub Search API 最多只能提供其中 1,000 条。",
                    file=sys.stderr,
                )
            yield from self.search(
                query,
                "repositories",
                min(total_count, 1000),
                per_page,
                sort,
                order,
            )

        yield from search_range(start_date, end_date)

    def repository_tree(self, full_name: str, branch: str | None = None) -> list[dict[str, Any]]:
        repository = self.get_json(f"/repos/{full_name}")
        ref = branch or str(repository.get("default_branch") or "HEAD")
        tree = self.get_json(f"/repos/{full_name}/git/trees/{ref}", {"recursive": "1"})
        items = tree.get("tree", [])
        if not isinstance(items, list):
            return []
        return [item for item in items if isinstance(item, dict)]

    def file_text(self, full_name: str, path: str, max_bytes: int = 120_000) -> str:
        payload = self.get_json(f"/repos/{full_name}/contents/{path}")
        if not isinstance(payload, dict) or payload.get("type") != "file":
            return ""
        size = int(payload.get("size") or 0)
        if size <= 0 or size > max_bytes:
            return ""
        content = payload.get("content")
        if not isinstance(content, str):
            return ""
        encoding = str(payload.get("encoding") or "")
        if encoding != "base64":
            return ""
        raw = base64.b64decode(content, validate=False)
        return raw.decode("utf-8", errors="replace")


class MiniMaxAnalyzer:
    def __init__(
        self,
        api_key: str,
        api_url: str = DEFAULT_MINIMAX_API_URL,
        model: str = DEFAULT_MINIMAX_MODEL,
        timeout: float = 60.0,
        trust_env: bool = True,
    ) -> None:
        if not api_key:
            raise ValueError("缺少 MiniMax API Key，请设置 MINIMAX_API_KEY 或传入 --minimax-api-key")
        self.api_key = api_key
        self.api_url = api_url
        self.model = model
        self.timeout = timeout
        self.trust_env = trust_env

    def _chat_url(self) -> str:
        api_url = self.api_url.rstrip("/")
        if api_url.endswith("/chat/completions") or api_url.endswith("/text/chatcompletion_v2"):
            return api_url
        return f"{api_url}/chat/completions"

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    @staticmethod
    def _extract_message(payload: dict[str, Any]) -> str:
        base_resp = payload.get("base_resp")
        if isinstance(base_resp, dict):
            status_code = base_resp.get("status_code")
            if status_code not in {None, 0}:
                status_msg = base_resp.get("status_msg") or "unknown error"
                raise MiniMaxAPIError(f"MiniMax API 返回错误：{status_code}，{status_msg}")
        error = payload.get("error")
        if isinstance(error, dict):
            message = error.get("message") or error
            raise MiniMaxAPIError(f"MiniMax API 返回错误：{message}")
        choices = payload.get("choices")
        if isinstance(choices, list) and choices:
            message = choices[0].get("message")
            if isinstance(message, dict):
                content = message.get("content")
                if isinstance(content, str):
                    return content
            text = choices[0].get("text")
            if isinstance(text, str):
                return text
        reply = payload.get("reply")
        if isinstance(reply, str):
            return reply
        return json.dumps(payload, ensure_ascii=False)

    def analyze(self, record: SearchRecord, regions: list[str]) -> dict[str, Any]:
        content = content_excerpt(record.content, record.keyword, record.content_max_length)
        user_prompt = {
            "event_query": record.keyword,
            "search_type": record.search_type,
            "title": record_title(record),
            "url": record_url(record),
            "regions": regions,
            "content": content,
        }
        request_payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "你是内容风控分析助手。请判断给定 GitHub 公开内容是否涉及香港、澳门或台湾，"
                        "以及是否存在反华倾向。只输出 JSON，不要输出额外文本。JSON 字段："
                        "anti_china_tendency，取值 yes/no/unclear；confidence，0 到 1；reason，简短中文理由。"
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(user_prompt, ensure_ascii=False),
                },
            ],
            "temperature": 0.1,
        }
        response_payload: dict[str, Any]
        try:
            import requests  # type: ignore

            last_error: requests.RequestException | None = None
            for attempt in range(3):
                try:
                    session = requests.Session()
                    session.trust_env = self.trust_env
                    response = session.post(
                        self._chat_url(),
                        headers=self._headers(),
                        json=request_payload,
                        timeout=self.timeout,
                    )
                    try:
                        response_payload = response.json()
                    except ValueError as error:
                        raise MiniMaxAPIError(f"MiniMax API 返回非 JSON 内容：{response.text[:300]}") from error
                    if response.status_code >= 400:
                        raise MiniMaxAPIError(f"MiniMax API 请求失败：HTTP {response.status_code}，{response_payload}")
                    break
                except requests.RequestException as error:
                    last_error = error
                    if attempt < 2:
                        time.sleep(1.5 * (attempt + 1))
            else:
                raise MiniMaxAPIError(f"MiniMax API 网络请求失败：{last_error}") from last_error
        except ImportError:
            data = json.dumps(request_payload, ensure_ascii=False).encode("utf-8")
            request = Request(self._chat_url(), data=data, headers=self._headers(), method="POST")
            try:
                with urlopen(request, timeout=self.timeout) as response:
                    response_payload = json.load(response)
            except HTTPError as error:
                message = GitHubClient._error_message(error)
                raise MiniMaxAPIError(f"MiniMax API 请求失败：HTTP {error.code}，{message}") from error
            except (URLError, HTTPException, json.JSONDecodeError) as error:
                reason = getattr(error, "reason", str(error))
                raise MiniMaxAPIError(f"MiniMax API 请求失败：{reason}") from error

        message = self._extract_message(response_payload)
        message = re.sub(r"<think>.*?</think>", "", message, flags=re.DOTALL).strip()
        try:
            parsed = json.loads(message)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", message, flags=re.DOTALL)
            if not match:
                return {
                    "anti_china_tendency": "unclear",
                    "confidence": 0.0,
                    "reason": f"MiniMax 返回内容无法解析为 JSON：{message[:200]}",
                }
            try:
                parsed = json.loads(match.group(0))
            except json.JSONDecodeError:
                return {
                    "anti_china_tendency": "unclear",
                    "confidence": 0.0,
                    "reason": f"MiniMax 返回 JSON 格式不完整：{match.group(0)[:200]}",
                }

        tendency = str(parsed.get("anti_china_tendency", "unclear")).casefold()
        if tendency not in {"yes", "no", "unclear"}:
            tendency = "unclear"
        try:
            confidence = float(parsed.get("confidence", 0))
        except (TypeError, ValueError):
            confidence = 0.0
        return {
            "anti_china_tendency": tendency,
            "confidence": max(0.0, min(confidence, 1.0)),
            "reason": str(parsed.get("reason", "")).strip(),
        }


def write_records(records: Iterable[SearchRecord], output: Path, output_format: str) -> int:
    output.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with output.open("w", encoding="utf-8", newline="") as file:
        writer = None
        if output_format == "csv":
            writer = csv.DictWriter(file, fieldnames=CSV_FIELDS)
            writer.writeheader()
        for record in records:
            if writer:
                writer.writerow(record.as_csv())
            else:
                file.write(json.dumps(record.as_json(), ensure_ascii=False) + "\n")
            file.flush()
            count += 1
    return count


def load_seen_ids(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    }


def append_seen_id(path: Path, record_id: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="") as file:
        file.write(record_id + "\n")


def pushed_state_file(state_file: Path) -> Path:
    return state_file.with_name("pushed-records.txt")


def pending_sensitive_file(state_file: Path) -> Path:
    return state_file.with_name("pending-sensitive.jsonl")


def query_cursor_file(state_file: Path) -> Path:
    return state_file.with_name("query-cursor.txt")


def dated_output_path(filename: str, today: date | None = None) -> Path:
    current = today or date.today()
    return Path("output") / f"{current.year:04d}" / f"{current.month:02d}" / f"{current.day:02d}" / filename


def select_query_batch(queries: list[str], batch_size: int, cursor_file: Path) -> list[str]:
    if batch_size <= 0 or batch_size >= len(queries):
        return queries
    try:
        cursor = int(cursor_file.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        cursor = 0
    cursor %= len(queries)
    end = cursor + batch_size
    if end <= len(queries):
        selected = queries[cursor:end]
    else:
        selected = queries[cursor:] + queries[: end % len(queries)]
    cursor_file.parent.mkdir(parents=True, exist_ok=True)
    cursor_file.write_text(str(end % len(queries)), encoding="utf-8")
    return selected


def alert_payload(record: SearchRecord, regions: list[str], analysis: dict[str, Any]) -> dict[str, Any]:
    return {
        "fetched_at": record.fetched_at,
        "event_query": record.keyword,
        "search_type": record.search_type,
        "source_url": record_url(record),
        "repository_url": repository_url(record),
        "title": record_title(record),
        "regions": regions,
        "anti_china_tendency": analysis["anti_china_tendency"],
        "confidence": analysis["confidence"],
        "reason": analysis["reason"],
        "requires_confirmation": bool(analysis.get("requires_confirmation", False)),
        "content": content_excerpt(record.content, record.keyword, record.content_max_length),
    }


def append_alert(payload: dict[str, Any], output: Path, output_format: str) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    if output_format == "csv":
        write_header = not output.exists() or output.stat().st_size == 0
        with output.open("a", encoding="utf-8", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=ALERT_CSV_FIELDS)
            if write_header:
                writer.writeheader()
            row = dict(payload)
            row["regions"] = ",".join(payload.get("regions", []))
            writer.writerow(row)
    else:
        with output.open("a", encoding="utf-8", newline="") as file:
            file.write(json.dumps(payload, ensure_ascii=False) + "\n")


def post_webhook(url: str, payload: dict[str, Any], timeout: float = 20.0) -> None:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=timeout) as response:
        response.read()


def format_alert_message(payload: dict[str, Any]) -> str:
    regions = ", ".join(payload.get("regions", [])) or "-"
    event_query = payload.get("event_query") or payload.get("keyword") or "-"
    return "\n".join(
        [
            f"事件复核条件：{event_query}",
            f"地区：{regions}",
            f"理由：{payload.get('reason', '-') or '-'}",
            f"标题：{payload.get('title', '-') or '-'}",
            f"链接：{payload.get('source_url', '-') or '-'}",
        ]
    )


def post_mattermost(
    server_url: str,
    bot_token: str,
    channel_id: str,
    payload: dict[str, Any],
    timeout: float = 20.0,
) -> None:
    dispatch_kan_message(
        platform="github",
        route_id="github-kan",
        message=format_alert_message(payload),
        channel_ids=[channel_id],
        source="github-crawler",
        dedupe_key=str(payload.get("record_id") or payload.get("source_url") or ""),
        metadata={
            "payload": payload,
            "legacy_server_url": server_url,
            "opencrow_token_configured": bool(bot_token),
        },
        timeout=timeout,
    )


def post_mattermost_channels(
    server_url: str,
    bot_token: str,
    channel_ids: str,
    payload: dict[str, Any],
    timeout: float = 20.0,
) -> None:
    for channel_id in [item.strip() for item in channel_ids.split(",") if item.strip()]:
        try:
            post_mattermost(server_url, bot_token, channel_id, payload, timeout)
        except (HTTPError, URLError, HTTPException, KanPushError) as error:
            reason = getattr(error, "reason", str(error))
            print(f"OpenCrow Kan 推送失败：channel={channel_id}，{reason}", file=sys.stderr)


def push_alert(
    payload: dict[str, Any],
    webhook_url: str | None,
    mattermost_server_url: str | None = None,
    mattermost_bot_token: str | None = None,
    mattermost_channel_id: str | None = None,
) -> None:
    try:
        if webhook_url:
            post_webhook(webhook_url, payload)
        if mattermost_channel_id:
            post_mattermost_channels(
                mattermost_server_url or "",
                mattermost_bot_token or "",
                mattermost_channel_id,
                payload,
            )
    except (HTTPError, URLError, HTTPException, KanPushError) as error:
        reason = getattr(error, "reason", str(error))
        print(f"推送失败：{reason}", file=sys.stderr)


def send_pending_sensitive(
    state_file: Path,
    webhook_url: str | None = None,
    mattermost_server_url: str | None = None,
    mattermost_bot_token: str | None = None,
    mattermost_channel_id: str | None = None,
    pending_index: int | None = None,
) -> int:
    pending_file = pending_sensitive_file(state_file)
    if not pending_file.exists():
        print(f"没有待确认文件：{pending_file}")
        return 0
    records = [
        json.loads(line)
        for line in pending_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if pending_index is not None:
        if pending_index < 1 or pending_index > len(records):
            raise ValueError(f"--pending-index 超出范围：{pending_index}")
        selected = [(pending_index, records[pending_index - 1])]
    else:
        selected = list(enumerate(records, start=1))

    pushed = load_seen_ids(pushed_state_file(state_file))
    sent = 0
    for index, payload in selected:
        identity = str(payload.get("record_id") or "") or hashlib.sha256(
            "|".join(
                [
                    str(payload.get("search_type") or ""),
                    str(payload.get("source_url") or ""),
                    str(payload.get("event_query") or payload.get("keyword") or ""),
                ]
            ).encode("utf-8")
        ).hexdigest()
        if identity in pushed:
            continue
        push_alert(payload, webhook_url, mattermost_server_url, mattermost_bot_token, mattermost_channel_id)
        append_seen_id(pushed_state_file(state_file), identity)
        pushed.add(identity)
        sent += 1
        print(f"已发送待确认结果 #{index}：{payload.get('source_url', '')}")
    return sent


def list_pending_sensitive(
    state_file: Path,
    pending_index: int | None = None,
) -> int:
    pending_file = pending_sensitive_file(state_file)
    if not pending_file.exists():
        print(f"没有待确认文件：{pending_file}")
        return 0
    records = [
        json.loads(line)
        for line in pending_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if pending_index is not None:
        if pending_index < 1 or pending_index > len(records):
            raise ValueError(f"--pending-index 超出范围：{pending_index}")
        selected = [(pending_index, records[pending_index - 1])]
    else:
        selected = list(enumerate(records, start=1))

    for index, payload in selected:
        print(f"# {index}")
        print(format_alert_message(payload))
    return len(selected)


def minimax_api_key_for(api_url: str, explicit_api_key: str | None = None) -> str:
    if explicit_api_key:
        return explicit_api_key
    host = api_url.casefold()
    if "api.minimax.io" in host:
        return os.getenv("MINIMAX_INTL_API_KEY") or os.getenv("MINIMAX_API_KEY", "")
    return os.getenv("MINIMAX_API_KEY", "")


def minimax_trust_env_for(api_url: str) -> bool:
    configured = os.getenv("MINIMAX_TRUST_ENV")
    if configured is not None:
        return configured.strip().casefold() in {"1", "true", "yes", "on"}
    return "api.minimax.io" not in api_url.casefold()


def clean_jsonl_file(path: Path, content_max_length: int = 500) -> int:
    """Clean the content field in an existing JSONL result file in place."""
    records = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        event_query = str(record.get("event_query") or record.get("keyword") or "")
        record["content"] = content_excerpt(
            str(record.get("content", "")),
            event_query,
            content_max_length,
        )
        records.append(record)
    with path.open("w", encoding="utf-8", newline="") as file:
        for record in records:
            file.write(json.dumps(record, ensure_ascii=False) + "\n")
    return len(records)


def repository_full_name(record: SearchRecord) -> str:
    item = record.item
    if record.search_type == "repositories":
        return str(item.get("full_name") or "")
    repository = item.get("repository")
    if isinstance(repository, dict):
        return str(repository.get("full_name") or "")
    repository_url_value = repository_url(record)
    match = re.search(r"github\.com[:/](?P<owner>[^/\s]+)/(?P<repo>[^/\s#?]+)", repository_url_value)
    if match:
        return f"{match.group('owner')}/{match.group('repo').removesuffix('.git')}"
    return ""


def is_game_project(record: SearchRecord) -> bool:
    text = " ".join(
        [
            record.keyword,
            record_title(record),
            record_url(record),
            repository_url(record),
            str(record.item.get("description") or ""),
            record.content,
        ]
    ).casefold()
    return any(term.casefold() in text for term in GAME_PROJECT_TERMS)


def is_game_deep_text_path(path: str) -> bool:
    lowered = path.casefold()
    suffix = Path(path).suffix.casefold()
    if suffix not in GAME_DEEP_TEXT_EXTENSIONS:
        return False
    return any(term.casefold() in lowered for term in GAME_DEEP_PATH_TERMS)


def game_deep_text_excerpt(
    client: GitHubClient,
    record: SearchRecord,
    max_files: int = 8,
    max_chars: int = 6000,
) -> str:
    if not is_game_project(record):
        return ""
    full_name = repository_full_name(record)
    if not full_name:
        return ""
    snippets = []
    total_chars = 0
    try:
        tree = client.repository_tree(full_name)
    except GitHubAPIError as error:
        return f"[game-deep-scan-error] {error}"
    candidates = [
        str(item.get("path") or "")
        for item in tree
        if item.get("type") == "blob" and is_game_deep_text_path(str(item.get("path") or ""))
    ]
    for path in candidates[:max_files]:
        try:
            text = clean_content(client.file_text(full_name, path), max_length=0)
        except (GitHubAPIError, ValueError) as error:
            text = f"[read-error] {error}"
        if not text:
            continue
        remaining = max_chars - total_chars
        if remaining <= 0:
            break
        excerpt = text[:remaining].strip()
        snippets.append(f"[{path}]\n{excerpt}")
        total_chars += len(excerpt)
    if not snippets:
        return ""
    return "\n\n".join(snippets)


def collect_records(
    client: GitHubClient,
    keywords: list[str],
    search_types: list[str],
    max_results: int,
    per_page: int,
    sort: str | None,
    order: str,
    exhaustive: bool = False,
    start_date: date | None = None,
    end_date: date | None = None,
    content_max_length: int = 500,
    include_indirect_matches: bool = True,
    excluded_urls: set[str] | None = None,
) -> Iterator[SearchRecord]:
    seen: set[tuple[str, Any]] = set()
    excluded_urls = excluded_urls or set()
    for keyword in keywords:
        for search_type in search_types:
            if exhaustive:
                if search_type != "repositories":
                    raise ValueError("--exhaustive 目前仅支持 --type repositories")
                query_records = [
                    client.search_exhaustive_repositories(
                        keyword,
                        start_date or date(2008, 1, 1),
                        end_date or date.today(),
                        per_page,
                        sort,
                        order,
                    )
                ]
            else:
                query_records = [
                    client.search(query, search_type, max_results, per_page, sort, order)
                    for query in search_queries_for_type(keyword, search_type)
                ]
            for records in query_records:
                yield from _dedupe_collect_records(
                    records,
                    seen,
                    excluded_urls,
                    keyword,
                    search_type,
                    content_max_length,
                    include_indirect_matches,
                )


def collect_latest_records(
    client: GitHubClient,
    max_results: int,
    per_page: int,
    sort: str | None,
    order: str,
    content_max_length: int = 500,
    since_days: int = 2,
) -> Iterator[SearchRecord]:
    """Collect recent public repositories without using a user keyword file."""
    since = date.today() - timedelta(days=max(1, since_days))
    query = f"pushed:>={since.isoformat()} archived:false"
    seen: set[tuple[str, Any]] = set()
    records = client.search(
        query,
        "repositories",
        max_results,
        per_page,
        sort or "updated",
        order,
    )
    yield from _dedupe_collect_records(
        records,
        seen,
        set(),
        "autonomous_latest",
        "repositories",
        content_max_length,
        True,
    )


def _dedupe_collect_records(
    records: Iterator[SearchRecord],
    seen: set[tuple[str, Any]],
    excluded_urls: set[str],
    keyword: str,
    search_type: str,
    content_max_length: int,
    include_indirect_matches: bool,
) -> Iterator[SearchRecord]:
    for record in records:
        item_key = (
            search_type,
            record.item.get("id")
            or record.item.get("sha")
            or record.item.get("html_url")
            or record_url(record),
        )
        if item_key in seen:
            continue
        seen.add(item_key)
        repository_url = str(record.item.get("html_url") or "")
        if repository_url in excluded_urls:
            print(f"[repositories] 跳过排除 URL：{repository_url}", file=sys.stderr)
            continue
        if search_type == "repositories":
            content = str(record.item.get("description") or "")
        else:
            content = str(record.item.get("body") or record.item.get("description") or "")
        if (
            search_type == "repositories"
            and not include_indirect_matches
            and not repository_matches_keyword(keyword, record.item, content)
        ):
            print(
                f"[repositories] 跳过间接匹配：{record.item.get('html_url', '')}",
                file=sys.stderr,
            )
            continue
        yield SearchRecord(
            keyword,
            search_type,
            record.fetched_at,
            record.item,
            content,
            content_max_length,
        )


def monitor_region_records(
    client: GitHubClient,
    analyzer: MiniMaxAnalyzer,
    keywords: list[str],
    search_types: list[str],
    max_results: int,
    per_page: int,
    sort: str | None,
    order: str,
    output: Path,
    output_format: str,
    state_file: Path,
    content_max_length: int = 500,
    regions: list[str] | None = None,
    webhook_url: str | None = None,
    mattermost_server_url: str | None = None,
    mattermost_bot_token: str | None = None,
    mattermost_channel_id: str | None = None,
    push_only_tendency: bool = True,
    continue_on_analysis_error: bool = False,
    query_batch_size: int = 0,
    debug_monitor: bool = False,
) -> int:
    if not keywords:
        raise ValueError("事件复核表达式为空")
    selected_regions = regions or list(REGION_TERMS)
    queries = build_region_queries(keywords, selected_regions)
    queries = select_query_batch(queries, query_batch_size, query_cursor_file(state_file))
    seen = load_seen_ids(state_file)
    pushed_file = pushed_state_file(state_file)
    pushed = load_seen_ids(pushed_file)
    saved = 0
    records = collect_records(
        client,
        queries,
        search_types,
        max_results,
        per_page,
        sort,
        order,
        exhaustive=False,
        content_max_length=content_max_length,
    )
    for record in records:
        identity = record_identity(record)
        if identity in seen:
            if debug_monitor:
                print(
                    f"[monitor-debug] skip already seen: {record_title(record) or record_url(record)} ({identity})",
                    file=sys.stderr,
                )
            continue
        text = " ".join([record_title(record), record_url(record), repository_url(record), record.content])
        matched_regions = detect_regions(text)
        if not matched_regions:
            if debug_monitor:
                print(
                    f"[monitor-debug] skip no region match: keyword={record.keyword!r}, "
                    f"title={record_title(record)!r}, url={record_url(record)!r}",
                    file=sys.stderr,
                )
            append_seen_id(state_file, identity)
            seen.add(identity)
            continue
        deep_text = game_deep_text_excerpt(client, record)
        if deep_text:
            record = replace(
                record,
                content=f"{record.content}\n\n[游戏项目深度巡查文本]\n{deep_text}".strip(),
            )
            if debug_monitor:
                print(
                    f"[monitor-debug] game deep scan attached: {record_title(record) or record_url(record)}",
                    file=sys.stderr,
                )
        try:
            analysis = analyzer.analyze(record, matched_regions)
        except MiniMaxAPIError as error:
            error_text = str(error)
            if "output new_sensitive" in error_text:
                analysis = {
                    "anti_china_tendency": "yes",
                    "confidence": 1.0,
                    "reason": "敏感内容过滤了，但信息和指定的事件复核条件相关。",
                }
            else:
                if not continue_on_analysis_error:
                    raise
                analysis = {
                    "anti_china_tendency": "unclear",
                    "confidence": 0.0,
                    "reason": f"MiniMax 分析失败：{error}",
                }
        payload = alert_payload(record, matched_regions, analysis)
        append_alert(payload, output, output_format)
        append_seen_id(state_file, identity)
        seen.add(identity)
        saved += 1
        if debug_monitor:
            print(
                f"[monitor-debug] saved: regions={','.join(matched_regions)}, "
                f"title={record_title(record)!r}, url={record_url(record)!r}",
                file=sys.stderr,
            )
        if payload.get("requires_confirmation"):
            payload["record_id"] = identity
            append_alert(payload, pending_sensitive_file(state_file), "jsonl")
            print(f"[pending] 发现需确认推送结果：{payload.get('source_url', '')}", file=sys.stderr)
            continue
        should_push = (not push_only_tendency or analysis["anti_china_tendency"] == "yes") and identity not in pushed
        if should_push:
            push_alert(
                payload,
                webhook_url,
                mattermost_server_url,
                mattermost_bot_token,
                mattermost_channel_id,
            )
            append_seen_id(pushed_file, identity)
            pushed.add(identity)
    return saved


def watch_region_records(
    client: GitHubClient,
    analyzer: MiniMaxAnalyzer,
    keywords: list[str],
    search_types: list[str],
    max_results: int,
    per_page: int,
    sort: str | None,
    order: str,
    output: Path,
    output_format: str,
    state_file: Path,
    content_max_length: int = 500,
    regions: list[str] | None = None,
    webhook_url: str | None = None,
    mattermost_server_url: str | None = None,
    mattermost_bot_token: str | None = None,
    mattermost_channel_id: str | None = None,
    push_only_tendency: bool = True,
    continue_on_analysis_error: bool = False,
    query_batch_size: int = 20,
    watch_interval: float = 300.0,
    output_filename: str | None = None,
    debug_monitor: bool = False,
) -> None:
    round_number = 1
    while True:
        started_at = datetime.now(timezone.utc).isoformat()
        print(f"[watch] 第 {round_number} 轮开始：{started_at}", file=sys.stderr)
        try:
            current_output = dated_output_path(output_filename) if output_filename else output
            count = monitor_region_records(
                client,
                analyzer,
                keywords,
                search_types,
                max_results,
                per_page,
                sort,
                order,
                current_output,
                output_format,
                state_file,
                content_max_length,
                regions,
                webhook_url,
                mattermost_server_url,
                mattermost_bot_token,
                mattermost_channel_id,
                push_only_tendency,
                continue_on_analysis_error,
                query_batch_size,
                debug_monitor,
            )
            print(f"[watch] 第 {round_number} 轮完成：新增保存 {count} 条", file=sys.stderr)
        except (GitHubAPIError, MiniMaxAPIError, ValueError) as error:
            print(f"[watch] 第 {round_number} 轮失败：{error}", file=sys.stderr)
        round_number += 1
        time.sleep(watch_interval)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="使用 GitHub PAT 采集 GitHub 搜索或最新公开仓库数据")
    parser.add_argument("--event-query", action="append", dest="keyword", metavar="EVENT_QUERY", help="候选事件标题或 GitHub 搜索表达式，可重复传入")
    parser.add_argument("--discover-latest", action="store_true", help="不使用旧词表文件，抓取最近活跃的公开仓库")
    parser.add_argument(
        "-t",
        "--type",
        action="append",
        choices=sorted(SEARCH_PATHS),
        dest="search_types",
        help="搜索类型，可重复传入；默认 repositories",
    )
    parser.add_argument("-o", "--output", type=Path, help="输出路径；默认按格式写入 output/results.*")
    parser.add_argument("--format", choices=["jsonl", "csv"], default="jsonl", dest="output_format")
    parser.add_argument("--max-results", type=int, default=1000, help="普通模式下每个事件复核表达式、每种类型最多采集数量")
    parser.add_argument("--per-page", type=int, default=100, help="每页数量，范围 1-100")
    parser.add_argument("--sort", help="可选 GitHub 排序字段；不同搜索类型支持的字段不同")
    parser.add_argument("--order", choices=["asc", "desc"], default="desc")
    exhaustive_group = parser.add_mutually_exclusive_group()
    exhaustive_group.add_argument(
        "--exhaustive",
        action="store_true",
        default=None,
        help="尽可能完整地采集仓库：按创建日期自动拆分查询并去重",
    )
    exhaustive_group.add_argument(
        "--no-exhaustive",
        action="store_false",
        dest="exhaustive",
        help="关闭仓库自动分片，仅采集 --max-results 指定的数量",
    )
    parser.add_argument("--start-date", type=date.fromisoformat, help="大批量模式起始日期，格式 YYYY-MM-DD")
    parser.add_argument("--end-date", type=date.fromisoformat, help="大批量模式结束日期，格式 YYYY-MM-DD")
    parser.add_argument("--check-token", action="store_true", help="仅验证 PAT 并显示账号，不执行采集")
    parser.add_argument("--clean-file", type=Path, help="原地清洗已有 JSONL 文件中的 content 字段")
    parser.add_argument(
        "--content-max-length",
        type=int,
        default=500,
        help="简介最大字符数，默认 500；设为 0 表示不截断",
    )
    parser.add_argument(
        "--strict-event-match",
        action="store_true",
        dest="strict_keyword_match",
        help="仅保留仓库名、URL 或简介中直接包含完整事件复核表达式的结果，可能误删语义相关结果",
    )
    parser.add_argument(
        "--exclude-url",
        action="append",
        default=[],
        help="排除指定仓库 URL，可重复传入",
    )
    parser.add_argument("--monitor-regions", action="store_true", help="监控港澳台相关新结果，并调用 MiniMax 分析")
    parser.add_argument(
        "--region",
        action="append",
        choices=sorted(REGION_TERMS),
        help="监控指定地区，可重复传入；默认 hong_kong、macau、taiwan 全部启用",
    )
    parser.add_argument("--state-file", type=Path, default=Path("output/seen-records.txt"), help="已处理结果 ID 状态文件")
    parser.add_argument("--minimax-api-key", help="MiniMax API Key；普通版可用 MINIMAX_API_KEY，国际版可用 MINIMAX_INTL_API_KEY")
    parser.add_argument("--minimax-api-url", default=os.getenv("MINIMAX_API_URL", DEFAULT_MINIMAX_API_URL))
    parser.add_argument("--minimax-model", default=os.getenv("MINIMAX_MODEL", DEFAULT_MINIMAX_MODEL))
    parser.add_argument("--push-webhook-url", help="新增结果推送 webhook；也可使用 PUSH_WEBHOOK_URL")
    parser.add_argument("--mattermost-server-url", help="兼容旧参数；现在使用 OpenCrow Kan 推送入口。")
    parser.add_argument("--mattermost-bot-token", help="兼容旧参数；OpenCrow 鉴权请使用 OPENCROW_KAN_PUSH_TOKEN。")
    parser.add_argument("--mattermost-channel-id", help="Kan 频道 ID；也可使用 MATTERMOST_CHANNEL_ID。")
    parser.add_argument("--push-all", action="store_true", help="推送所有新增分析结果；默认只推送判断为 yes 的结果")
    parser.add_argument(
        "--continue-on-analysis-error",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="MiniMax 分析失败时仍保存结果，并把失败原因写入 reason；默认开启",
    )
    parser.add_argument(
        "--query-batch-size",
        type=int,
        default=20,
        help="监控模式每次最多处理的扩展查询数量；设为 0 表示处理全部",
    )
    parser.add_argument("--debug-monitor", action="store_true", help="打印监控结果被跳过或保存的原因")
    parser.add_argument("--watch", action="store_true", help="常驻监听，循环执行监控而不是运行一轮后退出")
    parser.add_argument("--watch-interval", type=float, default=300.0, help="常驻监听每轮间隔秒数，默认 300")
    parser.add_argument("--list-pending-sensitive", action="store_true", help="只查看待确认的 output new_sensitive 结果，不发送")
    parser.add_argument("--send-pending-sensitive", action="store_true", help="发送待确认的 output new_sensitive 结果")
    parser.add_argument("--pending-index", type=int, help="只发送 pending-sensitive.jsonl 中指定序号的结果，从 1 开始")
    parser.add_argument("--dotenv", type=Path, default=DEFAULT_DOTENV_FILE, help=".env 文件路径")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    load_dotenv(args.dotenv)
    if args.clean_file:
        count = clean_jsonl_file(args.clean_file, args.content_max_length)
        print(f"清洗完成：共处理 {count} 条数据，文件：{args.clean_file}")
        return 0
    if args.list_pending_sensitive:
        count = list_pending_sensitive(args.state_file, args.pending_index)
        print(f"待确认结果查看完成：{count} 条")
        return 0
    if args.send_pending_sensitive:
        count = send_pending_sensitive(
            args.state_file,
            args.push_webhook_url or os.getenv("PUSH_WEBHOOK_URL"),
            args.mattermost_server_url or os.getenv("OPENCROW_KAN_PUSH_URL"),
            args.mattermost_bot_token or os.getenv("MATTERMOST_BOT_TOKEN"),
            args.mattermost_channel_id or os.getenv("MATTERMOST_CHANNEL_ID"),
            args.pending_index,
        )
        print(f"待确认结果发送完成：{count} 条")
        return 0
    if args.max_results < 1:
        raise ValueError("--max-results 必须大于 0")
    if args.content_max_length < 0:
        raise ValueError("--content-max-length 不能小于 0")
    if not 1 <= args.per_page <= 100:
        raise ValueError("--per-page 必须在 1 到 100 之间")
    client = GitHubClient(
        token=os.getenv("GITHUB_TOKEN", ""),
        api_url=os.getenv("GITHUB_API_URL", DEFAULT_API_URL),
        api_version=os.getenv("GITHUB_API_VERSION", DEFAULT_API_VERSION),
        request_interval=float(os.getenv("GITHUB_REQUEST_INTERVAL", "1.0")),
    )
    if args.check_token:
        user = client.check_token()
        print(f"PAT 验证成功，当前账号：{user.get('login', '未知')}")
        return 0
    if args.discover_latest:
        output = args.output or Path(f"output/latest.{args.output_format}")
        records = collect_latest_records(
            client,
            args.max_results,
            args.per_page,
            args.sort,
            args.order,
            args.content_max_length,
        )
        count = write_records(records, output, args.output_format)
        print(f"最新公开仓库采集完成：共写入 {count} 条数据到 {output}")
        return 0
    keywords = list(dict.fromkeys(args.keyword or []))
    if args.monitor_regions:
        if not keywords:
            raise ValueError("监控区域模式需要通过 --event-query 传入候选事件复核表达式")
        analyzer = MiniMaxAnalyzer(
            api_key=minimax_api_key_for(args.minimax_api_url, args.minimax_api_key),
            api_url=args.minimax_api_url,
            model=args.minimax_model,
            trust_env=minimax_trust_env_for(args.minimax_api_url),
        )
        output_filename = f"region-alerts.{args.output_format}"
        output = args.output or dated_output_path(output_filename)
        monitor_kwargs = dict(
            client=client,
            analyzer=analyzer,
            keywords=keywords,
            search_types=args.search_types or ["repositories", "issues"],
            max_results=args.max_results,
            per_page=args.per_page,
            sort=args.sort,
            order=args.order,
            output=output,
            output_format=args.output_format,
            state_file=args.state_file,
            content_max_length=args.content_max_length,
            regions=args.region,
            webhook_url=args.push_webhook_url or os.getenv("PUSH_WEBHOOK_URL"),
            mattermost_server_url=args.mattermost_server_url or os.getenv("OPENCROW_KAN_PUSH_URL"),
            mattermost_bot_token=args.mattermost_bot_token or os.getenv("MATTERMOST_BOT_TOKEN"),
            mattermost_channel_id=args.mattermost_channel_id or os.getenv("MATTERMOST_CHANNEL_ID"),
            push_only_tendency=not args.push_all,
            continue_on_analysis_error=args.continue_on_analysis_error,
            query_batch_size=args.query_batch_size,
            debug_monitor=args.debug_monitor,
        )
        if args.watch:
            watch_region_records(
                **monitor_kwargs,
                watch_interval=args.watch_interval,
                output_filename=None if args.output else output_filename,
            )
            return 0
        count = monitor_region_records(
            **monitor_kwargs,
        )
        print(f"监控完成：新增保存 {count} 条分析结果到 {output}")
        return 0
    if not keywords:
        raise ValueError("事件复核模式需要传入 --event-query；自主发现请使用 --discover-latest")
    search_types = args.search_types or ["repositories"]
    exhaustive = args.exhaustive
    if exhaustive is None:
        exhaustive = search_types == ["repositories"]
    records = collect_records(
        client,
        keywords,
        search_types,
        args.max_results,
        args.per_page,
        args.sort,
        args.order,
        exhaustive,
        args.start_date,
        args.end_date,
        args.content_max_length,
        not args.strict_keyword_match,
        set(args.exclude_url),
    )
    output = args.output or Path(f"output/results.{args.output_format}")
    count = write_records(records, output, args.output_format)
    print(f"采集完成：共写入 {count} 条数据到 {output}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (GitHubAPIError, ValueError) as error:
        print(f"错误：{error}", file=sys.stderr)
        raise SystemExit(1)
