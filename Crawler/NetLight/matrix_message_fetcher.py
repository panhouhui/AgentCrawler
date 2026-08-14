"""
Matrix 聊天室消息获取脚本
功能：获取聊天室历史消息、文本、图片、语音
"""

import requests
import json
import os
import sys
import argparse
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

# ============ 配置 ============
CENTRAL_ENV_PATH = Path(r"F:\AgentHub\env\Crawler_env\NetLight_env")


def load_env_file(path):
    if not path.exists():
        return
    with path.open("r", encoding="utf-8-sig") as file:
        for line in file:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


load_env_file(CENTRAL_ENV_PATH)

MATRIX_SERVER = os.getenv("MATRIX_SERVER", "https://keanu.im")
ROOM_ID = os.getenv("MATRIX_ROOM_ID", "")
USERNAME = os.getenv("MATRIX_USERNAME", "")
PASSWORD = os.getenv("MATRIX_PASSWORD", "")

PROJECT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = str(PROJECT_DIR / "matrix_messages")
# ==============================

CLIENT_API = "/_matrix/client/v3"
MEDIA_API = "/_matrix/media/v3"
REQUEST_TIMEOUT = 35
SYNC_TIMEOUT_MS = 30000
RETENTION_DAYS = 7


def auth_headers(access_token):
    return {"Authorization": f"Bearer {access_token}"}


def room_id_for_url():
    return quote(ROOM_ID, safe="")


def ensure_output_dirs(output_dir):
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(f"{output_dir}/audio", exist_ok=True)
    os.makedirs(f"{output_dir}/images", exist_ok=True)


def format_matrix_time(timestamp):
    return datetime.fromtimestamp(timestamp / 1000).strftime("%Y-%m-%d %H:%M:%S")


def cutoff_timestamp_ms(retention_days=RETENTION_DAYS):
    return int((datetime.now().timestamp() - retention_days * 24 * 60 * 60) * 1000)

def login():
    """登录 Matrix 服务器"""
    url = f"{MATRIX_SERVER}{CLIENT_API}/login"
    data = {
        "type": "m.login.password",
        "identifier": {"type": "m.id.user", "user": USERNAME},
        "password": PASSWORD
    }
    
    response = requests.post(url, json=data, timeout=REQUEST_TIMEOUT)
    if response.status_code == 200:
        result = response.json()
        print(f"[OK] 登录成功: {result['user_id']}")
        return result['access_token']
    else:
        print(f"[ERROR] 登录失败: {response.status_code} - {response.text}")
        return None

def join_room(access_token):
    """加入聊天室"""
    url = f"{MATRIX_SERVER}{CLIENT_API}/join/{room_id_for_url()}"
    headers = auth_headers(access_token)
    
    response = requests.post(url, headers=headers, timeout=REQUEST_TIMEOUT)
    if response.status_code in (200, 403):
        if response.status_code == 403:
            print("[WARN] 加入房间失败，可能机器人已在房间内或没有加入权限，继续尝试读取")
            return True
        print(f"[OK] 已加入房间: {response.json()['room_id']}")
        return True
    else:
        print(f"[ERROR] 加入房间失败: {response.status_code}")
        return False

def get_messages(access_token, limit=100):
    """获取聊天室消息"""
    url = f"{MATRIX_SERVER}{CLIENT_API}/rooms/{room_id_for_url()}/messages"
    headers = auth_headers(access_token)
    params = {"dir": "b", "limit": limit}  # dir=b 表示获取较旧的消息
    
    response = requests.get(url, headers=headers, params=params, timeout=REQUEST_TIMEOUT)
    if response.status_code == 200:
        return response.json()
    else:
        print(f"[ERROR] 获取消息失败: {response.status_code}")
        return None

def download_media(media_url, filename, access_token=None):
    """下载媒体文件"""
    # 将 mxc:// URL 转换为下载 URL
    if media_url.startswith("mxc://"):
        server, media_id = media_url.replace("mxc://", "").split("/")
        download_url = f"{MATRIX_SERVER}{MEDIA_API}/download/{server}/{media_id}"
        headers = auth_headers(access_token) if access_token else {}
        
        try:
            response = requests.get(
                download_url,
                headers=headers,
                stream=True,
                timeout=REQUEST_TIMEOUT,
            )
            if response.status_code == 200:
                with open(filename, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)
                return True
        except Exception as e:
            print(f"  下载失败: {e}")
    return False


