from __future__ import annotations

import argparse
from pprint import pprint

from facebook_page_scraper import FacebookPageScraper
from facebook_page_scraper.page_info import PageInfo
from facebook_page_scraper.request_handler import FacebookScraperError


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a quick scraper smoke test.")
    parser.add_argument(
        "page",
        nargs="?",
        default="facebook",
        help="Facebook page URL or username to test. Defaults to 'facebook'.",
    )
    parser.add_argument(
        "--posts",
        action="store_true",
        help="Also test PagePostInfo for the same page.",
    )
    args = parser.parse_args()

    normalized_url = PageInfo.normalize_url(args.page)
    print(f"Import OK")
    print(f"Normalized URL: {normalized_url}")

    try:
        page_info = FacebookPageScraper.PageInfo(args.page)
    except FacebookScraperError as exc:
        print(f"PageInfo failed: {exc}")
        return 1

    print("PageInfo OK")
    pprint(page_info)

    if args.posts:
        try:
            posts = FacebookPageScraper.PagePostInfo(args.page)
        except FacebookScraperError as exc:
            print(f"PagePostInfo failed: {exc}")
            return 1

        print("PagePostInfo OK")
        pprint(posts[:2] if posts else posts)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
