import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional, Sequence
from urllib import request

from pydantic import Field

from avtdl.core.actions import QueueAction, QueueActionConfig, QueueActionEntity
from avtdl.core.interfaces import Record
from avtdl.core.plugins import Plugins
from avtdl.core.request import HttpClient
from avtdl.core.runtime import RuntimeContext
from avtdl.plugins.filters.filters import load_patterns_file
from avtdl.plugins.mattermost.mattermost import load_env_file


DEFAULT_API_URL = 'https://api.minimax.io/v1'
DEFAULT_MODEL = 'MiniMax-M2.7'
AGENTHUB_ROOT = Path(os.getenv('AGENTHUB_ROOT', Path(__file__).resolve().parents[6]))


def minimax_api_key_for(env: Dict[str, str], api_url: str) -> str:
    if 'api.minimax.io' in api_url.casefold():
        return env.get('MINIMAX_INTL_API_KEY') or env.get('MINIMAX_API_KEY', '')
    return env.get('MINIMAX_API_KEY') or env.get('MINIMAX_INTL_API_KEY', '')


def minimax_trust_env_for(env: Dict[str, str], api_url: str) -> bool:
    configured = env.get('MINIMAX_TRUST_ENV')
    if configured is not None:
        return configured.strip().casefold() in {'1', 'true', 'yes', 'on'}
    return 'api.minimax.io' not in api_url.casefold()


def chat_url(api_url: str) -> str:
    api_url = api_url.rstrip('/')
    if api_url.endswith('/chat/completions') or api_url.endswith('/text/chatcompletion_v2'):
        return api_url
    return f'{api_url}/chat/completions'


def extract_message(payload: Dict[str, Any]) -> str:
    base_resp = payload.get('base_resp')
    if isinstance(base_resp, dict) and base_resp.get('status_code') not in {None, 0}:
        raise RuntimeError(f'MiniMax API error: {base_resp}')
    error = payload.get('error')
    if isinstance(error, dict):
        raise RuntimeError(f'MiniMax API error: {error}')
    choices = payload.get('choices')
    if isinstance(choices, list) and choices:
        message = choices[0].get('message')
        if isinstance(message, dict) and isinstance(message.get('content'), str):
            return message['content']
        text = choices[0].get('text')
        if isinstance(text, str):
            return text
    reply = payload.get('reply')
    if isinstance(reply, str):
        return reply
    return json.dumps(payload, ensure_ascii=False)


def parse_json_object(text: str) -> Dict[str, Any]:
    text = text.strip()
    if text.startswith('```'):
        text = text.strip('`')
        text = text.removeprefix('json').strip()
    start = text.find('{')
    if start > 0:
        text = text[start:]
    data, _ = json.JSONDecoder().raw_decode(text)
    if not isinstance(data, dict):
        raise ValueError('MiniMax response JSON is not an object')
    return data


def record_text(record: Record, limit: int = 1800) -> str:
    data = record.model_dump()
    interesting = {
        'title': data.get('title'),
        'summary': data.get('summary'),
        'author': data.get('author'),
        'published_text': data.get('published_text'),
        'url': data.get('url'),
    }
    text = json.dumps(interesting, ensure_ascii=False, default=str)
    return text[:limit]


def matched_keywords(record: Record, patterns: Sequence[str]) -> list[str]:
    text = record_text(record, limit=10000).casefold()
    found: list[str] = []
    for pattern in patterns:
        if pattern.casefold() in text and pattern not in found:
            found.append(pattern)
    return found


@Plugins.register('minimax.analyze', Plugins.kind.ASSOCIATED_RECORD)
class MiniMaxAnalysisRecord(Record):
    title: Optional[str] = None
    author: Optional[str] = None
    url: str
    video_id: Optional[str] = None
    matched_keywords: str
    push_reason: str
    ai_confidence: float

    def __str__(self) -> str:
        return f'{self.matched_keywords}\n{self.push_reason}\n{self.url}'

    def __repr__(self) -> str:
        return f'MiniMaxAnalysisRecord({self.video_id or self.url})'

    def get_uid(self) -> str:
        return self.video_id or self.url


@Plugins.register('minimax.analyze', Plugins.kind.ACTOR_CONFIG)
class MiniMaxAnalyzeConfig(QueueActionConfig):
    env_file: Path = AGENTHUB_ROOT / 'env' / 'Crawler_env' / 'YouTube_env'
    """path to .env containing MiniMax settings"""
    api_key_env: Optional[str] = None
    """optional explicit API key env name. If omitted, international API URL prefers MINIMAX_INTL_API_KEY"""
    api_url_env: str = 'MINIMAX_API_URL'
    model_env: str = 'MINIMAX_MODEL'
    default_api_url: str = DEFAULT_API_URL
    default_model: str = DEFAULT_MODEL
    timeout: float = 60.0


@Plugins.register('minimax.analyze', Plugins.kind.ACTOR_ENTITY)
class MiniMaxAnalyzeEntity(QueueActionEntity):
    keywords_file: Optional[Path] = None
    """optional event-filter file used to report matched terms to the model and final notification"""
    min_confidence: float = Field(default=0.65, ge=0, le=1)
    """minimum model confidence required to push"""


