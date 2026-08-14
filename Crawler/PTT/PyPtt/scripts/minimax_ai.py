from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

import requests


DEFAULT_MINIMAX_API_URL = "https://api.minimax.io/v1"
DEFAULT_MINIMAX_MODEL = "MiniMax-M2.7"


class MiniMaxAPIError(RuntimeError):
    pass


def load_env_file(path: Path, override: bool = False) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if not key:
            continue
        if override or key not in os.environ:
            os.environ[key] = value


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


def compact_text(text: str, max_chars: int) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    if max_chars <= 0 or len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + "..."


class PTTMiniMaxAnalyzer:
    def __init__(
        self,
        api_key: str,
        api_url: str = DEFAULT_MINIMAX_API_URL,
        model: str = DEFAULT_MINIMAX_MODEL,
        timeout: float = 60.0,
        trust_env: bool = True,
        content_max_chars: int = 6000,
        max_comments: int = 40,
    ) -> None:
        if not api_key:
            raise ValueError("缺少 MiniMax API Key，请设置 MINIMAX_API_KEY / MINIMAX_INTL_API_KEY 或传入 --minimax-api-key")
        self.api_key = api_key
        self.api_url = api_url
        self.model = model
        self.timeout = timeout
        self.trust_env = trust_env
        self.content_max_chars = content_max_chars
        self.max_comments = max_comments

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

    def _article_payload(self, article: dict[str, Any]) -> dict[str, Any]:
        comments = article.get("comments") or []
        if not isinstance(comments, list):
            comments = []

        trimmed_comments = []
        for comment in comments[: self.max_comments]:
            if not isinstance(comment, dict):
                continue
            trimmed_comments.append(
                {
                    "type": comment.get("type"),
                    "author": comment.get("author"),
                    "content": compact_text(str(comment.get("content") or ""), 300),
                    "time": comment.get("time"),
                }
            )

        return {
            "matched_event_queries": article.get("matched_event_queries") or article.get("matched_keywords") or [],
            "board": article.get("board"),
            "title": article.get("title"),
            "url": article.get("url"),
            "author": article.get("author"),
            "date": article.get("date"),
            "content": compact_text(str(article.get("content") or ""), self.content_max_chars),
            "comments": trimmed_comments,
            "comment_count": len(comments),
        }

    def analyze(self, article: dict[str, Any]) -> dict[str, Any]:
        user_prompt = self._article_payload(article)
        request_payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "你是内容风控分析助手。请判断给定 PTT 文章及评论是否与命中的关键词相关，"
                        "以及是否存在反华、辱华、鼓吹分裂或其他明显政治敏感倾向。"
                        "只输出 JSON，不要输出额外文本。JSON 字段："
                        "anti_china_tendency，取值 yes/no/unclear；"
                        "confidence，0 到 1；"
                        "reason，简短中文理由；"
                        "evidence，简短列出触发判断的文章或评论片段。"
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(user_prompt, ensure_ascii=False),
                },
            ],
            "temperature": 0.1,
        }

        session = requests.Session()
        session.trust_env = self.trust_env

        response_payload: dict[str, Any] | None = None
        last_error: requests.RequestException | None = None
        for attempt in range(3):
            try:
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

        if response_payload is None:
            raise MiniMaxAPIError("MiniMax API 没有返回内容")

        message = self._extract_message(response_payload)
        message = re.sub(r"<think>.*?</think>", "", message, flags=re.DOTALL).strip()
        parsed = self._parse_json_message(message)

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
            "evidence": str(parsed.get("evidence", "")).strip(),
            "model": self.model,
        }

    @staticmethod
    def _parse_json_message(message: str) -> dict[str, Any]:
        try:
            parsed = json.loads(message)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

        match = re.search(r"\{.*\}", message, flags=re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group(0))
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                pass

        return {
            "anti_china_tendency": "unclear",
            "confidence": 0.0,
            "reason": f"MiniMax 返回内容无法解析为 JSON：{message[:200]}",
            "evidence": "",
        }
