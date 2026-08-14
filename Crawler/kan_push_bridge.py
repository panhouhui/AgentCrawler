from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Iterable
from urllib import error, request


DEFAULT_OPENCROW_KAN_PUSH_URL = "http://127.0.0.1:48080/api/kan-push/dispatch"


class KanPushError(RuntimeError):
    pass


def parse_channel_ids(value: str | Iterable[Any] | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return [str(item).strip() for item in value if str(item).strip()]


def opencrow_kan_push_url() -> str:
    return (
        os.getenv("OPENCROW_KAN_PUSH_URL")
        or os.getenv("OPENCROW_DISPATCH_URL")
        or DEFAULT_OPENCROW_KAN_PUSH_URL
    ).strip()


def opencrow_auth_token() -> str:
    return (
        os.getenv("OPENCROW_KAN_PUSH_TOKEN")
        or os.getenv("OPENCROW_WEB_TOKEN")
        or ""
    ).strip()


def dispatch_kan_message(
    *,
    platform: str,
    message: str,
    channel_ids: Iterable[Any] | None = None,
    route_id: str | None = None,
    source: str = "",
    dedupe_key: str = "",
    dry_run: bool = False,
    metadata: dict[str, Any] | None = None,
    auth_token: str | None = None,
    timeout: float = 30.0,
) -> dict[str, Any]:
    text = str(message or "").strip()
    if not text:
        raise KanPushError("Kan push message must not be empty")

    payload: dict[str, Any] = {
        "platform": platform,
        "message": text,
        "channelIds": parse_channel_ids(channel_ids),
        "source": source,
        "dedupeKey": dedupe_key,
        "dryRun": bool(dry_run),
        "metadata": metadata or {},
    }
    if route_id:
        payload["routeId"] = route_id

    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Accept": "application/json",
    }
    token = (auth_token or opencrow_auth_token()).strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = request.Request(
        opencrow_kan_push_url(),
        data=body,
        headers=headers,
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
    except error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise KanPushError(f"OpenCrow Kan push HTTP {exc.code}: {details}") from exc
    except error.URLError as exc:
        raise KanPushError(f"OpenCrow Kan push connection failed: {exc.reason}") from exc

    try:
        data = json.loads(raw) if raw else {}
    except json.JSONDecodeError as exc:
        raise KanPushError(f"OpenCrow Kan push returned invalid JSON: {raw[:300]}") from exc

    if not data.get("success", False):
        raise KanPushError(str(data.get("error") or "OpenCrow Kan push failed"))
    return data.get("data") or data


def dry_run_result(platform: str, channel_ids: Iterable[Any] | None = None) -> dict[str, Any]:
    channels = parse_channel_ids(channel_ids)
    return {
        "ok": True,
        "dryRun": True,
        "platform": platform,
        "channelCount": len(channels),
        "deliveries": [
            {
                "channelId": channel_id,
                "postId": "dry-run",
                "permalink": "",
                "skipped": True,
                "error": None,
            }
            for channel_id in channels
        ],
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
    }