@Plugins.register('minimax.analyze', Plugins.kind.ACTOR)
class MiniMaxAnalyzeAction(QueueAction):
    """
    Ask MiniMax whether a keyword-matched YouTube video has anti-China tendency.
    Only records confirmed by the model are forwarded.
    """

    def __init__(self, conf: MiniMaxAnalyzeConfig, entities: Sequence[MiniMaxAnalyzeEntity], ctx: RuntimeContext):
        super().__init__(conf, entities, ctx)
        self.conf: MiniMaxAnalyzeConfig
        self.entities: Dict[str, MiniMaxAnalyzeEntity]  # type: ignore
        self.env = load_env_file(conf.env_file, self.logger)
        self.api_url = self.env.get(conf.api_url_env, conf.default_api_url)
        self.model = self.env.get(conf.model_env, conf.default_model)
        if conf.api_key_env:
            self.api_key = self.env.get(conf.api_key_env, '')
        else:
            self.api_key = minimax_api_key_for(self.env, self.api_url)
        self.trust_env = minimax_trust_env_for(self.env, self.api_url)
        self.patterns_by_entity = {
            entity.name: load_patterns_file(entity.keywords_file, self.logger) if entity.keywords_file else []
            for entity in entities
        }

    async def handle_single_record(self, logger: logging.Logger, client: HttpClient,
                                   entity: MiniMaxAnalyzeEntity, record: Record) -> None:
        try:
            analyzed = await self.analyze(entity, record)
        except Exception as e:
            logger.warning(f'[{entity.name}] MiniMax analysis failed for {record!r}: {type(e).__name__} {e}')
            return
        if analyzed is None:
            return
        self.on_record(entity, analyzed)

    async def analyze(self, entity: MiniMaxAnalyzeEntity, record: Record) -> Optional[Record]:
        if not self.api_key:
            self.logger.warning(f'[{entity.name}] MiniMax API key is missing, dropping record')
            return None

        keywords = matched_keywords(record, self.patterns_by_entity.get(entity.name, []))
        payload = self.build_payload(record, keywords)
        response = await asyncio.to_thread(self.call_minimax, payload)

        should_push = bool(response.get('should_push'))
        confidence = float(response.get('confidence') or 0)
        reason = str(response.get('reason') or '').strip()
        if not should_push or confidence < entity.min_confidence:
            self.logger.debug(
                f'[{entity.name}] AI rejected record {record!r}: should_push={should_push}, confidence={confidence}, reason={reason}'
            )
            return None

        original = record.model_dump()
        return MiniMaxAnalysisRecord(
            title=original.get('title'),
            author=original.get('author'),
            url=original.get('url'),
            video_id=original.get('video_id'),
            matched_keywords='、'.join(keywords) if keywords else '未明确返回',
            push_reason=reason,
            ai_confidence=confidence,
        )

    def build_payload(self, record: Record, keywords: Sequence[str]) -> Dict[str, Any]:
        user_prompt = {
            'matched_keywords': list(keywords),
            'youtube_record': json.loads(record.as_json()),
            'content_excerpt': record_text(record),
        }
        return {
            'model': self.model,
            'messages': [
                {
                    'role': 'system',
                    'content': (
                        '你是中文内容风险分析员。请判断给定 YouTube 视频是否不仅命中了关键词，'
                        '而且内容本身确实存在反华、辱华、分裂中国、煽动敌意或明显负面攻击中国/中国人的倾向。'
                        '只根据标题、频道、摘要、发布时间和链接等可见信息判断；证据不足时不要推送。'
                        '只输出 JSON 对象，不要输出额外文字。字段：'
                        'should_push(boolean), confidence(0到1), reason(中文，尽可能详细说明命中依据、语义判断和为什么应/不应推送)。'
                    ),
                },
                {'role': 'user', 'content': json.dumps(user_prompt, ensure_ascii=False)},
            ],
            'temperature': 0.1,
        }

    def call_minimax(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        req = request.Request(
            chat_url(self.api_url),
            headers={
                'Authorization': f'Bearer {self.api_key}',
                'Content-Type': 'application/json; charset=utf-8',
                'Accept': 'application/json',
            },
            data=data,
            method='POST',
        )
        opener = request.build_opener() if self.trust_env else request.build_opener(request.ProxyHandler({}))
        try:
            with opener.open(req, timeout=self.conf.timeout) as response:
                response_body = response.read().decode('utf-8')
                status = response.status
        except Exception as e:
            raise RuntimeError(f'MiniMax API request failed: {type(e).__name__} {e}') from e
        try:
            response_payload = json.loads(response_body)
        except ValueError as e:
            raise RuntimeError(f'MiniMax API returned non-JSON response: {response_body[:300]}') from e
        if status >= 400:
            raise RuntimeError(f'MiniMax API HTTP {status}: {response_payload}')
        message = extract_message(response_payload)
        return parse_json_object(message)
