#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Self-contained Telegram crawler tool for AI/tool calling.

It does not depend on the original project source code. Copy this folder to a
new machine, install requirements.txt, create a .env file, and run the tool.

Examples:
  python telegram_ai_tool.py list_dialogs
  python telegram_ai_tool.py crawl_dialogs --dialogs 123456,@channel --days 7
  echo {"action":"crawl_dialogs","dialogs":["123456"],"days":7} | python telegram_ai_tool.py --stdin
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib import error, request
from urllib.parse import unquote, urlparse

from telethon.sessions import StringSession
from telethon.sync import TelegramClient
from telethon.tl.types import Channel, Chat


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_ENV_PATH = Path(r"F:\AgentHub\env\Crawler_env\Telegram_env")
DEFAULT_PUSH_STATE_PATH = BASE_DIR / "telegram_push_state.json"
DEFAULT_OPENCROW_KAN_PUSH_URL = "http://127.0.0.1:48080/api/kan-push/dispatch"

if str(BASE_DIR.parent) not in sys.path:
    sys.path.insert(0, str(BASE_DIR.parent))

from kan_push_bridge import KanPushError, dispatch_kan_message


@dataclass
class TelegramConfig:
    api_id: int
    api_hash: str
    session: str
    proxy: str = ""


@dataclass
class MattermostConfig:
    url: str
    token: str
    channels: list[str]
    channel_map: dict[str, list[str]]


def json_print(data: dict[str, Any]) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except UnicodeDecodeError:
        lines = path.read_text(encoding="utf-8-sig", errors="ignore").splitlines()

    current_key = ""
    current_value_parts: list[str] = []

    def flush_current() -> None:
        nonlocal current_key, current_value_parts
        if current_key:
            value = "".join(current_value_parts).strip().strip('"').strip("'")
            os.environ.setdefault(current_key, value)
        current_key = ""
        current_value_parts = []

    for line in lines:
        raw = line.strip()
        if not raw or raw.startswith("#"):
            continue
        if "=" in raw:
            flush_current()
            key, value = raw.split("=", 1)
            current_key = key.strip()
            current_value_parts = [value.strip()]
        elif current_key:
            # Allows long TELEGRAM_SESSION strings split across multiple lines.
            current_value_parts.append(raw)
    flush_current()


def read_config(env_path: Path) -> TelegramConfig:
    load_env_file(env_path)
    try:
        api_id = int(os.environ.get("TELEGRAM_API_ID") or 0)
    except ValueError:
        api_id = 0
    api_hash = (os.environ.get("TELEGRAM_API_HASH") or "").strip()
    session = (os.environ.get("TELEGRAM_SESSION") or "").strip()
    proxy = (os.environ.get("TELEGRAM_PROXY") or "").strip()

    missing = []
    if not api_id:
        missing.append("TELEGRAM_API_ID")
    if not api_hash:
        missing.append("TELEGRAM_API_HASH")
    if not session:
        missing.append("TELEGRAM_SESSION")
    if missing:
        raise RuntimeError(f"missing Telegram config: {', '.join(missing)}")

    return TelegramConfig(api_id=api_id, api_hash=api_hash, session=session, proxy=proxy)


def read_mattermost_config(env_path: Path) -> MattermostConfig:
    load_env_file(env_path)
    url = (
        os.environ.get("OPENCROW_KAN_PUSH_URL")
        or DEFAULT_OPENCROW_KAN_PUSH_URL
    ).strip().rstrip("/")
    token = (
        os.environ.get("OPENCROW_KAN_PUSH_TOKEN")
        or os.environ.get("OPENCROW_WEB_TOKEN")
        or ""
    ).strip()
    channels = parse_dialogs(os.environ.get("MATTERMOST_CHANNEL_IDS") or "")
    channel_map = parse_channel_map(os.environ.get("TELEGRAM_MATTERMOST_CHANNEL_MAP") or "")

    missing = []
    if not url:
        missing.append("OPENCROW_KAN_PUSH_URL")
    if not channels:
        missing.append("MATTERMOST_CHANNEL_IDS")
    if missing:
        raise RuntimeError(f"missing OpenCrow Kan push config: {', '.join(missing)}")

    return MattermostConfig(url=url, token=token, channels=channels, channel_map=channel_map)


