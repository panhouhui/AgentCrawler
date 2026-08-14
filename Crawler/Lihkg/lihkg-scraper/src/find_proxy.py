import argparse
import concurrent.futures
import json
import random
import re
import time
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import requests

from scrape_category import DEFAULT_HEADERS, load_env_file


PROXY_SOURCES = [
    "https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/protocols/http/data.txt",
    "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt",
    "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt",
]
TEST_URL = "https://lihkg.com/api_v2/thread/category?cat_id=1&page=1&count=1&type=now"
PROXY_RE = re.compile(r"(?:(?:http|https)://)?(\d{1,3}(?:\.\d{1,3}){3}:\d{2,5})")
DEFAULT_ENV_FILE = r"F:\AgentHub\env\Crawler_env\Lihkg_env"


def load_cookie(env_path: Path) -> str:
    return load_env_file(env_path).get("LIHKG_COOKIE", "")


def normalize_proxy(value: str) -> Optional[str]:
    match = PROXY_RE.search(value)
    if not match:
        return None
    return "http://" + match.group(1)


def fetch_source(url: str, timeout: float) -> List[str]:
    response = requests.get(url, timeout=timeout, headers={"User-Agent": DEFAULT_HEADERS["User-Agent"]})
    response.raise_for_status()
    proxies = []
    for line in response.text.splitlines():
        proxy = normalize_proxy(line.strip())
        if proxy:
            proxies.append(proxy)
    return proxies


def fetch_candidates(sources: Iterable[str], timeout: float, limit: int) -> List[str]:
    candidates = []
    seen = set()
    for source in sources:
        try:
            for proxy in fetch_source(source, timeout):
                if proxy in seen:
                    continue
                seen.add(proxy)
                candidates.append(proxy)
        except requests.RequestException as exc:
            print(f"source failed: {source} error={exc}")

    random.shuffle(candidates)
    if limit > 0:
        candidates = candidates[:limit]
    return candidates


def test_proxy(proxy: str, cookie: str, timeout: float) -> Tuple[bool, Dict[str, object]]:
    headers = dict(DEFAULT_HEADERS)
    headers.update(
        {
            "Referer": "https://lihkg.com/category/1",
            "Origin": "https://lihkg.com",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Dest": "empty",
        }
    )
    if cookie:
        headers["Cookie"] = cookie

    started = time.time()
    result: Dict[str, object] = {"proxy": proxy}
    try:
        response = requests.get(
            TEST_URL,
            headers=headers,
            proxies={"http": proxy, "https": proxy},
            timeout=timeout,
        )
        elapsed_ms = int((time.time() - started) * 1000)
        result.update(
            {
                "status_code": response.status_code,
                "elapsed_ms": elapsed_ms,
                "retry_after": response.headers.get("Retry-After"),
            }
        )
        if response.status_code == 200:
            obj = response.json()
            items = obj.get("response", {}).get("items", [])
            result["items"] = len(items)
            if obj.get("success") != 1 or not items:
                return False, result

            thread_id = items[0].get("thread_id")
            detail_url = f"https://lihkg.com/api_v2/thread/{thread_id}/page/1?order=reply_time"
            detail_headers = dict(headers)
            detail_headers["Referer"] = f"https://lihkg.com/thread/{thread_id}/page/1"
            detail_response = requests.get(
                detail_url,
                headers=detail_headers,
                proxies={"http": proxy, "https": proxy},
                timeout=timeout,
            )
            result["detail_status_code"] = detail_response.status_code
            result["detail_retry_after"] = detail_response.headers.get("Retry-After")
            if detail_response.status_code != 200:
                result["detail_body"] = detail_response.text[:200]
                return False, result
            detail_obj = detail_response.json()
            detail_items = detail_obj.get("response", {}).get("item_data", [])
            result["detail_items"] = len(detail_items)
            return detail_obj.get("success") == 1 and bool(detail_items), result
        result["body"] = response.text[:200]
        return False, result
    except Exception as exc:
        result["error"] = str(exc)
        return False, result


def update_env_proxy(env_path: Path, proxy: str) -> None:
    lines = []
    found = False
    if env_path.exists():
        lines = env_path.read_text(encoding="utf-8").splitlines()

    updated = []
    for line in lines:
        if line.startswith("LIHKG_PROXY="):
            updated.append(f"LIHKG_PROXY={proxy}")
            found = True
        else:
            updated.append(line)
    if not found:
        updated.append(f"LIHKG_PROXY={proxy}")

    env_path.write_text("\n".join(updated) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Find a free proxy that can reach the LIHKG API.")
    parser.add_argument("--env-file", default=DEFAULT_ENV_FILE, help="Path to .env.")
    parser.add_argument("--limit", type=int, default=200, help="Maximum proxies to test.")
    parser.add_argument("--workers", type=int, default=20, help="Concurrent proxy tests.")
    parser.add_argument("--fetch-timeout", type=float, default=20.0, help="Proxy source download timeout.")
    parser.add_argument("--test-timeout", type=float, default=8.0, help="Per-proxy test timeout.")
    parser.add_argument("--output", default="proxy-test-results.jsonl", help="JSONL test result file.")
    parser.add_argument("--no-update-env", action="store_true", help="Do not write the winning proxy to .env.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    env_path = Path(args.env_file)
    cookie = load_cookie(env_path)
    output = Path(args.output)

    candidates = fetch_candidates(PROXY_SOURCES, timeout=args.fetch_timeout, limit=args.limit)
    print(f"candidates={len(candidates)} cookie={'set' if cookie else 'empty'}")

    winner = None
    with output.open("w", encoding="utf-8") as f:
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {executor.submit(test_proxy, proxy, cookie, args.test_timeout): proxy for proxy in candidates}
            for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
                ok, result = future.result()
                print(json.dumps(result, ensure_ascii=False, separators=(",", ":")), file=f)
                if index % 20 == 0:
                    print(f"tested={index}/{len(candidates)}")
                if ok and winner is None:
                    winner = result["proxy"]
                    print(f"winner={winner}")
                    break

    if winner:
        if not args.no_update_env:
            update_env_proxy(env_path, str(winner))
            print(f"updated {env_path} LIHKG_PROXY={winner}")
    else:
        print("no working proxy found")


if __name__ == "__main__":
    main()