def parse_message_event(msg):
    """解析单条 Matrix 消息事件"""
    if msg.get("type") != "m.room.message":
        return None

    content = msg.get("content", {})
    msg_type = content.get("msgtype", "")
    timestamp = msg.get("origin_server_ts", 0)
    info = content.get("info", {})

    return {
        "sender": msg.get("sender", ""),
        "event_id": msg.get("event_id", ""),
        "timestamp": timestamp,
        "time": format_matrix_time(timestamp),
        "body": content.get("body", ""),
        "msgtype": msg_type,
        "url": content.get("url", ""),
        "mimetype": info.get("mimetype", content.get("mimetype", "")),
        "size": info.get("size", content.get("size", 0)),
    }


def get_file_ext(msg):
    """根据文件名和 mimetype 判断扩展名"""
    body = msg.get("body", "").lower()
    mimetype = msg.get("mimetype", "").lower()

    if ".png" in body or "png" in mimetype:
        return "png"
    if ".jpg" in body or ".jpeg" in body or "jpeg" in mimetype:
        return "jpg"
    if ".gif" in body or "gif" in mimetype:
        return "gif"
    if ".webp" in body or "webp" in mimetype:
        return "webp"
    if ".mp3" in body or "mpeg" in mimetype:
        return "mp3"
    if ".wav" in body or "wav" in mimetype:
        return "wav"
    return "ogg"


def append_live_message(msg, output_dir, access_token):
    """实时监听时，把新消息追加保存"""
    ensure_output_dirs(output_dir)
    msg_type = msg.get("msgtype", "")

    if msg_type == "m.text":
        target_file = f"{output_dir}/live_text_messages.txt"
        with open(target_file, "a", encoding="utf-8") as f:
            f.write(f"[{msg['time']}] {msg['sender']}: {msg['body']}\n")

    elif msg_type == "m.audio":
        target_file = f"{output_dir}/live_audio_messages.txt"
        with open(target_file, "a", encoding="utf-8") as f:
            f.write(f"[{msg['time']}] {msg['sender']} {msg['body']} {msg['url']}\n")

        if msg.get("url"):
            media_id = msg["url"].split("/")[-1]
            ext = get_file_ext(msg)
            filename = f"{output_dir}/audio/live_{msg['event_id'].strip('$')[:8]}_{media_id[:8]}.{ext}"
            download_media(msg["url"], filename, access_token=access_token)

    elif msg_type == "m.image":
        target_file = f"{output_dir}/live_image_messages.txt"
        with open(target_file, "a", encoding="utf-8") as f:
            f.write(f"[{msg['time']}] {msg['sender']} {msg['body']} {msg['url']}\n")

        if msg.get("url"):
            media_id = msg["url"].split("/")[-1]
            ext = get_file_ext(msg)
            filename = f"{output_dir}/images/live_{msg['event_id'].strip('$')[:8]}_{media_id[:8]}.{ext}"
            download_media(msg["url"], filename, access_token=access_token)

    else:
        target_file = f"{output_dir}/live_other_messages.txt"
        with open(target_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(msg, ensure_ascii=False) + "\n")


def sync_once(access_token, since=None, timeout_ms=SYNC_TIMEOUT_MS):
    """调用 Matrix /sync，支持长轮询"""
    url = f"{MATRIX_SERVER}{CLIENT_API}/sync"
    params = {"timeout": timeout_ms}
    if since:
        params["since"] = since

    response = requests.get(
        url,
        headers=auth_headers(access_token),
        params=params,
        timeout=(timeout_ms / 1000) + 60,
    )
    response.raise_for_status()
    return response.json()


def extract_room_timeline_events(sync_data):
    """从 /sync 返回里取当前房间的新消息事件"""
    joined_rooms = sync_data.get("rooms", {}).get("join", {})
    room_data = joined_rooms.get(ROOM_ID, {})
    return room_data.get("timeline", {}).get("events", [])