def read_push_dialogs(env_path: Path) -> list[str]:
    load_env_file(env_path)
    return parse_dialogs(os.environ.get("TELEGRAM_PUSH_DIALOGS") or "")


def parse_proxy_url(proxy_url: str) -> dict[str, Any] | None:
    raw = (proxy_url or "").strip()
    if not raw:
        return None

    parsed = urlparse(raw)
    scheme = (parsed.scheme or "").lower()
    if scheme not in ("socks5", "socks4", "http", "https"):
        raise ValueError("unsupported proxy scheme, use socks5/socks4/http/https")
    if not parsed.hostname or not parsed.port:
        raise ValueError("proxy must include host and port")

    proxy_type = "http" if scheme == "https" else scheme
    proxy: dict[str, Any] = {
        "proxy_type": proxy_type,
        "addr": parsed.hostname,
        "port": int(parsed.port),
        "rdns": True,
    }
    if parsed.username:
        proxy["username"] = unquote(parsed.username)
    if parsed.password:
        proxy["password"] = unquote(parsed.password)
    return proxy


def make_client(config: TelegramConfig) -> TelegramClient:
    return TelegramClient(
        StringSession(config.session),
        config.api_id,
        config.api_hash,
        proxy=parse_proxy_url(config.proxy) if config.proxy else None,
    )


def format_telegram_time(dt: datetime | None) -> str:
    if not dt:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def parse_telegram_time(value: str) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%dT%H:%M:%S.000Z").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def recent_threshold(days: int) -> datetime | None:
    days = int(days or 0)
    if days <= 0:
        return None
    return datetime.now(timezone.utc) - timedelta(days=days)


def today_start_utc() -> datetime:
    local_now = datetime.now().astimezone()
    local_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    return local_start.astimezone(timezone.utc)


def telegram_message_text(msg) -> str:
    text = (getattr(msg, "message", "") or "").strip()
    media = getattr(msg, "media", None)
    webpage = getattr(media, "webpage", None)
    preview_parts = []
    if webpage is not None:
        for attr in ("title", "description", "site_name"):
            val = (getattr(webpage, attr, "") or "").strip()
            if val and val not in preview_parts:
                preview_parts.append(val)
    if preview_parts:
        preview = "\n".join(preview_parts)
        if text and preview not in text:
            return f"{text}\n\nWebpage preview:\n{preview}"
        return preview or text
    return text


def sender_info(msg) -> dict[str, str]:
    sender = getattr(msg, "sender", None)
    username = getattr(sender, "username", "") or ""
    name = " ".join(
        x
        for x in [
            getattr(sender, "first_name", ""),
            getattr(sender, "last_name", ""),
        ]
        if x
    ) or username
    return {
        "sender_id": str(getattr(sender, "id", "") or ""),
        "sender_name": name,
        "sender_username": username,
    }


def dialog_matches(entity, target_set: set[str]) -> bool:
    if not target_set:
        return True
    entity_id = str(int(getattr(entity, "id", 0) or 0))
    username = (getattr(entity, "username", "") or "").strip().lower().lstrip("@")
    title = (getattr(entity, "title", "") or "").strip().lower()
    return entity_id in target_set or username in target_set or f"@{username}" in target_set or title in target_set


