# facebook_page_scraper/request_handler.py

from curl_cffi import requests
from selectolax.parser import HTMLParser
import json
import os
import re
import socket
from pathlib import Path
from typing import Dict, Optional


class FacebookScraperError(RuntimeError):
    """Raised when fetching or parsing Facebook page data fails."""


class RequestHandler:
    def __init__(self):
        self._load_dotenv()
        self.headers = {
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "accept-language": "en-US,en;q=0.9",
            "cache-control": "no-cache",
            "pragma": "no-cache",
            "priority": "u=0, i",
            "sec-ch-ua": '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "none",
            "sec-fetch-user": "?1",
            "upgrade-insecure-requests": "1",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        }
        self._load_cookie_header()
        self.proxies = self._resolve_proxies()

    @staticmethod
    def _dotenv_paths():
        yield Path(r"F:\AgentHub\env\Crawler_env\Facebook_env")

    @staticmethod
    def _clean_dotenv_value(value: str) -> str:
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        return value

    def _load_dotenv(self) -> None:
        dotenv_path = next((path for path in self._dotenv_paths() if path.exists()), None)
        if not dotenv_path:
            return

        for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip()
            if not key or key in os.environ:
                continue

            os.environ[key] = self._clean_dotenv_value(value)

    def _load_cookie_header(self) -> None:
        cookie = os.getenv("FACEBOOK_COOKIE")
        cookie_file = os.getenv("FACEBOOK_COOKIE_FILE")

        if not cookie and cookie_file:
            try:
                cookie = open(cookie_file, encoding="utf-8").read().strip()
            except OSError as exc:
                raise FacebookScraperError(
                    f"Could not read FACEBOOK_COOKIE_FILE [{cookie_file}]: {exc}"
                ) from exc

        if cookie and cookie != "paste-your-facebook-cookie-here":
            self.headers["cookie"] = cookie

    @staticmethod
    def _is_local_port_open(port: int) -> bool:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return True
        except OSError:
            return False

    def _resolve_proxies(self) -> Optional[Dict[str, str]]:
        proxy_url = (
            os.getenv("FACEBOOK_SCRAPER_PROXY")
            or os.getenv("HTTPS_PROXY")
            or os.getenv("HTTP_PROXY")
            or os.getenv("https_proxy")
            or os.getenv("http_proxy")
        )

        if not proxy_url and os.getenv("FACEBOOK_SCRAPER_NO_PROXY") != "1":
            for port in (7899, 59217):
                if self._is_local_port_open(port):
                    proxy_url = f"http://127.0.0.1:{port}"
                    break

        if not proxy_url:
            return None

        return {"http": proxy_url, "https": proxy_url}

    def fetch_html(self, url: str) -> str:
        """
        Fetches the HTML content from the given URL.

        Args:
            url (str): The URL to fetch.

        Returns:
            str: HTML content of the page.

        Raises:
            FacebookScraperError: If there's an error fetching the page.
        """
        try:
            response = requests.get(
                url,
                headers=self.headers,
                timeout=30,
                impersonate="chrome",
                proxies=self.proxies,
            )
            response.raise_for_status()
            return HTMLParser(response.text)
        except Exception as e:
            raise FacebookScraperError(f"Error fetching the page [{url}]: {e}") from e

    def parse_json_from_html(self, html_content: HTMLParser, key_to_find: str) -> dict:
        """
        Parses JSON data from HTML by extracting the relevant script block.

        Args:
            html_content (str): The raw HTML content of the page.
            key_to_find (str): The key to look for in the script.

        Returns:
            dict: The parsed JSON object.

        Raises:
            SystemExit: If no valid data is found or parsing fails.
        """
        try:
            parser = html_content
            for script in parser.css('script[type="application/json"]'):
                script_text = script.text(strip=True)
                if key_to_find in script_text:
                    return json.loads(script_text)
            raise FacebookScraperError(
                f"No valid data found for key '{key_to_find}' in the HTML page."
            )
        except json.JSONDecodeError as e:
            raise FacebookScraperError(
                f"Error decoding JSON for key '{key_to_find}': {e}"
            ) from e
        except Exception as e:
            if isinstance(e, FacebookScraperError):
                raise
            raise FacebookScraperError(
                f"Unexpected error parsing JSON for key '{key_to_find}': {e}"
            ) from e