def listen_messages(access_token, output_dir, include_current=False):
    """实时监听房间新消息"""
    ensure_output_dirs(output_dir)
    print("\n正在启动实时监听...")

    first_sync = sync_once(access_token, timeout_ms=0)
    since = first_sync.get("next_batch")

    if include_current:
        for event in extract_room_timeline_events(first_sync):
            msg = parse_message_event(event)
            if msg:
                append_live_message(msg, output_dir, access_token)
                print(f"[{msg['time']}] {msg['sender']}: {msg['body']}")

    print("[OK] 监听已启动。按 Ctrl+C 停止。")

    seen_event_ids = set()
    while True:
        try:
            sync_data = sync_once(access_token, since=since)
            since = sync_data.get("next_batch", since)

            for event in extract_room_timeline_events(sync_data):
                msg = parse_message_event(event)
                if not msg:
                    continue

                event_id = msg.get("event_id")
                if event_id in seen_event_ids:
                    continue
                seen_event_ids.add(event_id)

                append_live_message(msg, output_dir, access_token)
                print(f"[{msg['time']}] {msg['sender']}: {msg['body']}")

        except KeyboardInterrupt:
            print("\n监听已停止")
            break
        except requests.HTTPError as e:
            status_code = e.response.status_code if e.response else "未知"
            print(f"同步失败，HTTP {status_code}，5 秒后重试")
            time.sleep(5)
        except Exception as e:
            print(f"同步异常：{e}，5 秒后重试")
            time.sleep(5)

def parse_messages(messages_data):
    """解析消息，返回分类统计"""
    stats = {
        "text": [],
        "audio": [],
        "image": [],
        "total": 0
    }
    
    for msg in messages_data.get("chunk", []):
        if msg.get("type") != "m.room.message":
            continue

        timestamp = msg.get("origin_server_ts", 0)
        if timestamp < cutoff_timestamp_ms():
            continue
            
        content = msg.get("content", {})
        msg_type = content.get("msgtype", "")
        sender = msg.get("sender", "")
        event_id = msg.get("event_id", "")
        body = content.get("body", "")
        
        stats["total"] += 1
        
        # 解析时间戳
        time_str = format_matrix_time(timestamp)
        
        msg_info = {
            "sender": sender,
            "event_id": event_id,
            "timestamp": timestamp,
            "time": time_str,
            "body": body
        }
        
        if msg_type == "m.text":
            stats["text"].append(msg_info)
        elif msg_type == "m.audio":
            msg_info["url"] = content.get("url", "")
            info = content.get("info", {})
            msg_info["mimetype"] = info.get("mimetype", content.get("mimetype", ""))
            msg_info["size"] = info.get("size", content.get("size", 0))
            stats["audio"].append(msg_info)
        elif msg_type == "m.image":
            msg_info["url"] = content.get("url", "")
            info = content.get("info", {})
            msg_info["mimetype"] = info.get("mimetype", content.get("mimetype", ""))
            msg_info["size"] = info.get("size", content.get("size", 0))
            stats["image"].append(msg_info)
    
    return stats