def message_to_row(msg) -> dict[str, Any] | None:
    if not msg:
        return None
    text = telegram_message_text(msg)
    if not text:
        return None
    chat = getattr(msg, "chat", None)
    if not isinstance(chat, (Channel, Chat)):
        return None

    chat_id = int(getattr(chat, "id", 0) or 0)
    msg_id = int(getattr(msg, "id", 0) or 0)
    username = getattr(chat, "username", "") or ""
    title = getattr(chat, "title", "") or ""
    url = f"https://t.me/{username}/{msg_id}" if username and msg_id else ""
    row: dict[str, Any] = {
        "dialog_id": str(chat_id),
        "dialog_title": title or username or str(chat_id),
        "dialog_username": username,
        "message_id": msg_id,
        "message_text": text,
        "message_time": format_telegram_time(getattr(msg, "date", None)),
        "message_url": url,
    }
    row.update(sender_info(msg))
    return row


def load_push_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"dialogs": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"dialogs": {}}
    if not isinstance(data, dict):
        return {"dialogs": {}}
    dialogs = data.get("dialogs")
    if not isinstance(dialogs, dict):
        data["dialogs"] = {}
    return data


def save_push_state(path: Path, state: dict[str, Any]) -> None:
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_channel_map(raw: str) -> dict[str, list[str]]:
    mapping: dict[str, list[str]] = {}
    for item in str(raw or "").replace("\n", ",").split(","):
        text = item.strip()
        if not text or ":" not in text:
            continue
        left, right = text.split(":", 1)
        dialog_id = left.strip().lower().lstrip("@")
        channels = [x.strip() for x in right.replace("|", "+").split("+") if x.strip()]
        if dialog_id and channels:
            mapping[dialog_id] = channels
    return mapping


def truncate_text(text: str, limit: int = 900) -> str:
    text = " ".join(str(text or "").split())
    if len(text) <= limit:
        return text
    return text[: max(limit - 3, 1)].rstrip() + "..."


def redact_sensitive_text(text: str) -> str:
    text = str(text or "")
    text = re.sub(r"(?<!\d)(1[3-9]\d{9})(?!\d)", lambda m: f"{m.group(1)[:3]}****{m.group(1)[-4:]}", text)
    text = re.sub(r"(?<!\d)(\d{17}[\dXx])(?!\d)", lambda m: f"{m.group(1)[:6]}********{m.group(1)[-4:]}", text)
    text = re.sub(r"(?<!\d)(\d{13,20})(?!\d)", lambda m: f"{m.group(1)[:4]}****{m.group(1)[-4:]}", text)

    def mask_email(match: re.Match[str]) -> str:
        local, domain = match.group(1), match.group(2)
        masked = local[:2] + "***" if len(local) > 2 else "***"
        return f"{masked}@{domain}"

    return re.sub(r"\b([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b", mask_email, text)


def query_terms(query: str) -> list[str]:
    text = str(query or "").strip().lower()
    if not text:
        return []
    raw_terms = re.findall(r"[\u3400-\u9fff]{2,}|[a-z0-9_#@.-]{3,}", text, flags=re.I)
    generic = {"http", "https", "www", "com", "事件", "消息", "内容", "平台"}
    terms: list[str] = []
    seen: set[str] = set()
    for term in raw_terms:
        if term in generic or term in seen:
            continue
        seen.add(term)
        terms.append(term)
        if re.fullmatch(r"[\u3400-\u9fff]+", term) and len(term) > 3:
            for index in range(0, len(term) - 1):
                gram = term[index : index + 2]
                if gram not in generic and gram not in seen:
                    seen.add(gram)
                    terms.append(gram)
    return terms[:12]


def text_matches_query(text: str, query: str) -> bool:
    terms = query_terms(query)
    if not terms:
        return True
    haystack = " ".join(str(text or "").lower().split())
    hits = sum(1 for term in terms if term in haystack)
    required = 2 if len(terms) >= 4 or len(query) >= 18 else 1
    return hits >= min(required, len(terms))


