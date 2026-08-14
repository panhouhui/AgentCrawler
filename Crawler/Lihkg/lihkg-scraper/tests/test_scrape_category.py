import unittest
from argparse import Namespace
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from scrape_category import build_mattermost_message, clean_html, collect_comments, extract_links, filter_recent_threads, limit_threads_per_source, load_env_file, merge_thread, parse_bool, rotate_brightdata_proxy_url, run_once


class ScrapeCategoryTest(unittest.TestCase):
    def test_clean_html_removes_quotes(self):
        html = 'hello<br /><blockquote>quoted</blockquote><a href="https://example.com">link</a>'

        self.assertEqual(clean_html(html), "hello\nlink")

    def test_extract_links_absolutizes_lihkg_assets(self):
        html = '<a href="https://example.com/a">a</a><img src="/assets/faces/normal/smile.gif" />'

        self.assertEqual(
            extract_links(html),
            [
                "https://example.com/a",
                "https://lihkg.com/assets/faces/normal/smile.gif",
            ],
        )

    def test_load_env_file_parses_quotes_and_bools(self):
        with TemporaryDirectory() as tmp_dir:
            env_path = Path(tmp_dir) / ".env"
            env_path.write_text(
                "LIHKG_COOKIE='cf_clearance=abc; foo=bar'\n"
                "LIHKG_TAIL_EXISTING=true\n"
                "# ignored\n",
                encoding="utf-8",
            )

            env = load_env_file(env_path)

        self.assertEqual(env["LIHKG_COOKIE"], "cf_clearance=abc; foo=bar")
        self.assertTrue(parse_bool(env["LIHKG_TAIL_EXISTING"]))

    def test_merge_thread_merges_source_lists_and_new_values(self):
        existing = {"thread_id": 1, "source_list": ["now"], "title": "old", "total_page": 1}
        current = {"thread_id": 1, "source_list": ["hot"], "title": "new", "total_page": 2}

        merged = merge_thread(existing, current)

        self.assertEqual(merged["source_list"], ["hot", "now"])
        self.assertEqual(merged["title"], "new")
        self.assertEqual(merged["total_page"], 2)

    def test_limit_threads_per_source(self):
        threads = [
            {"source_type": "now", "thread_id": 1},
            {"source_type": "now", "thread_id": 2},
            {"source_type": "hot", "thread_id": 1},
            {"source_type": "hot", "thread_id": 3},
        ]

        limited = limit_threads_per_source(threads, 1)

        self.assertEqual([(item["source_type"], item["thread_id"]) for item in limited], [("now", 1), ("hot", 1)])

    def test_filter_recent_threads_keeps_only_recent(self):
        threads = [
            {"thread_id": 1, "create_time": 1_000_000},
            {"thread_id": 2, "create_time": 1_000_000 - 4 * 86400},
        ]

        with patch("time.time", return_value=1_000_000):
            recent = filter_recent_threads(threads, 3)

        self.assertEqual([thread["thread_id"] for thread in recent], [1])

    def test_rotate_brightdata_proxy_url_adds_session(self):
        proxy = "http://brd-customer-test-zone-demo:pass@brd.superproxy.io:33335"

        rotated = rotate_brightdata_proxy_url(proxy)

        self.assertIsNotNone(rotated)
        self.assertIn("-session-", rotated)
        self.assertIn("@brd.superproxy.io:33335", rotated)
        self.assertNotEqual(rotated, proxy)

    def test_build_mattermost_message_contains_thread_and_comments(self):
        message = build_mattermost_message(
            {
                "title": "hello",
                "url": "https://lihkg.com/thread/1/page/1",
                "source_type": "hot",
                "source_list": ["now"],
                "category": "water cooler",
                "new_comment_count": 1,
                "comments": [{"msg_num": 1, "user_nickname": "alice", "text": "first"}],
            }
        )

        self.assertIn("hello", message)
        self.assertIn("热门", message)
        self.assertIn("https://lihkg.com/thread/1/page/1", message)
        self.assertIn("water cooler", message)
        self.assertIn("alice", message)

    def test_collect_comments_skips_seen_posts(self):
        fake_page = {
            "success": 1,
            "response": {
                "item_data": [
                    {
                        "post_id": "seen",
                        "msg_num": 1,
                        "page": 1,
                        "msg": "old",
                    },
                    {
                        "post_id": "new",
                        "msg_num": 2,
                        "page": 1,
                        "msg": "new<br />comment",
                    },
                ]
            },
        }

        with patch("scrape_category.get_thread_page", return_value=fake_page):
            comments, errors = collect_comments(
                session=None,
                thread_id=123,
                total_page=1,
                seen_posts={"seen"},
                start_page=1,
                retries=1,
                backoff_base=0,
                max_rate_limit_wait=60,
                delay=0,
                max_pages_per_thread=0,
            )

        self.assertEqual(errors, [])
        self.assertEqual(len(comments), 1)
        self.assertEqual(comments[0]["post_id"], "new")
        self.assertEqual(comments[0]["url"], "https://lihkg.com/thread/123/page/1#2")
        self.assertEqual(comments[0]["text"], "new\ncomment")

    def test_run_once_deduplicates_across_runs(self):
        category_items = [
            {
                "thread_id": 123,
                "title": "hello",
                "cat_id": 1,
                "category": {"name": "water cooler"},
                "total_page": 1,
            }
        ]
        thread_page = {
            "success": 1,
            "response": {
                "item_data": [
                    {
                        "post_id": "post-1",
                        "msg_num": 1,
                        "page": 1,
                        "msg": "first",
                    }
                ]
            },
        }

        with TemporaryDirectory() as tmp_dir:
            tmp = Path(tmp_dir)
            args = Namespace(
                cat_id=1,
                types="now,hot",
                list_pages=1,
                list_count=10,
                max_pages_per_thread=1,
                limit_threads=0,
                max_thread_age_days=0,
                request_delay=0,
                retries=1,
                backoff_base=0,
                max_rate_limit_wait=60,
                proxy="",
                proxy_rotate_retries=0,
                cookie="",
                tail_existing=True,
                state=str(tmp / "state.json"),
                output=str(tmp / "events.jsonl"),
                error_output=str(tmp / "errors.jsonl"),
                mattermost_enabled=False,
                mattermost_url="",
                mattermost_token="",
                mattermost_channel_id="",
            )

            with patch("scrape_category.get_category_page", return_value=category_items), patch(
                "scrape_category.get_thread_page", return_value=thread_page
            ):
                first = run_once(args, show_progress=False)
                second = run_once(args, show_progress=False)

            lines = (tmp / "events.jsonl").read_text(encoding="utf-8").splitlines()

        self.assertEqual(first["new_threads"], 1)
        self.assertEqual(first["new_comments"], 1)
        self.assertEqual(second["new_threads"], 0)
        self.assertEqual(second["new_comments"], 0)
        self.assertEqual(len(lines), 2)
        records = [__import__("json").loads(line) for line in lines]
        self.assertEqual({record["source_type"] for record in records}, {"now", "hot"})


if __name__ == "__main__":
    unittest.main()
