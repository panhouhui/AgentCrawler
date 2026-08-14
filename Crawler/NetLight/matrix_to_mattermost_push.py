#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
把 Matrix 抓取结果交给 OpenCrow 统一推送到 Kan。

使用前填写：
  OPENCROW_KAN_PUSH_URL
  MATTERMOST_CHANNEL_ID
  MIMO_API_KEY，用于藏语语音转文字和中文翻译

运行示例：
  python matrix_to_mattermost_push.py --dry-run
  python matrix_to_mattermost_push.py --limit 5
  python matrix_to_mattermost_push.py --download-media --matrix-token "Matrix访问令牌"
  python matrix_to_mattermost_push.py --download-media --transcribe-audio --translate-audio
"""

import argparse
import json
import mimetypes
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import quote

import requests
import time

from matrix_message_fetcher import (
    CENTRAL_ENV_PATH,
    extract_room_timeline_events,
    join_room as matrix_join_room,
    load_env_file,
    login as matrix_login,
    parse_message_event,
    sync_once,
)

CRAWLER_ROOT = Path(__file__).resolve().parents[1]
if str(CRAWLER_ROOT) not in sys.path:
    sys.path.insert(0, str(CRAWLER_ROOT))

from kan_push_bridge import KanPushError, dispatch_kan_message

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

load_env_file(CENTRAL_ENV_PATH)


MATTERMOST_BASE_URL = os.getenv("OPENCROW_KAN_PUSH_URL", "http://127.0.0.1:48080/api/kan-push/dispatch")
MATTERMOST_BOT_TOKEN = os.getenv("OPENCROW_KAN_PUSH_TOKEN", os.getenv("OPENCROW_WEB_TOKEN", ""))
# Mattermost API 要用“编号”，不是“通道句柄”。
MATTERMOST_CHANNEL_ID = os.getenv("MATTERMOST_CHANNEL_ID", "")

MATRIX_SERVER = os.getenv("MATRIX_SERVER", "https://keanu.im")
MIMO_BASE_URL = os.getenv("MIMO_BASE_URL", "https://token-plan-cn.xiaomimimo.com/v1")
MIMO_API_KEY = os.getenv("MIMO_API_KEY", "")
MIMO_ASR_MODEL = os.getenv("MIMO_ASR_MODEL", "mimo-v2.5-asr")
MIMO_TRANSLATE_MODEL = os.getenv("MIMO_TRANSLATE_MODEL", "mimo-v2.5-pro")
MIMO_ASR_LANGUAGE = os.getenv("MIMO_ASR_LANGUAGE", "zh")

PROJECT_DIR = Path(__file__).resolve().parent
DEFAULT_INPUT_FILE = str(PROJECT_DIR / "matrix_messages" / "all_messages.json")
DEFAULT_STATE_FILE = str(PROJECT_DIR / "matrix_messages" / "mattermost_push_state.json")
DEFAULT_AUDIO_TRANSLATION_CACHE = str(PROJECT_DIR / "matrix_messages" / "audio_translations.json")

REQUEST_TIMEOUT = 40
RETENTION_DAYS = 7
BATCH_SIZE = 10


def check_mattermost_config():
    if not MATTERMOST_CHANNEL_ID or MATTERMOST_CHANNEL_ID.startswith("在这里填写"):
        raise ValueError("请先填写 MATTERMOST_CHANNEL_ID")


def load_state(path):
    state_path = Path(path)
    if not state_path.exists():
        return {"pushed_event_ids": {}, "matrix_sync_token": "", "pending_batch": []}
    with state_path.open("r", encoding="utf-8") as f:
        state = json.load(f)
    state.setdefault("pushed_event_ids", {})
    state.setdefault("matrix_sync_token", "")
    state.setdefault("pending_batch", [])
    return state


def save_state(path, state):
    state_path = Path(path)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    with state_path.open("w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def load_json_file(path, default):
    json_path = Path(path)
    if not json_path.exists():
        return default
    with json_path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json_file(path, data):
    json_path = Path(path)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    with json_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def mimo_configured(api_key):
    return bool(api_key) and not api_key.startswith("在这里填写")


def mimo_url(path):
    base_url = MIMO_BASE_URL.rstrip("/")
    if base_url.endswith("/v1"):
        return f"{base_url}{path}"
    return f"{base_url}/v1{path}"


def now_ms():
    return int(time.time() * 1000)


def cutoff_ms(retention_days=RETENTION_DAYS):
    return now_ms() - retention_days * 24 * 60 * 60 * 1000


def is_recent_message(msg, retention_days=RETENTION_DAYS):
    return int(msg.get("timestamp") or 0) >= cutoff_ms(retention_days)


def normalize_pushed_value(value):
    if isinstance(value, dict):
        return value
    return {"post_id": value, "timestamp": 0, "kind": ""}


def cleanup_state(state, retention_days=RETENTION_DAYS):
    cutoff = cutoff_ms(retention_days)
    pushed = state.setdefault("pushed_event_ids", {})

    for event_id, value in list(pushed.items()):
        normalized = normalize_pushed_value(value)
        timestamp = int(normalized.get("timestamp") or 0)
        if timestamp and timestamp < cutoff:
            del pushed[event_id]
        else:
            pushed[event_id] = normalized

    state["pending_batch"] = [
        msg for msg in state.get("pending_batch", [])
        if is_recent_message(msg, retention_days)
    ]


def backfill_state_metadata(state, messages):
    by_event_id = {
        msg.get("event_id"): msg
        for msg in messages
        if msg.get("event_id")
    }
    pushed = state.setdefault("pushed_event_ids", {})

    for event_id, value in list(pushed.items()):
        normalized = normalize_pushed_value(value)
        if int(normalized.get("timestamp") or 0):
            pushed[event_id] = normalized
            continue

        msg = by_event_id.get(event_id)
        if msg:
            normalized["timestamp"] = int(msg.get("timestamp") or 0)
            normalized["kind"] = msg.get("kind", "")
        pushed[event_id] = normalized


def drop_unknown_legacy_state(state, messages):
    known_event_ids = {
        msg.get("event_id")
        for msg in messages
        if msg.get("event_id")
    }
    pushed = state.setdefault("pushed_event_ids", {})
    for event_id, value in list(pushed.items()):
        normalized = normalize_pushed_value(value)
        if not int(normalized.get("timestamp") or 0) and event_id not in known_event_ids:
            del pushed[event_id]


def cleanup_local_cache(retention_days=RETENTION_DAYS):
    cutoff_seconds = time.time() - retention_days * 24 * 60 * 60
    for folder in (PROJECT_DIR / "matrix_messages" / "audio", PROJECT_DIR / "matrix_messages" / "images"):
        if not folder.exists():
            continue
        for path in folder.rglob("*"):
            if path.is_file() and path.stat().st_mtime < cutoff_seconds:
                try:
                    path.unlink()
                except OSError as exc:
                    print(f"[WARN] 删除过期缓存失败: {path} - {exc}")


def cleanup_audio_translation_cache(cache_path, retention_days=RETENTION_DAYS):
    cache = load_json_file(cache_path, {})
    cutoff = cutoff_ms(retention_days)
    changed = False

    for event_id, item in list(cache.items()):
        timestamp = int(item.get("timestamp") or 0)
        if timestamp and timestamp < cutoff:
            del cache[event_id]
            changed = True

    if changed:
        save_json_file(cache_path, cache)


def prune_matrix_json_file(path, retention_days=RETENTION_DAYS):
    input_path = Path(path)
    if not input_path.exists():
        return

    with input_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    changed = False
    for key in ("text", "image", "audio"):
        old_items = data.get(key, [])
        new_items = [msg for msg in old_items if is_recent_message(msg, retention_days)]
        if len(new_items) != len(old_items):
            changed = True
        data[key] = new_items

    data["total"] = sum(len(data.get(key, [])) for key in ("text", "image", "audio"))

    if changed:
        with input_path.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"[OK] 已清理超过 {retention_days} 天的历史 JSON 数据")


def load_matrix_messages(path, retention_days=RETENTION_DAYS):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    messages = []
    for msg in data.get("text", []):
        item = dict(msg)
        item["kind"] = "text"
        messages.append(item)
    for msg in data.get("image", []):
        item = dict(msg)
        item["kind"] = "image"
        messages.append(item)
    for msg in data.get("audio", []):
        item = dict(msg)
        item["kind"] = "audio"
        messages.append(item)

    if retention_days is not None:
        messages = [msg for msg in messages if is_recent_message(msg, retention_days)]
    messages.sort(key=lambda x: x.get("timestamp", 0))
    return messages


def size_to_text(size):
    try:
        size = int(size)
    except (TypeError, ValueError):
        return "未知"
    if size <= 0:
        return "未知"
    if size < 1024 * 1024:
        return f"{size / 1024:.2f} KB"
    return f"{size / 1024 / 1024:.2f} MB"


def clean_filename(name, fallback):
    name = name or fallback
    name = re.sub(r'[\\/:*?"<>|]+', "_", name)
    return name.strip() or fallback


def ext_from_message(msg):
    body = (msg.get("body") or "").lower()
    mimetype = (msg.get("mimetype") or "").lower()

    for ext in ("png", "jpg", "jpeg", "gif", "webp", "mp3", "ogg", "wav", "webm"):
        if f".{ext}" in body:
            return ext

    guessed = mimetypes.guess_extension(mimetype.split(";")[0])
    if guessed:
        return guessed.lstrip(".")

    return "bin"


def mxc_to_download_url(mxc_url):
    if not mxc_url.startswith("mxc://"):
        return mxc_url
    server_and_media = mxc_url.replace("mxc://", "", 1)
    server, media_id = server_and_media.split("/", 1)
    return f"{MATRIX_SERVER.rstrip('/')}/_matrix/media/v3/download/{quote(server)}/{quote(media_id)}"


def download_matrix_media(msg, matrix_token=None):
    mxc_url = msg.get("url", "")
    if not mxc_url:
        return None

    headers = {}
    if matrix_token:
        headers["Authorization"] = f"Bearer {matrix_token}"

    download_url = mxc_to_download_url(mxc_url)
    ext = ext_from_message(msg)
    filename = clean_filename(msg.get("body"), f"matrix_media_{msg.get('event_id', 'unknown')}.{ext}")
    if "." not in Path(filename).name:
        filename = f"{filename}.{ext}"

    temp_dir = Path(tempfile.gettempdir()) / "matrix_to_mattermost"
    temp_dir.mkdir(parents=True, exist_ok=True)
    local_path = temp_dir / filename

    with requests.get(download_url, headers=headers, stream=True, timeout=REQUEST_TIMEOUT) as response:
        response.raise_for_status()
        with local_path.open("wb") as f:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)

    return str(local_path)


def convert_audio_for_mimo(file_path):
    source_path = Path(file_path)
    mime_type = mimetypes.guess_type(str(source_path))[0] or ""
    if mime_type in ("audio/wav", "audio/mpeg", "audio/mp3"):
        return str(source_path), mime_type

    target_path = source_path.with_suffix(".wav")
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(source_path),
        "-ac",
        "1",
        "-ar",
        "16000",
        str(target_path),
    ]
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return str(target_path), "audio/wav"


def transcribe_audio_mimo(file_path, api_key, model, language=MIMO_ASR_LANGUAGE):
    if not mimo_configured(api_key):
        raise RuntimeError("未配置 MIMO_API_KEY，无法做语音转文字")

    import base64

    audio_path, mime_type = convert_audio_for_mimo(file_path)
    with open(audio_path, "rb") as audio_file:
        audio_base64 = base64.b64encode(audio_file.read()).decode("utf-8")

    url = mimo_url("/chat/completions")
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": f"data:{mime_type};base64,{audio_base64}"
                        },
                    }
                ],
            }
        ],
        "asr_options": {
            "language": language,
        },
    }
    headers = {
        "api-key": api_key,
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    response = requests.post(url, headers=headers, json=payload, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    data = response.json()
    return data["choices"][0]["message"]["content"].strip()


def translate_to_chinese_mimo(text, api_key, model):
    if not text.strip():
        return ""
    if not mimo_configured(api_key):
        raise RuntimeError("未配置 MIMO_API_KEY，无法翻译成中文")

    url = mimo_url("/chat/completions")
    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "你是专业藏汉翻译。只输出中文译文，不要解释。",
            },
            {
                "role": "user",
                "content": text,
            },
        ],
        "temperature": 0.1,
    }
    headers = {
        "api-key": api_key,
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    response = requests.post(url, headers=headers, json=payload, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    data = response.json()
    return data["choices"][0]["message"]["content"].strip()


def enrich_audio_message(msg, local_path, args):
    if msg.get("kind") != "audio":
        return

    event_id = msg.get("event_id")
    if not event_id:
        return

    cache = load_json_file(args.audio_translation_cache, {})
    cached = cache.get(event_id)
    if cached:
        msg.update({
            "audio_transcript": cached.get("transcript", ""),
            "audio_translation_zh": cached.get("translation_zh", ""),
            "audio_process_error": cached.get("error", ""),
        })
        return

    transcript = ""
    translation_zh = ""
    errors = []

    if args.transcribe_audio:
        try:
            transcript = transcribe_audio_mimo(
                local_path,
                api_key=args.mimo_api_key,
                model=args.asr_model,
                language=args.asr_language,
            ).strip()
        except Exception as exc:
            errors.append(f"转写失败：{exc}")
    else:
        errors.append("未开启语音转写")

    if transcript and args.translate_audio:
        try:
            translation_zh = translate_to_chinese_mimo(
                transcript,
                api_key=args.mimo_api_key,
                model=args.translate_model,
            ).strip()
        except Exception as exc:
            errors.append(f"翻译失败：{exc}")
    elif transcript and not args.translate_audio:
        errors.append("未开启中文翻译")

    cache[event_id] = {
        "timestamp": int(msg.get("timestamp") or 0),
        "transcript": transcript,
        "translation_zh": translation_zh,
        "error": "；".join(errors),
    }
    save_json_file(args.audio_translation_cache, cache)

    msg["audio_transcript"] = transcript
    msg["audio_translation_zh"] = translation_zh
    msg["audio_process_error"] = "；".join(errors)


def upload_mattermost_file(file_path):
    raise RuntimeError(
        f"媒体文件已下载到本地，但 Kan 附件上传已收口到 OpenCrow，当前桥接模式只发送文本说明：{file_path}"
    )


def create_mattermost_post(message, file_ids=None):
    result = dispatch_kan_message(
        platform="netlight",
        route_id="netlight-kan",
        message=message,
        channel_ids=[MATTERMOST_CHANNEL_ID],
        source="matrix_to_mattermost_push",
        metadata={
            "file_ids": file_ids or [],
            "legacy_push_url": MATTERMOST_BASE_URL,
            "opencrow_token_configured": bool(MATTERMOST_BOT_TOKEN),
        },
        auth_token=MATTERMOST_BOT_TOKEN,
        timeout=REQUEST_TIMEOUT,
    )
    first_delivery = (result.get("deliveries") or [{}])[0]
    return {
        "id": first_delivery.get("postId") or result.get("routeId") or "",
        "opencrow_result": result,
    }


def mattermost_get(path):
    raise RuntimeError(f"直接 Kan API 检查已禁用，请在 OpenCrow 的 kan推送配置 页面查看：{path}")


def doctor(args):
    check_mattermost_config()
    print("[OK] OpenCrow Kan 推送入口已配置")
    print(f"[OK] 目标频道已配置: {MATTERMOST_CHANNEL_ID}")

    if args.dry_run:
        print("dry-run 模式，不发送测试消息")
        return

    result = create_mattermost_post("**[系统测试]**\nMatrix -> OpenCrow Kan 推送权限测试。")
    print(f"[OK] 测试消息发送成功: {result.get('id', '')}")


def format_message(msg):
    kind = msg.get("kind")
    time_text = msg.get("time", "未知时间")
    sender = msg.get("sender", "未知发送者")
    body = (msg.get("body") or "").strip()
    event_id = msg.get("event_id", "")

    if kind == "text":
        content = body or "空文本"
        return (
            "**[Matrix 文本]**\n"
            f"时间：{time_text}\n"
            f"发送者：`{sender}`\n"
            f"事件：`{event_id}`\n\n"
            f"> {content.replace(chr(10), chr(10) + '> ')}"
        )

    if kind == "image":
        return (
            "**[Matrix 图片]**\n"
            f"时间：{time_text}\n"
            f"发送者：`{sender}`\n"
            f"文件：{body or '未命名图片'}\n"
            f"大小：{size_to_text(msg.get('size'))}\n"
            f"事件：`{event_id}`"
        )

    if kind == "audio":
        return (
            "**[Matrix 语音]**\n"
            f"时间：{time_text}\n"
            f"发送者：`{sender}`\n"
            f"文件：{body or '未命名语音'}\n"
            f"大小：{size_to_text(msg.get('size'))}\n"
            f"类型：{msg.get('mimetype') or '未知'}\n"
            f"事件：`{event_id}`\n\n"
            "请点击附件播放或下载。"
        )

    return json.dumps(msg, ensure_ascii=False)


def short_body(text, max_len=260):
    text = (text or "").strip()
    if not text:
        return "空文本"
    text = " ".join(text.splitlines())
    if len(text) <= max_len:
        return text
    return text[:max_len] + "..."


def format_batch_message(messages, media_notes=None):
    media_notes = media_notes or {}
    counts = {
        "text": sum(1 for msg in messages if msg.get("kind") == "text"),
        "image": sum(1 for msg in messages if msg.get("kind") == "image"),
        "audio": sum(1 for msg in messages if msg.get("kind") == "audio"),
    }
    start_time = messages[0].get("time", "未知时间")
    end_time = messages[-1].get("time", "未知时间")

    lines = [
        "**Matrix 消息汇总**",
        f"时间范围：{start_time} - {end_time}",
        f"共 {len(messages)} 条：文本 {counts['text']}，图片 {counts['image']}，语音 {counts['audio']}",
        "",
        "---",
    ]

    attachment_index = 0
    for index, msg in enumerate(messages, 1):
        kind = msg.get("kind")
        sender = msg.get("sender", "未知发送者")
        time_text = msg.get("time", "未知时间")
        body = (msg.get("body") or "").strip()

        if kind == "text":
            lines.extend([
                f"{index}. **文本**  {time_text}",
                f"发送者：`{sender}`",
                f"> {short_body(body)}",
                "",
            ])
        elif kind == "image":
            attachment_index += 1
            note = media_notes.get(msg.get("event_id"), f"附件 {attachment_index}")
            lines.extend([
                f"{index}. **图片**  {time_text}",
                f"发送者：`{sender}`",
                f"文件：{body or '未命名图片'}",
                f"大小：{size_to_text(msg.get('size'))}",
                f"附件：{note}",
                "",
            ])
        elif kind == "audio":
            attachment_index += 1
            note = media_notes.get(msg.get("event_id"), f"附件 {attachment_index}")
            translation_zh = (msg.get("audio_translation_zh") or "").strip()
            transcript = (msg.get("audio_transcript") or "").strip()
            process_error = (msg.get("audio_process_error") or "").strip()
            lines.extend([
                f"{index}. **语音**  {time_text}",
                f"发送者：`{sender}`",
                f"文件：{body or '未命名语音'}",
                f"大小：{size_to_text(msg.get('size'))}",
                f"附件：{note}",
            ])
            if translation_zh:
                lines.append(f"中文翻译：{translation_zh}")
            if transcript:
                lines.append(f"藏语转写：{short_body(transcript, max_len=360)}")
            if process_error:
                lines.append(f"处理状态：{process_error}")
            lines.append("")

    return "\n".join(lines).strip()


def upload_media_for_batch(messages, args):
    file_ids = []
    media_notes = {}
    attachment_index = 0

    for msg in messages:
        if msg.get("kind") not in ("image", "audio"):
            continue

        attachment_index += 1
        event_id = msg.get("event_id")

        if args.dry_run:
            media_notes[event_id] = f"dry-run 未上传，原始地址 `{msg.get('url', '')}`"
            continue

        if not args.download_media:
            media_notes[event_id] = f"未上传，原始地址 `{msg.get('url', '')}`"
            continue

        try:
            local_path = download_matrix_media(msg, matrix_token=args.matrix_token)
            if local_path:
                enrich_audio_message(msg, local_path, args)
                file_ids.append(upload_mattermost_file(local_path))
                media_notes[event_id] = f"附件 {attachment_index}"
        except Exception as exc:
            media_notes[event_id] = f"上传失败，原始地址 `{msg.get('url', '')}`"
            print(f"[WARN] 媒体处理失败: {event_id} - {exc}")
            if msg.get("kind") == "audio":
                msg["audio_process_error"] = f"媒体下载或上传失败：{exc}"

    return file_ids, media_notes


def record_pushed_batch(state, messages, post_id):
    pushed = state.setdefault("pushed_event_ids", {})
    for msg in messages:
        pushed[msg.get("event_id")] = {
            "post_id": post_id,
            "timestamp": int(msg.get("timestamp") or 0),
            "kind": msg.get("kind", ""),
        }


def push_message_batch(messages, args):
    if not messages:
        return {"id": ""}

    file_ids, media_notes = upload_media_for_batch(messages, args)
    message = format_batch_message(messages, media_notes=media_notes)

    if args.dry_run:
        print("\n" + "-" * 60)
        print(message)
        if file_ids:
            print(f"附件 file_ids: {file_ids}")
        return {"id": "dry-run"}

    return create_mattermost_post(message, file_ids=file_ids)


def push_batch_with_retry(messages, args, retries=3):
    last_error = None
    for attempt in range(1, retries + 1):
        try:
            return push_message_batch(messages, args)
        except Exception as exc:
            last_error = exc
            print(f"[WARN] 批量推送失败，准备重试 {attempt}/{retries}: {exc}")
            time.sleep(min(2 * attempt, 10))
    raise last_error


def pending_event_ids(state):
    return {
        msg.get("event_id")
        for msg in state.get("pending_batch", [])
        if msg.get("event_id")
    }


def enqueue_message(state, msg):
    event_id = msg.get("event_id")
    if not event_id:
        return False
    if event_id in pending_event_ids(state):
        return False
    state.setdefault("pending_batch", []).append(msg)
    return True


def flush_full_batches(state, args):
    if args.dry_run:
        batch = state.get("pending_batch", [])[: args.batch_size]
        if batch:
            push_batch_with_retry(batch, args)
        return len(batch)

    pushed_count = 0
    while len(state.get("pending_batch", [])) >= args.batch_size:
        batch = state["pending_batch"][: args.batch_size]
        result = push_batch_with_retry(batch, args)
        record_pushed_batch(state, batch, result.get("id", ""))
        state["pending_batch"] = state["pending_batch"][args.batch_size:]
        save_state(args.state, state)
        pushed_count += len(batch)
        print(f"[OK] 已批量推送 {len(batch)} 条，Post ID: {result.get('id', '')}")
    return pushed_count


def push_one_message(msg, args):
    file_ids = []
    media_download_failed = False

    if msg.get("kind") in ("image", "audio") and args.download_media:
        try:
            local_path = download_matrix_media(msg, matrix_token=args.matrix_token)
            if local_path:
                file_ids.append(upload_mattermost_file(local_path))
        except Exception as exc:
            media_download_failed = True
            print(f"[WARN] 媒体处理失败，改为只发说明: {exc}")

    message = format_message(msg)
    if media_download_failed and msg.get("url"):
        message += f"\n\n媒体没有上传成功，原始 Matrix 地址：`{msg['url']}`"
    elif msg.get("kind") in ("image", "audio") and not args.download_media:
        message += f"\n\n原始 Matrix 地址：`{msg.get('url', '')}`"

    if args.dry_run:
        print("\n" + "-" * 60)
        print(message)
        if file_ids:
            print(f"附件 file_ids: {file_ids}")
        return {"id": "dry-run"}

    result = create_mattermost_post(message, file_ids=file_ids)
    return result


def push_one_message_with_retry(msg, args, retries=3):
    last_error = None
    for attempt in range(1, retries + 1):
        try:
            return push_one_message(msg, args)
        except Exception as exc:
            last_error = exc
            print(f"[WARN] 推送失败，准备重试 {attempt}/{retries}: {exc}")
            time.sleep(min(2 * attempt, 10))
    raise last_error


def matrix_event_to_push_message(event):
    msg = parse_message_event(event)
    if not msg:
        return None

    msg_type = msg.get("msgtype")
    if msg_type == "m.text":
        kind = "text"
    elif msg_type == "m.image":
        kind = "image"
    elif msg_type == "m.audio":
        kind = "audio"
    else:
        return None

    return {
        "kind": kind,
        "sender": msg.get("sender", ""),
        "event_id": msg.get("event_id", ""),
        "timestamp": msg.get("timestamp", 0),
        "time": msg.get("time", ""),
        "body": msg.get("body", ""),
        "url": msg.get("url", ""),
        "mimetype": msg.get("mimetype", ""),
        "size": msg.get("size", 0),
    }


def listen_and_push(args):
    check_mattermost_config()

    state = load_state(args.state)
    if Path(args.input).exists():
        known_messages = load_matrix_messages(args.input, retention_days=None)
        backfill_state_metadata(state, known_messages)
        drop_unknown_legacy_state(state, known_messages)
    cleanup_state(state, retention_days=args.retention_days)
    cleanup_local_cache(retention_days=args.retention_days)
    cleanup_audio_translation_cache(args.audio_translation_cache, retention_days=args.retention_days)
    pushed = state.setdefault("pushed_event_ids", {})

    access_token = args.matrix_token or matrix_login()
    if not access_token:
        raise RuntimeError("Matrix 登录失败，无法实时监听")

    args.matrix_token = access_token
    matrix_join_room(access_token)

    since = state.get("matrix_sync_token") or ""

    print("正在启动 Matrix 实时监听...")
    if since:
        print("[OK] 找到上次同步位置，将从上次位置继续")
    else:
        first_sync = sync_once(access_token, timeout_ms=0)
        since = first_sync.get("next_batch")
        events = extract_room_timeline_events(first_sync)
        print(f"启动时同步到 {len(events)} 条最近事件")

        for event in events:
            msg = matrix_event_to_push_message(event)
            if not msg or not is_recent_message(msg, args.retention_days):
                continue
            event_id = msg.get("event_id")
            if event_id in pushed:
                continue

            if enqueue_message(state, msg):
                print(f"[OK] 已加入待推送队列 {event_id}")

        state["matrix_sync_token"] = since
        save_state(args.state, state)
        flush_full_batches(state, args)

    print(f"[OK] 实时监听已启动。攒够 {args.batch_size} 条后自动汇总推送，按 Ctrl+C 停止。")

    while True:
        try:
            sync_data = sync_once(access_token, since=since)
            next_since = sync_data.get("next_batch", since)
            events = extract_room_timeline_events(sync_data)

            for event in events:
                msg = matrix_event_to_push_message(event)
                if not msg or not is_recent_message(msg, args.retention_days):
                    continue

                event_id = msg.get("event_id")
                if event_id in pushed:
                    continue

                if enqueue_message(state, msg):
                    print(f"[OK] 新消息已入队 {event_id}，当前 {len(state['pending_batch'])}/{args.batch_size}")

            flush_full_batches(state, args)
            since = next_since
            state["matrix_sync_token"] = since
            cleanup_state(state, retention_days=args.retention_days)
            save_state(args.state, state)

        except KeyboardInterrupt:
            print("\n实时监听已停止")
            break
        except Exception as exc:
            print(f"[WARN] 实时监听异常，5 秒后重试: {exc}")
            time.sleep(5)


def parse_args():
    parser = argparse.ArgumentParser(description="把 Matrix 消息交给 OpenCrow 统一推送到 Kan")
    parser.add_argument("--input", default=DEFAULT_INPUT_FILE, help="Matrix all_messages.json 路径")
    parser.add_argument("--state", default=DEFAULT_STATE_FILE, help="去重状态文件路径")
    parser.add_argument("--limit", type=int, default=0, help="最多推送多少条，0 表示不限")
    parser.add_argument("--kind", choices=["text", "image", "audio"], help="只推送指定类型")
    parser.add_argument("--listen", action="store_true", help="实时监听 Matrix 新消息，并交给 OpenCrow 推送")
    parser.add_argument("--doctor", action="store_true", help="检查 OpenCrow Kan 推送入口和频道配置")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE, help="攒够多少条再汇总推送，默认 10")
    parser.add_argument("--retention-days", type=int, default=RETENTION_DAYS, help="只保留最近多少天数据，默认 7")
    parser.add_argument("--flush-pending", action="store_true", help="强制推送不足 batch-size 的剩余队列")
    parser.add_argument("--transcribe-audio", action="store_true", help="语音先转写成藏文")
    parser.add_argument("--translate-audio", action="store_true", help="把语音转写结果翻译成中文")
    parser.add_argument("--mimo-api-key", default=MIMO_API_KEY, help="小米 MiMo API Key，也可用环境变量 MIMO_API_KEY")
    parser.add_argument("--asr-model", default=MIMO_ASR_MODEL, help="MiMo 语音转写模型")
    parser.add_argument("--asr-language", default=MIMO_ASR_LANGUAGE, choices=["zh", "en", "auto"], help="MiMo ASR 语言，只支持 zh/en/auto，默认 zh")
    parser.add_argument("--translate-model", default=MIMO_TRANSLATE_MODEL, help="MiMo 文本翻译模型")
    parser.add_argument("--audio-translation-cache", default=DEFAULT_AUDIO_TRANSLATION_CACHE, help="语音转写/翻译缓存文件")
    parser.add_argument("--dry-run", action="store_true", help="只打印，不真正推送")
    parser.add_argument("--download-media", action="store_true", help="下载图片/语音并在推送中保留处理说明")
    parser.add_argument("--matrix-token", default=os.getenv("MATRIX_ACCESS_TOKEN", ""), help="Matrix 媒体下载令牌，可用环境变量 MATRIX_ACCESS_TOKEN")
    parser.add_argument("--include-pushed", action="store_true", help="忽略去重状态，重新推送")
    return parser.parse_args()


def main():
    args = parse_args()

    if args.doctor:
        doctor(args)
        return

    if args.listen:
        listen_and_push(args)
        return

    if not args.dry_run:
        check_mattermost_config()

    all_known_messages = load_matrix_messages(args.input, retention_days=None)
    messages = [
        msg for msg in all_known_messages
        if is_recent_message(msg, args.retention_days)
    ]
    state = load_state(args.state)
    backfill_state_metadata(state, all_known_messages)
    drop_unknown_legacy_state(state, all_known_messages)
    prune_matrix_json_file(args.input, retention_days=args.retention_days)
    cleanup_state(state, retention_days=args.retention_days)
    cleanup_local_cache(retention_days=args.retention_days)
    cleanup_audio_translation_cache(args.audio_translation_cache, retention_days=args.retention_days)
    pushed = state.setdefault("pushed_event_ids", {})

    if args.download_media and not args.matrix_token:
        args.matrix_token = matrix_login() or ""

    pending = []
    for msg in messages:
        if args.kind and msg.get("kind") != args.kind:
            continue
        event_id = msg.get("event_id")
        if not args.include_pushed and event_id in pushed:
            continue
        if not is_recent_message(msg, args.retention_days):
            continue
        pending.append(msg)

    if args.limit > 0:
        pending = pending[: args.limit]

    print(f"待入队消息数: {len(pending)}")

    success = 0
    for msg in pending:
        event_id = msg.get("event_id")
        if enqueue_message(state, msg):
            success += 1
            print(f"[OK] 已入队 {event_id}")
            if not args.dry_run:
                save_state(args.state, state)

    try:
        flushed = flush_full_batches(state, args)
        if args.flush_pending and state.get("pending_batch"):
            batch = list(state["pending_batch"])
            result = push_batch_with_retry(batch, args)
            record_pushed_batch(state, batch, result.get("id", ""))
            state["pending_batch"] = []
            flushed += len(batch)
            print(f"[OK] 已强制推送剩余 {len(batch)} 条，Post ID: {result.get('id', '')}")
    except Exception as exc:
        print(f"[ERROR] 批量推送失败: {exc}", file=sys.stderr)
        flushed = 0

    if args.dry_run:
        print("\n当前是 dry-run，没有真正发送。")
    else:
        save_state(args.state, state)

    print(f"完成，入队: {success}，实际推送: {flushed}，队列剩余: {len(state.get('pending_batch', []))}")


if __name__ == "__main__":
    main()