def chat_record_message(group: dict[str, Any], messages: list[dict[str, Any]]) -> str:
    title = group.get("dialog_title") or group.get("dialog_username") or group.get("dialog_id") or "Telegram"
    username = group.get("dialog_username") or ""
    header = f"### {title}"
    if username:
        header += f" (@{username})"
    lines = [
        header,
        f"> 新消息 {len(messages)} 条",
        "",
    ]
    for item in messages:
        sender = item.get("sender_name") or item.get("sender_username") or item.get("sender_id") or "未知用户"
        msg_time = item.get("message_time") or ""
        text = truncate_text(redact_sensitive_text(str(item.get("message_text") or "")))
        lines.append(f"**{sender}** {msg_time}")
        lines.append(text)
        url = item.get("message_url") or ""
        if url:
            lines.append(f"[查看原消息]({url})")
        lines.append("")
    return "\n".join(lines).strip()


def latest_message_ids(config: TelegramConfig, *, dialogs: list[str]) -> dict[str, int]:
    targets = {str(x).strip().lower().lstrip("@") for x in dialogs if str(x).strip()}
    latest: dict[str, int] = {}
    with make_client(config) as client:
        for dialog in client.iter_dialogs():
            entity = getattr(dialog, "entity", None)
            if not isinstance(entity, (Channel, Chat)):
                continue
            if targets and not dialog_matches(entity, targets):
                continue
            chat_id = str(int(getattr(entity, "id", 0) or 0))
            newest = 0
            for msg in client.iter_messages(entity, limit=1):
                newest = int(getattr(msg, "id", 0) or 0)
            if newest:
                latest[chat_id] = newest
    return latest


def list_dialogs(config: TelegramConfig, *, limit: int = 500) -> dict[str, Any]:
    dialogs: list[dict[str, Any]] = []
    with make_client(config) as client:
        for dialog in client.iter_dialogs(limit=limit):
            entity = getattr(dialog, "entity", None)
            if not isinstance(entity, (Channel, Chat)):
                continue
            is_group = bool(getattr(entity, "megagroup", False) or isinstance(entity, Chat))
            is_broadcast = bool(getattr(entity, "broadcast", False))
            if not (is_group or is_broadcast):
                continue
            dialogs.append(
                {
                    "id": str(int(getattr(entity, "id", 0) or 0)),
                    "title": getattr(entity, "title", "") or getattr(dialog, "name", "") or "",
                    "username": getattr(entity, "username", "") or "",
                    "type": "channel" if is_broadcast and not is_group else "group",
                }
            )

    dialogs.sort(key=lambda x: ((x.get("title") or x.get("username") or "").lower()))
    return {"ok": True, "action": "list_dialogs", "count": len(dialogs), "dialogs": dialogs}


