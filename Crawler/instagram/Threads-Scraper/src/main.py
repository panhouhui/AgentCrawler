import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

import yaml
from dotenv import load_dotenv

from scraper.exporter import Exporter
from scraper.parser import ThreadsParser
from scraper.threads_scraper import ThreadsScraper
from scraper.utils.logger import get_logger

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OUTPUT_DIR = ROOT / "output"
CONFIG_DIR = ROOT / "config"
CENTRAL_ENV_PATH = Path(r"F:\AgentHub\env\Crawler_env\instagram_env")

logger = get_logger(__name__)


def load_settings(config_path: Path) -> Dict[str, Any]:
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def ensure_dirs() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "raw").mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "processed").mkdir(parents=True, exist_ok=True)


def parse_args(default_usernames: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Threads Scraper - scrape Threads posts for given usernames."
    )
    parser.add_argument(
        "-u",
        "--usernames",
        nargs="+",
        help="Threads usernames to scrape (without @). Defaults to settings.yaml",
        default=default_usernames,
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Force offline mode (use local sample dump).",
    )
    parser.add_argument(
        "--online",
        action="store_true",
        help="Force online mode, even if settings.yaml enables offline mode.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=50,
        help="Max number of threads per user to collect.",
    )
    return parser.parse_args()


def main() -> None:
    load_dotenv(CENTRAL_ENV_PATH)
    ensure_dirs()

    settings = load_settings(CONFIG_DIR / "settings.yaml")
    args = parse_args(settings.get("usernames", []))

    if not args.usernames:
        logger.error("No usernames provided via CLI or settings.yaml")
        sys.exit(1)

    settings["use_offline"] = False if args.online else (args.offline or settings.get("use_offline", False))
    settings["limit"] = args.limit

    scraper = ThreadsScraper(settings=settings, config_dir=CONFIG_DIR, data_dir=DATA_DIR)
    parser = ThreadsParser()
    exporter = Exporter(output_dir=OUTPUT_DIR, data_dir=DATA_DIR)

    all_results: List[Dict[str, Any]] = []
    for username in args.usernames:
        try:
            logger.info("Collecting threads for @%s (offline=%s)", username, settings["use_offline"])
            raw_items = scraper.fetch_user_threads(username=username, limit=settings["limit"])
            parsed_items = [parser.parse_item(item, default_username=username) for item in raw_items]
            all_results.extend([item for item in parsed_items if item])
        except Exception as exc:
            logger.exception("Failed to collect for @%s: %s", username, exc)

    if not all_results:
        logger.warning("No results collected. Exiting.")
        sys.exit(0)

    json_path = exporter.to_json(all_results, filename="threads_results.json")
    csv_path = exporter.to_csv(all_results, filename="threads_results.csv")
    processed_path = exporter.to_csv(all_results, filename="clean_threads.csv", subdir="data/processed")

    logger.info("Wrote JSON -> %s", json_path)
    logger.info("Wrote CSV  -> %s", csv_path)
    logger.info("Wrote processed CSV -> %s", processed_path)
    logger.info(
        json.dumps(
            {
                "users": sorted({item["username"] for item in all_results}),
                "total_items": len(all_results),
                "output_json": str(json_path),
                "output_csv": str(csv_path),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