def save_messages_to_file(stats, output_dir, access_token=None, download_files=True):
    """保存消息到文件"""
    ensure_output_dirs(output_dir)
    
    # 保存文本消息
    with open(f"{output_dir}/text_messages.txt", "w", encoding="utf-8") as f:
        f.write("=" * 60 + "\n")
        f.write("Matrix 聊天室文本消息\n")
        f.write("=" * 60 + "\n\n")
        
        for i, msg in enumerate(stats["text"], 1):
            f.write(f"[{i}] 时间: {msg['time']}\n")
            f.write(f"    发送者: {msg['sender']}\n")
            f.write(f"    内容: {msg['body']}\n")
            f.write("-" * 40 + "\n")
    
    # 保存语音消息列表
    with open(f"{output_dir}/audio_messages.txt", "w", encoding="utf-8") as f:
        f.write("=" * 60 + "\n")
        f.write("Matrix 聊天室语音消息\n")
        f.write("=" * 60 + "\n\n")
        
        for i, msg in enumerate(stats["audio"], 1):
            f.write(f"[{i}] 时间: {msg['time']}\n")
            f.write(f"    发送者: {msg['sender']}\n")
            f.write(f"    文件名: {msg['body']}\n")
            f.write(f"    URL: {msg['url']}\n")
            f.write(f"    类型: {msg['mimetype']}\n")
            f.write(f"    大小: {msg['size'] / 1024:.2f} KB\n")
            f.write("-" * 40 + "\n")
            
            # 下载语音文件
            if download_files and msg.get("url"):
                media_id = msg["url"].replace("mxc://keanu.im/", "")
                filename = f"{output_dir}/audio/voice_{i}_{media_id[:8]}.ogg"
                if download_media(msg["url"], filename, access_token=access_token):
                    f.write(f"    [已下载] {filename}\n")
    
    # 保存图片消息列表
    with open(f"{output_dir}/image_messages.txt", "w", encoding="utf-8") as f:
        f.write("=" * 60 + "\n")
        f.write("Matrix 聊天室图片消息\n")
        f.write("=" * 60 + "\n\n")
        
        for i, msg in enumerate(stats["image"], 1):
            f.write(f"[{i}] 时间: {msg['time']}\n")
            f.write(f"    发送者: {msg['sender']}\n")
            f.write(f"    文件名: {msg['body']}\n")
            f.write(f"    URL: {msg['url']}\n")
            f.write(f"    类型: {msg['mimetype']}\n")
            f.write(f"    大小: {msg['size'] / 1024:.2f} KB\n")
            f.write("-" * 40 + "\n")
            
            # 下载图片
            if download_files and msg.get("url"):
                media_id = msg["url"].replace("mxc://keanu.im/", "")
                # 根据文件名判断扩展名
                body = msg.get("body", "")
                if ".png" in body.lower():
                    ext = "png"
                elif ".jpg" in body.lower() or ".jpeg" in body.lower():
                    ext = "jpg"
                elif ".gif" in body.lower():
                    ext = "gif"
                elif ".webp" in body.lower():
                    ext = "webp"
                else:
                    ext = "png"  # 默认 PNG
                filename = f"{output_dir}/images/image_{i}_{media_id[:8]}.{ext}"
                if download_media(msg["url"], filename, access_token=access_token):
                    f.write(f"    [已下载] {filename}\n")
    
    # 保存完整 JSON 数据
    with open(f"{output_dir}/all_messages.json", "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)

def parse_args():
    parser = argparse.ArgumentParser(description="Matrix 聊天室消息获取工具")
    parser.add_argument("--listen", action="store_true", help="实时监听新消息")
    parser.add_argument("--include-current", action="store_true", help="监听启动时也处理当前同步到的最近消息")
    parser.add_argument("--limit", type=int, default=100, help="抓取历史消息数量，默认 100")
    parser.add_argument("--output-dir", default=OUTPUT_DIR, help="输出目录")
    parser.add_argument("--no-download", action="store_true", help="只保存消息信息，不下载图片和语音文件")
    return parser.parse_args()


def main():
    args = parse_args()

    print("=" * 60)
    print("Matrix 聊天室消息获取工具")
    print("=" * 60)
    print()
    
    # 1. 登录
    access_token = login()
    if not access_token:
        sys.exit(1)
    
    # 2. 加入房间
    if not join_room(access_token):
        sys.exit(1)

    if args.listen:
        listen_messages(
            access_token,
            output_dir=args.output_dir,
            include_current=args.include_current,
        )
        return
    
    # 3. 获取消息
    print("\n正在获取消息...")
    messages_data = get_messages(access_token, limit=args.limit)
    if not messages_data:
        sys.exit(1)
    
    # 4. 解析消息
    stats = parse_messages(messages_data)
    
    print(f"\n消息统计:")
    print(f"  - 总消息数: {stats['total']}")
    print(f"  - 文本消息: {len(stats['text'])}")
    print(f"  - 语音消息: {len(stats['audio'])}")
    print(f"  - 图片消息: {len(stats['image'])}")
    
    # 5. 保存消息
    print(f"\n保存消息到 {args.output_dir}/...")
    save_messages_to_file(
        stats,
        args.output_dir,
        access_token=access_token,
        download_files=not args.no_download,
    )
    
    print("\n" + "=" * 60)
    print("完成！消息已保存到:")
    print(f"  - {args.output_dir}/text_messages.txt")
    print(f"  - {args.output_dir}/audio_messages.txt")
    print(f"  - {args.output_dir}/image_messages.txt")
    print(f"  - {args.output_dir}/all_messages.json")
    print(f"  - {args.output_dir}/audio/ (语音文件)")
    print(f"  - {args.output_dir}/images/ (图片文件)")
    print("=" * 60)

if __name__ == "__main__":
    main()