def crawl_dialogs(
    config: TelegramConfig,
    *,
    dialogs: list[str],
    days: int = 1,
    max_results: int = 30,
    query: str = "",
) -> dict[str, Any]:
    targets = {str(x).strip().lower().lstrip("@") for x in dialogs if str(x).strip()}
    if not targets:
        raise RuntimeError("dialogs must not be empty")

    days = max(int(days or 1), 1)
    max_results = max(int(max_results or 30), 1)
    threshold = recent_threshold(days)
    per_dialog_limit = min(max(max_results, days * 500), 5000)
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()

    with make_client(config) as client:
        all_dialogs = list(client.iter_dialogs())
        for dialog in all_dialogs:
            entity = getattr(dialog, "entity", None)
            if not isinstance(entity, (Channel, Chat)):
                continue
            if not dialog_matches(entity, targets):
                continue
            for msg in client.iter_messages(entity, limit=per_dialog_limit):
                msg_time = getattr(msg, "date", None)
                if msg_time and msg_time.tzinfo is None:
                    msg_time = msg_time.replace(tzinfo=timezone.utc)
                if threshold is not None and msg_time is not None and msg_time < threshold:
                    break
                row = message_to_row(msg)
                if not row:
                    continue
                if query and not text_matches_query(str(row.get("message_text") or ""), query):
                    continue
                dedup = f"{row['dialog_id']}:{row['message_id']}"
                if dedup in seen:
                    continue
                seen.add(dedup)
                rows.append(row)
                if len(rows) >= max_results:
                    break
            if len(rows) >= max_results:
                break

    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        groups.setdefault(str(row["dialog_id"]), []).append(row)

    grouped = []
    for key, items in groups.items():
        items.sort(key=lambda x: str(x.get("message_time") or ""), reverse=True)
        first = items[0]
        grouped.append(
            {
                "dialog_id": key,
                "dialog_title": first.get("dialog_title") or key,
                "dialog_username": first.get("dialog_username") or "",
                "count": len(items),
                "messages": items,
            }
        )
    grouped.sort(key=lambda x: x["dialog_title"])

    return {
        "ok": True,
        "action": "crawl_dialogs",
        "days": days,
        "max_results": max_results,
        "scan_limit_per_dialog": per_dialog_limit,
        "requested_dialogs": sorted(targets),
        "query": query,
        "message_count": len(rows),
        "group_count": len(grouped),
        "groups": grouped,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


def push_telegram_updates_once(
    telegram_config: TelegramConfig,
    mattermost_config: MattermostConfig,
    *,
    dialogs: list[str],
    state_path: Path,
    max_results: int = 30,
    batch_size: int = 25,
    dry_run: bool = False,
    bootstrap: bool = True,
    reset_baseline: bool = False,
) -> dict[str, Any]:
    targets = parse_dialogs(dialogs)
    batch_size = max(int(batch_size or 25), 1)
    state = load_push_state(state_path)
    state_dialogs: dict[str, Any] = state.setdefault("dialogs", {})

    if reset_baseline or (bootstrap and not state_dialogs):
        latest = latest_message_ids(telegram_config, dialogs=targets)
        for dialog_id, message_id in latest.items():
            state_dialogs[dialog_id] = {"last_message_id": message_id}
        state["updated_at"] = datetime.now().isoformat(timespec="seconds")
        if not dry_run:
            save_push_state(state_path, state)
        return {
            "ok": True,
            "action": "push_telegram_updates",
            "bootstrapped": not reset_baseline,
            "reset_baseline": reset_baseline,
            "dry_run": dry_run,
            "dialog_count": len(latest),
            "pushed_group_count": 0,
            "pushed_message_count": 0,
            "groups": [],
            "state_path": str(state_path),
            "generated_at": datetime.now().isoformat(timespec="seconds"),
        }

    scan_limit = max(max_results, batch_size * 10)
    crawled = crawl_dialogs(telegram_config, dialogs=targets, days=1, max_results=scan_limit)
    pushed_groups = []
    pushed_message_count = 0
    pending_groups = []
    today_start = today_start_utc()

    for group in crawled.get("groups", []):
        dialog_id = str(group.get("dialog_id") or "")
        if not dialog_id:
            continue
        last_message_id = int(state_dialogs.get(dialog_id, {}).get("last_message_id") or 0)
        messages = [
            item
            for item in group.get("messages", [])
            if int(item.get("message_id") or 0) > last_message_id
            and (parse_telegram_time(str(item.get("message_time") or "")) or datetime.min.replace(tzinfo=timezone.utc)) >= today_start
        ]
        if not messages:
            continue
        messages.sort(key=lambda item: int(item.get("message_id") or 0))

        if len(messages) < batch_size:
            pending_groups.append(
                {
                    "dialog_id": dialog_id,
                    "dialog_title": group.get("dialog_title") or dialog_id,
                    "pending_message_count": len(messages),
                    "needed_message_count": batch_size - len(messages),
                }
            )
            continue

        channels = mattermost_config.channel_map.get(dialog_id) or mattermost_config.channels
        complete_batches = [messages[i : i + batch_size] for i in range(0, len(messages) - len(messages) % batch_size, batch_size)]
        for batch_index, batch in enumerate(complete_batches, start=1):
            message = chat_record_message(group, batch)
            first_id = min(int(item.get("message_id") or 0) for item in batch)
            newest_id = max(int(item.get("message_id") or 0) for item in batch)
            batch_key = f"{first_id}-{newest_id}"
            sent_batches = state_dialogs.setdefault(dialog_id, {}).setdefault("sent_batches", {})
            sent_channels = set(sent_batches.get(batch_key, []))
            remaining_channels = [channel for channel in channels if channel not in sent_channels]
            send_result = {
                "ok": True,
                "action": "mattermost_send_message",
                "channel_count": 0,
                "results": [],
                "skipped_channels": sorted(sent_channels),
            }
            if not dry_run:
                if remaining_channels:
                    send_result = {
                        "ok": True,
                        "action": "mattermost_send_message",
                        "channel_count": 0,
                        "results": [],
                        "skipped_channels": sorted(sent_channels),
                    }
                    for channel in remaining_channels:
                        single_result = mattermost_send_message(mattermost_config, message=message, channels=[channel])
                        send_result["results"].extend(single_result.get("results", []))
                        send_result["channel_count"] = len(send_result["results"])
                        sent_channels.add(channel)
                        sent_batches[batch_key] = sorted(sent_channels)
                        save_push_state(state_path, state)
                else:
                    send_result["channel_count"] = 0
            else:
                send_result["channel_count"] = len(remaining_channels)

            state_dialogs[dialog_id] = {
                "last_message_id": newest_id,
                "dialog_title": group.get("dialog_title") or "",
                "sent_batches": sent_batches,
                "updated_at": datetime.now().isoformat(timespec="seconds"),
            }
            pushed_message_count += len(batch)
            pushed_groups.append(
                {
                    "dialog_id": dialog_id,
                    "dialog_title": group.get("dialog_title") or dialog_id,
                    "batch_index": batch_index,
                    "message_count": len(batch),
                    "mattermost_channels": channels,
                    "preview": message,
                    "send_result": send_result,
                }
            )

        remainder = len(messages) % batch_size
        if remainder:
            pending_groups.append(
                {
                    "dialog_id": dialog_id,
                    "dialog_title": group.get("dialog_title") or dialog_id,
                    "pending_message_count": remainder,
                    "needed_message_count": batch_size - remainder,
                }
            )

    state["updated_at"] = datetime.now().isoformat(timespec="seconds")
    if not dry_run:
        save_push_state(state_path, state)

    return {
        "ok": True,
        "action": "push_telegram_updates",
        "bootstrapped": False,
        "dry_run": dry_run,
        "pushed_group_count": len(pushed_groups),
        "pushed_message_count": pushed_message_count,
        "batch_size": batch_size,
        "scan_limit": scan_limit,
        "pending_groups": pending_groups,
        "groups": pushed_groups,
        "state_path": str(state_path),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


def push_telegram_updates(
    telegram_config: TelegramConfig,
    mattermost_config: MattermostConfig,
    *,
    dialogs: list[str],
    state_path: Path,
    max_results: int = 30,
    batch_size: int = 25,
    interval: int = 0,
    dry_run: bool = False,
    bootstrap: bool = True,
    reset_baseline: bool = False,
) -> dict[str, Any]:
    if interval <= 0:
        return push_telegram_updates_once(
            telegram_config,
            mattermost_config,
            dialogs=dialogs,
            state_path=state_path,
            max_results=max_results,
            batch_size=batch_size,
            dry_run=dry_run,
            bootstrap=bootstrap,
            reset_baseline=reset_baseline,
        )

    runs = 0
    while True:
        runs += 1
        result = push_telegram_updates_once(
            telegram_config,
            mattermost_config,
            dialogs=dialogs,
            state_path=state_path,
            max_results=max_results,
            batch_size=batch_size,
            dry_run=dry_run,
            bootstrap=bootstrap,
            reset_baseline=reset_baseline,
        )
        json_print({"watch_run": runs, **result})
        sys.stdout.flush()
        bootstrap = False
        time.sleep(max(interval, 5))


def mattermost_api(
    config: MattermostConfig,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    raise RuntimeError(
        f"direct Mattermost API is disabled; use OpenCrow Kan push center instead ({method} {path})"
    )


def mattermost_channel_info(config: MattermostConfig, channel_id: str) -> dict[str, Any]:
    return {
        "id": channel_id,
        "name": "",
        "display_name": f"Kan 频道 {channel_id[:8]}",
        "type": "通过 OpenCrow 统一推送",
        "team_id": "",
    }


def mattermost_send_message(
    config: MattermostConfig,
    *,
    message: str,
    channels: list[str] | None = None,
) -> dict[str, Any]:
    message = str(message or "").strip()
    if not message:
        raise RuntimeError("message must not be empty")

    channel_ids = channels or config.channels
    results = []
    for channel_id in channel_ids:
        channel_id = str(channel_id).strip()
        if not channel_id:
            continue
        try:
            post = dispatch_kan_message(
                platform="telegram",
                route_id="telegram-kan",
                message=message,
                channel_ids=[channel_id],
                source="telegram_ai_tool",
                metadata={
                    "legacy_push_url": config.url,
                    "opencrow_token_configured": bool(config.token),
                },
                auth_token=config.token,
            )
        except KanPushError as exc:
            raise RuntimeError(str(exc)) from exc
        results.append(
            {
                "channel_id": channel_id,
                "post_id": (post.get("deliveries") or [{}])[0].get("postId") or "",
                "create_at": 0,
                "permalink": (post.get("deliveries") or [{}])[0].get("permalink") or "",
            }
        )

    return {
        "ok": True,
        "action": "opencrow_kan_send_message",
        "channel_count": len(results),
        "results": results,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


def mattermost_test_channels(config: MattermostConfig, *, send: bool = False, message: str = "") -> dict[str, Any]:
    channels = []
    for channel_id in config.channels:
        channels.append(mattermost_channel_info(config, channel_id))

    result: dict[str, Any] = {
        "ok": True,
        "action": "opencrow_kan_test_channels",
        "url": config.url,
        "channel_count": len(channels),
        "channels": channels,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }
    if send:
        test_message = message.strip() or f"OpenCrow Kan 推送测试成功：{datetime.now().isoformat(timespec='seconds')}"
        result["send_result"] = mattermost_send_message(config, message=test_message)
    return result


def parse_dialogs(raw: str | list[Any] | None) -> list[str]:
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()]
    text = str(raw or "").strip()
    if not text:
        return []
    return [x.strip() for x in text.split(",") if x.strip()]


def run_payload(payload: dict[str, Any], *, env_path: Path) -> dict[str, Any]:
    action = str(payload.get("action") or payload.get("tool") or "").strip().lower()
    if action == "list_dialogs":
        config = read_config(env_path)
        return list_dialogs(config, limit=int(payload.get("limit") or 500))
    if action == "crawl_dialogs":
        config = read_config(env_path)
        dialogs = parse_dialogs(payload.get("dialogs") or payload.get("dialog_ids")) or read_push_dialogs(env_path)
        if not dialogs:
            raise RuntimeError("dialogs must not be empty; set TELEGRAM_PUSH_DIALOGS or pass dialogs")
        return crawl_dialogs(
            config,
            dialogs=dialogs,
            days=int(payload.get("days") or payload.get("search_days") or 1),
            max_results=int(payload.get("max_results") or 30),
            query=str(payload.get("query") or payload.get("event_query") or ""),
        )
    if action in ("mattermost_test_channels", "test_mattermost"):
        config = read_mattermost_config(env_path)
        return mattermost_test_channels(
            config,
            send=bool(payload.get("send") or payload.get("post")),
            message=str(payload.get("message") or ""),
        )
    if action in ("mattermost_send_message", "send_mattermost"):
        config = read_mattermost_config(env_path)
        return mattermost_send_message(
            config,
            message=str(payload.get("message") or payload.get("text") or ""),
            channels=parse_dialogs(payload.get("channels") or payload.get("channel_ids")) or None,
        )
    if action in ("push_telegram_updates", "watch_and_push"):
        telegram_config = read_config(env_path)
        mattermost_config = read_mattermost_config(env_path)
        state_path = Path(str(payload.get("state") or payload.get("state_path") or DEFAULT_PUSH_STATE_PATH))
        push_dialogs = parse_dialogs(payload.get("dialogs") or payload.get("dialog_ids")) or read_push_dialogs(env_path)
        if not push_dialogs:
            raise RuntimeError("push dialogs must not be empty; set --dialogs or TELEGRAM_PUSH_DIALOGS")
        return push_telegram_updates(
            telegram_config,
            mattermost_config,
            dialogs=push_dialogs,
            state_path=state_path,
            max_results=int(payload.get("max_results") or 30),
            batch_size=int(payload.get("batch_size") or 25),
            interval=int(payload.get("interval") or 0),
            dry_run=bool(payload.get("dry_run")),
            bootstrap=not bool(payload.get("no_bootstrap")),
            reset_baseline=bool(payload.get("reset_baseline")),
        )
    raise RuntimeError("不支持的动作，请使用 list_dialogs、crawl_dialogs、mattermost_test_channels、mattermost_send_message 或 push_telegram_updates")


def main() -> int:
    parser = argparse.ArgumentParser(description="AI 可调用的 Telegram 爬虫与 OpenCrow Kan 推送工具")
    parser.add_argument(
        "action",
        nargs="?",
        choices=[
            "list_dialogs",
            "crawl_dialogs",
            "mattermost_test_channels",
            "mattermost_send_message",
            "push_telegram_updates",
        ],
    )
    parser.add_argument("--stdin", action="store_true", help="从标准输入读取 JSON 请求。")
    parser.add_argument("--dialogs", default="", help="逗号分隔的 Telegram 会话 ID 或用户名。")
    parser.add_argument("--channels", default="", help="逗号分隔的 Kan 频道 ID。")
    parser.add_argument("--message", default="", help="Kan 推送消息文本。")
    parser.add_argument("--query", default="", help="按候选事件标题或摘要过滤消息。")
    parser.add_argument("--send", action="store_true", help="执行 Kan 测试推送。")
    parser.add_argument("--dry-run", action="store_true", help="只预览推送内容，不发送到 Kan。")
    parser.add_argument("--no-bootstrap", action="store_true", help="不要把当前最新消息初始化为基线。")
    parser.add_argument("--reset-baseline", action="store_true", help="重置为当前最新 Telegram 消息，不发送。")
    parser.add_argument("--interval", type=int, default=0, help="大于 0 时每 N 秒重复扫描推送。")
    parser.add_argument("--state", default=str(DEFAULT_PUSH_STATE_PATH), help="推送去重状态 JSON 文件路径。")
    parser.add_argument("--batch-size", type=int, default=25, help="会话当天新增消息达到 N 条后才推送。")
    parser.add_argument("--days", type=int, default=1)
    parser.add_argument("--max-results", type=int, default=30)
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--env", default=str(DEFAULT_ENV_PATH), help="环境配置文件路径。")
    args = parser.parse_args()

    try:
        if args.stdin:
            payload = json.loads(sys.stdin.read() or "{}")
        else:
            payload = {
                "action": args.action,
                "dialogs": parse_dialogs(args.dialogs),
                "channels": parse_dialogs(args.channels),
                "message": args.message,
                "query": args.query,
                "send": args.send,
                "dry_run": args.dry_run,
                "no_bootstrap": args.no_bootstrap,
                "reset_baseline": args.reset_baseline,
                "interval": args.interval,
                "state": args.state,
                "batch_size": args.batch_size,
                "days": args.days,
                "max_results": args.max_results,
                "limit": args.limit,
            }
        result = run_payload(payload, env_path=Path(args.env))
        json_print(result)
        return 0
    except Exception as exc:
        json_print({"ok": False, "error": str(exc)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
