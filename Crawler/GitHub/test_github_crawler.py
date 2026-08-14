import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch
import github_crawler

from github_crawler import (
    GitHubClient,
    MiniMaxAPIError,
    MiniMaxAnalyzer,
    SearchRecord,
    alert_payload,
    build_region_queries,
    clean_content,
    clean_jsonl_file,
    content_excerpt,
    collect_records,
    dated_output_path,
    detect_regions,
    format_alert_message,
    game_deep_text_excerpt,
    is_game_project,
    load_dotenv,
    minimax_api_key_for,
    minimax_trust_env_for,
    monitor_region_records,
    parse_args,
    post_mattermost_channels,
    send_pending_sensitive,
    repository_matches_keyword,
    search_terms,
    select_query_batch,
    write_records,
)


class FakeClient(GitHubClient):
    def __init__(self, pages):
        super().__init__("test-token", request_interval=0)
        self.pages = iter(pages)
        self.requests = []

    def get_json(self, path, params=None):
        self.requests.append((path, params))
        return next(self.pages)


class FakeRepoClient(FakeClient):
    def __init__(self, pages, tree=None, files=None):
        super().__init__(pages)
        self.tree = tree or []
        self.files = files or {}

    def repository_tree(self, full_name, branch=None):
        self.requests.append(("tree", {"full_name": full_name, "branch": branch}))
        return self.tree

    def file_text(self, full_name, path, max_bytes=120_000):
        self.requests.append(("file", {"full_name": full_name, "path": path}))
        return self.files.get(path, "")


class FakeAnalyzer:
    def __init__(self):
        self.calls = []

    def analyze(self, record, regions):
        self.calls.append((record, regions))
        return {
            "anti_china_tendency": "yes",
            "confidence": 0.9,
            "reason": "test reason",
        }


class NoAnalyzer:
    def analyze(self, record, regions):
        return {
            "anti_china_tendency": "no",
            "confidence": 0.9,
            "reason": "not relevant",
        }


class FailingAnalyzer:
    def analyze(self, record, regions):
        raise MiniMaxAPIError("test failure")


class NewSensitiveAnalyzer:
    def analyze(self, record, regions):
        raise MiniMaxAPIError("MiniMax API request failed: HTTP 422 output new_sensitive (1027)")


class GitHubCrawlerTests(unittest.TestCase):
    def test_search_paginates_and_stops_at_max_results(self):
        client = FakeClient(
            [
                {"total_count": 4, "items": [{"id": 1}, {"id": 2}]},
                {"total_count": 4, "items": [{"id": 3}, {"id": 4}]},
            ]
        )

        records = list(client.search("python", "repositories", max_results=3, per_page=2))

        self.assertEqual([record.item["id"] for record in records], [1, 2, 3])
        self.assertEqual(client.requests[0][0], "/search/repositories")
        self.assertEqual(client.requests[1][1]["per_page"], 1)

    def test_write_jsonl_contains_only_requested_fields(self):
        record = SearchRecord(
            "keyword",
            "repositories",
            "2026-01-01T00:00:00+00:00",
            {"id": 7, "html_url": "https://github.com/example/repository"},
            "README content",
        )
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "nested" / "results.jsonl"
            count = write_records([record], output, "jsonl")
            payload = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(count, 1)
        self.assertEqual(payload["event_query"], "keyword")
        self.assertEqual(payload["repository_url"], "https://github.com/example/repository")
        self.assertEqual(payload["content"], "README content")
        self.assertEqual(set(payload), {"event_query", "repository_url", "content"})

    def test_clean_content_removes_html_but_preserves_text(self):
        content = "<div>Hello <b>world</b><img src='x'></div><script>bad()</script>"

        self.assertEqual(clean_content(content), "Hello world")

    def test_clean_content_normalizes_whitespace_and_truncates_long_text(self):
        content = "hello\u3000\u3000world\nprivate:\ue000" + ("x" * 20)

        self.assertEqual(clean_content(content, max_length=15), "hello world pri...")

    def test_content_excerpt_centers_output_near_keyword(self):
        content = ("a" * 200) + " crawler relevant context " + ("z" * 200)

        excerpt = content_excerpt(content, "crawler", max_length=100)

        self.assertIn("crawler relevant context", excerpt)
        self.assertTrue(excerpt.startswith("..."))
        self.assertTrue(excerpt.endswith("..."))

    def test_clean_jsonl_file_updates_content_in_place(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "results.jsonl"
            output.write_text(
                json.dumps({"event_query": "x", "repository_url": "https://example.com", "content": "<p>text</p>"})
                + "\n",
                encoding="utf-8",
            )

            count = clean_jsonl_file(output)
            payload = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(count, 1)
        self.assertEqual(payload["content"], "text")

    def test_exhaustive_repository_search_splits_large_date_range(self):
        client = FakeClient(
            [
                {"total_count": 1200, "items": [{"id": 99}]},
                {"total_count": 1, "items": [{"id": 99}]},
                {"total_count": 1, "items": [{"id": 1, "description": "crawler"}]},
                {"total_count": 1, "items": [{"id": 99}]},
                {"total_count": 1, "items": [{"id": 2, "description": "crawler"}]},
            ]
        )

        records = list(
            collect_records(
                client,
                ["crawler"],
                ["repositories"],
                max_results=100,
                per_page=100,
                sort=None,
                order="desc",
                exhaustive=True,
                start_date=date(2026, 1, 1),
                end_date=date(2026, 1, 2),
            )
        )

        self.assertEqual([record.item["id"] for record in records], [1, 2])
        queries = [request[1]["q"] for request in client.requests]
        self.assertIn("crawler created:2026-01-01..2026-01-02", queries)
        self.assertIn("crawler created:2026-01-01..2026-01-01", queries)
        self.assertIn("crawler created:2026-01-02..2026-01-02", queries)

    def test_collect_records_uses_repository_description_only(self):
        client = FakeClient(
            [
                {
                    "total_count": 1,
                    "items": [
                        {
                            "id": 1,
                            "full_name": "example/repository",
                            "html_url": "https://github.com/example/repository",
                            "description": "<b>crawler About text</b>",
                        }
                    ],
                }
            ]
        )

        records = list(
            collect_records(
                client,
                ["crawler"],
                ["repositories"],
                max_results=1,
                per_page=100,
                sort=None,
                order="desc",
                include_indirect_matches=False,
            )
        )

        self.assertEqual(records[0].content, "<b>crawler About text</b>")
        self.assertEqual(records[0].as_json()["content"], "crawler About text")
        self.assertEqual(len(client.requests), 1)

    def test_collect_records_skips_indirect_repository_matches(self):
        client = FakeClient(
            [
                {
                    "total_count": 2,
                    "items": [
                        {
                            "id": 1,
                            "full_name": "example/relevant",
                            "html_url": "https://github.com/example/relevant",
                            "description": "contains crawler keyword",
                        },
                        {
                            "id": 2,
                            "full_name": "example/indirect",
                            "html_url": "https://github.com/example/indirect",
                            "description": "unrelated about text",
                        },
                    ],
                }
            ]
        )

        records = list(
            collect_records(
                client,
                ["crawler"],
                ["repositories"],
                max_results=2,
                per_page=100,
                sort=None,
                order="desc",
                include_indirect_matches=False,
            )
        )

        self.assertEqual([record.item["id"] for record in records], [1])

    def test_collect_records_excludes_requested_repository_url(self):
        client = FakeClient(
            [
                {
                    "total_count": 2,
                    "items": [
                        {"id": 1, "html_url": "https://github.com/example/keep", "description": "keep"},
                        {"id": 2, "html_url": "https://github.com/example/drop", "description": "drop"},
                    ],
                }
            ]
        )

        records = list(
            collect_records(
                client,
                ["crawler"],
                ["repositories"],
                max_results=2,
                per_page=100,
                sort=None,
                order="desc",
                excluded_urls={"https://github.com/example/drop"},
            )
        )

        self.assertEqual([record.item["id"] for record in records], [1])

    def test_collect_records_expands_issues_to_issue_and_pull_request_queries(self):
        client = FakeClient(
            [
                {
                    "total_count": 1,
                    "items": [
                        {
                            "id": 1,
                            "html_url": "https://github.com/example/repo/issues/1",
                            "title": "Issue title",
                            "body": "Taiwan discussion",
                        }
                    ],
                },
                {
                    "total_count": 1,
                    "items": [
                        {
                            "id": 2,
                            "html_url": "https://github.com/example/repo/pull/2",
                            "title": "PR title",
                            "body": "Taiwan discussion",
                        }
                    ],
                },
            ]
        )

        records = list(
            collect_records(
                client,
                ["Taiwan"],
                ["issues"],
                max_results=1,
                per_page=100,
                sort=None,
                order="desc",
            )
        )

        queries = [request[1]["q"] for request in client.requests]
        self.assertEqual(queries, ["Taiwan is:issue", "Taiwan is:pull-request"])
        self.assertEqual([record.item["id"] for record in records], [1, 2])

    def test_search_terms_ignore_github_qualifiers(self):
        self.assertEqual(search_terms('"web scraper" language:python stars:>10'), ["web scraper"])
        self.assertTrue(
            repository_matches_keyword(
                '"web scraper" language:python',
                {"full_name": "example/repository", "html_url": "https://github.com/example/repository"},
                "A web scraper project",
            )
        )

    def test_load_dotenv_does_not_override_existing_value(self):
        with tempfile.TemporaryDirectory() as directory:
            dotenv = Path(directory) / ".env"
            dotenv.write_text("GITHUB_TOKEN=from-file\nQUOTED=\"ok\"\n", encoding="utf-8")
            with patch.dict("os.environ", {"GITHUB_TOKEN": "already-set"}, clear=True):
                load_dotenv(dotenv)
                self.assertEqual(__import__("os").environ["GITHUB_TOKEN"], "already-set")
                self.assertEqual(__import__("os").environ["QUOTED"], "ok")

    def test_parse_args_has_no_event_file_option(self):
        args = parse_args(["--monitor-regions"])

        self.assertFalse(hasattr(args, "keywords_file"))

    def test_select_query_batch_advances_and_wraps_cursor(self):
        with tempfile.TemporaryDirectory() as directory:
            cursor = Path(directory) / "cursor.txt"

            self.assertEqual(select_query_batch(["a", "b", "c"], 2, cursor), ["a", "b"])
            self.assertEqual(select_query_batch(["a", "b", "c"], 2, cursor), ["c", "a"])
            self.assertEqual(cursor.read_text(encoding="utf-8"), "1")

    def test_dated_output_path_uses_year_month_day_directories(self):
        self.assertEqual(
            dated_output_path("region-alerts.jsonl", date(2026, 6, 2)),
            Path("output") / "2026" / "06" / "02" / "region-alerts.jsonl",
        )

    def test_build_region_queries_expands_keywords_by_region_terms(self):
        queries = build_region_queries(["crawler"], ["hong_kong"])

        self.assertIn('crawler "Hong Kong"', queries)
        self.assertIn("crawler HK", queries)

    def test_detect_regions_finds_hong_kong_macau_and_taiwan_terms(self):
        self.assertEqual(detect_regions("Hong Kong and Taiwan"), ["hong_kong", "taiwan"])
        self.assertEqual(detect_regions("Macao"), ["macau"])

    def test_alert_payload_contains_analysis_fields(self):
        record = SearchRecord(
            "crawler Taiwan",
            "issues",
            "2026-01-01T00:00:00+00:00",
            {
                "id": 1,
                "html_url": "https://github.com/example/repository/issues/1",
                "repository": {"html_url": "https://github.com/example/repository"},
                "title": "Issue title",
            },
            "Taiwan related body",
        )

        payload = alert_payload(
            record,
            ["taiwan"],
            {"anti_china_tendency": "unclear", "confidence": 0.2, "reason": "not enough context"},
        )

        self.assertEqual(payload["source_url"], "https://github.com/example/repository/issues/1")
        self.assertEqual(payload["repository_url"], "https://github.com/example/repository")
        self.assertEqual(payload["regions"], ["taiwan"])
        self.assertEqual(payload["anti_china_tendency"], "unclear")

    def test_format_alert_message_contains_mattermost_fields(self):
        message = format_alert_message(
            {
                "event_query": "?? ??",
                "search_type": "repositories",
                "regions": ["hong_kong"],
                "anti_china_tendency": "yes",
                "confidence": 0.8,
                "reason": "test reason",
                "title": "example/repo",
                "source_url": "https://github.com/example/repo",
                "content": "test content",
            }
        )

        self.assertTrue(message.startswith("事件复核条件："))
        self.assertIn("?? ??", message)
        self.assertIn("https://github.com/example/repo", message)
        self.assertNotIn("类型：", message)
        self.assertNotIn("判断：", message)
        self.assertEqual(len(message.splitlines()), 5)
        self.assertNotIn("test content", message)

    def test_post_mattermost_channels_splits_comma_separated_ids(self):
        calls = []
        with patch.object(
            github_crawler,
            "post_mattermost",
            lambda server_url, bot_token, channel_id, payload, timeout=20.0: calls.append(channel_id),
        ):
            post_mattermost_channels("https://mattermost.example", "token", "a, b,,c", {}, timeout=1)

        self.assertEqual(calls, ["a", "b", "c"])

    def test_minimax_extract_message_raises_on_base_resp_error(self):
        with self.assertRaises(MiniMaxAPIError):
            MiniMaxAnalyzer._extract_message(
                {"base_resp": {"status_code": 2049, "status_msg": "invalid api key"}}
            )

    def test_minimax_chat_url_accepts_base_or_full_endpoint(self):
        self.assertEqual(
            MiniMaxAnalyzer("key", api_url="https://api.minimax.io/v1")._chat_url(),
            "https://api.minimax.io/v1/chat/completions",
        )
        self.assertEqual(
            MiniMaxAnalyzer("key", api_url="https://api.minimax.io/v1/chat/completions")._chat_url(),
            "https://api.minimax.io/v1/chat/completions",
        )

    def test_minimax_api_key_prefers_international_key_for_international_url(self):
        with patch.dict(
            "os.environ",
            {"MINIMAX_API_KEY": "mainland", "MINIMAX_INTL_API_KEY": "international"},
            clear=True,
        ):
            self.assertEqual(minimax_api_key_for("https://api.minimax.io/v1"), "international")
            self.assertEqual(minimax_api_key_for("https://api.minimaxi.com/v1"), "mainland")
            self.assertEqual(minimax_api_key_for("https://api.minimax.io/v1", "explicit"), "explicit")

    def test_minimax_trust_env_defaults_off_for_international_url(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertFalse(minimax_trust_env_for("https://api.minimax.io/v1"))
            self.assertTrue(minimax_trust_env_for("https://api.minimaxi.com/v1"))
        with patch.dict("os.environ", {"MINIMAX_TRUST_ENV": "true"}, clear=True):
            self.assertTrue(minimax_trust_env_for("https://api.minimax.io/v1"))

    def test_monitor_region_records_saves_new_region_matches_once(self):
        client = FakeClient(
            [
                {
                    "total_count": 1,
                    "items": [
                        {
                            "id": 1,
                            "full_name": "example/repository",
                            "html_url": "https://github.com/example/repository",
                            "description": "crawler project about Taiwan",
                        }
                    ],
                },
                {
                    "total_count": 1,
                    "items": [
                        {
                            "id": 1,
                            "full_name": "example/repository",
                            "html_url": "https://github.com/example/repository",
                            "description": "crawler project about Taiwan",
                        }
                    ],
                },
                {
                    "total_count": 1,
                    "items": [
                        {
                            "id": 2,
                            "full_name": "example/other",
                            "html_url": "https://github.com/example/other",
                            "description": "crawler project without region",
                        }
                    ],
                },
                {
                    "total_count": 1,
                    "items": [
                        {
                            "id": 2,
                            "full_name": "example/other",
                            "html_url": "https://github.com/example/other",
                            "description": "crawler project without region",
                        }
                    ],
                },
            ]
        )
        analyzer = FakeAnalyzer()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "alerts.jsonl"
            state_file = Path(directory) / "seen.txt"

            count = monitor_region_records(
                client,
                analyzer,
                ["crawler"],
                ["repositories"],
                max_results=1,
                per_page=100,
                sort=None,
                order="desc",
                output=output,
                output_format="jsonl",
                state_file=state_file,
                regions=["taiwan"],
            )
            payload = json.loads(output.read_text(encoding="utf-8"))

            self.assertEqual(count, 1)
            self.assertEqual(len(analyzer.calls), 1)
            self.assertEqual(payload["anti_china_tendency"], "yes")
            self.assertEqual(payload["regions"], ["taiwan"])
            self.assertEqual(len(state_file.read_text(encoding="utf-8").splitlines()), 2)

    def test_monitor_region_records_can_continue_on_analysis_error(self):
        client = FakeClient(
            [
                {
                    "total_count": 1,
                    "items": [
                        {
                            "id": 1,
                            "full_name": "example/repository",
                            "html_url": "https://github.com/example/repository",
                            "description": "crawler project about Taiwan",
                        }
                    ],
                },
                {
                    "total_count": 1,
                    "items": [
                        {
                            "id": 1,
                            "full_name": "example/repository",
                            "html_url": "https://github.com/example/repository",
                            "description": "crawler project about Taiwan",
                        }
                    ],
                },
                {
                    "total_count": 1,
                    "items": [
                        {
                            "id": 1,
                            "full_name": "example/repository",
                            "html_url": "https://github.com/example/repository",
                            "description": "crawler project about 鍙版咕",
                        }
                    ],
                },
                {
                    "total_count": 1,
                    "items": [
                        {
                            "id": 1,
                            "full_name": "example/repository",
                            "html_url": "https://github.com/example/repository",
                            "description": "crawler project about 鍙版咕",
                        }
                    ],
                },
            ]
        )
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "alerts.jsonl"
            state_file = Path(directory) / "seen.txt"

            count = monitor_region_records(
                client,
                FailingAnalyzer(),
                ["crawler"],
                ["repositories"],
                max_results=1,
                per_page=100,
                sort=None,
                order="desc",
                output=output,
                output_format="jsonl",
                state_file=state_file,
                regions=["taiwan"],
                continue_on_analysis_error=True,
            )
            payload = json.loads(output.read_text(encoding="utf-8"))

            self.assertEqual(count, 1)
            self.assertEqual(payload["anti_china_tendency"], "unclear")
            self.assertIn("MiniMax 分析失败", payload["reason"])

    def test_monitor_region_records_pushes_new_sensitive_as_yes(self):
        pages = []
        for _ in range(4):
            pages.append(
                {
                    "total_count": 1,
                    "items": [
                        {
                            "id": 1,
                            "full_name": "example/repository",
                            "html_url": "https://github.com/example/repository",
                            "description": "crawler project about Taiwan",
                        }
                    ],
                }
            )
        pushes = []
        with tempfile.TemporaryDirectory() as directory, patch.object(
            github_crawler, "push_alert", lambda *args, **kwargs: pushes.append(args)
        ):
            state_file = Path(directory) / "seen.txt"
            output = Path(directory) / "alerts.jsonl"
            count = monitor_region_records(
                FakeClient(pages),
                NewSensitiveAnalyzer(),
                ["crawler"],
                ["repositories"],
                max_results=1,
                per_page=100,
                sort=None,
                order="desc",
                output=output,
                output_format="jsonl",
                state_file=state_file,
                regions=["taiwan"],
                continue_on_analysis_error=True,
            )
            payload = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(count, 1)
        self.assertEqual(payload["anti_china_tendency"], "yes")
        self.assertFalse(payload["requires_confirmation"])
        self.assertEqual(payload["reason"], "敏感内容过滤了，但信息和指定的事件复核条件相关。")
        self.assertEqual(len(pushes), 1)


    def test_monitor_region_records_does_not_push_non_yes_results(self):
        client = FakeClient(
            [
                {
                    "total_count": 1,
                    "items": [
                        {
                            "id": 1,
                            "full_name": "example/repository",
                            "html_url": "https://github.com/example/repository",
                            "description": "crawler project about Taiwan",
                        }
                    ],
                },
                {
                    "total_count": 1,
                    "items": [
                        {
                            "id": 1,
                            "full_name": "example/repository",
                            "html_url": "https://github.com/example/repository",
                            "description": "crawler project about Taiwan",
                        }
                    ],
                },
                {
                    "total_count": 1,
                    "items": [
                        {
                            "id": 1,
                            "full_name": "example/repository",
                            "html_url": "https://github.com/example/repository",
                            "description": "crawler project about Taiwan",
                        }
                    ],
                },
                {
                    "total_count": 1,
                    "items": [
                        {
                            "id": 1,
                            "full_name": "example/repository",
                            "html_url": "https://github.com/example/repository",
                            "description": "crawler project about Taiwan",
                        }
                    ],
                },
            ]
        )
        pushes = []
        with tempfile.TemporaryDirectory() as directory, patch.object(
            github_crawler, "push_alert", lambda *args, **kwargs: pushes.append(args)
        ):
            monitor_region_records(
                client,
                NoAnalyzer(),
                ["crawler"],
                ["repositories"],
                max_results=1,
                per_page=100,
                sort=None,
                order="desc",
                output=Path(directory) / "alerts.jsonl",
                output_format="jsonl",
                state_file=Path(directory) / "seen.txt",
                regions=["taiwan"],
            )

        self.assertEqual(pushes, [])

    def test_game_deep_text_excerpt_reads_story_files_for_game_projects(self):
        record = SearchRecord(
            "Taiwan",
            "repositories",
            "2026-01-01T00:00:00+00:00",
            {
                "id": 1,
                "full_name": "example/game",
                "html_url": "https://github.com/example/game",
                "description": "A historical RPG game about Taiwan",
            },
            "game description",
        )
        client = FakeRepoClient(
            [],
            tree=[
                {"type": "blob", "path": "Assets/story/dialogue_zh.txt"},
                {"type": "blob", "path": "Assets/image/logo.png"},
            ],
            files={"Assets/story/dialogue_zh.txt": "Taiwan story dialogue"},
        )

        self.assertTrue(is_game_project(record))
        excerpt = game_deep_text_excerpt(client, record)

        self.assertIn("[Assets/story/dialogue_zh.txt]", excerpt)
        self.assertIn("Taiwan story dialogue", excerpt)

    def test_monitor_region_records_attaches_game_deep_text_before_analysis(self):
        pages = []
        for _ in range(4):
            pages.append(
                {
                    "total_count": 1,
                    "items": [
                        {
                            "id": 1,
                            "full_name": "example/game",
                            "html_url": "https://github.com/example/game",
                            "description": "A historical RPG game about Taiwan",
                        }
                    ],
                }
            )
        client = FakeRepoClient(
            pages,
            tree=[{"type": "blob", "path": "story/mission.txt"}],
            files={"story/mission.txt": "mission text about Taiwan"},
        )
        analyzer = FakeAnalyzer()
        with tempfile.TemporaryDirectory() as directory:
            monitor_region_records(
                client,
                analyzer,
                ["Taiwan"],
                ["repositories"],
                max_results=1,
                per_page=100,
                sort=None,
                order="desc",
                output=Path(directory) / "alerts.jsonl",
                output_format="jsonl",
                state_file=Path(directory) / "seen.txt",
                regions=["taiwan"],
            )

        analyzed_record = analyzer.calls[0][0]
        self.assertIn("游戏项目深度巡查文本", analyzed_record.content)
        self.assertIn("mission text about Taiwan", analyzed_record.content)

    def test_monitor_region_records_pushes_yes_once(self):
        pages = []
        for _ in range(8):
            pages.append(
                {
                    "total_count": 1,
                    "items": [
                        {
                            "id": 1,
                            "full_name": "example/repository",
                            "html_url": "https://github.com/example/repository",
                            "description": "crawler project about Taiwan",
                        }
                    ],
                }
            )
        pushes = []
        with tempfile.TemporaryDirectory() as directory, patch.object(
            github_crawler, "push_alert", lambda *args, **kwargs: pushes.append(args)
        ):
            state_file = Path(directory) / "seen.txt"
            output = Path(directory) / "alerts.jsonl"
            monitor_region_records(
                FakeClient(pages[:4]),
                FakeAnalyzer(),
                ["crawler"],
                ["repositories"],
                max_results=1,
                per_page=100,
                sort=None,
                order="desc",
                output=output,
                output_format="jsonl",
                state_file=state_file,
                regions=["taiwan"],
            )
            monitor_region_records(
                FakeClient(pages[4:]),
                FakeAnalyzer(),
                ["crawler"],
                ["repositories"],
                max_results=1,
                per_page=100,
                sort=None,
                order="desc",
                output=output,
                output_format="jsonl",
                state_file=state_file,
                regions=["taiwan"],
            )

        self.assertEqual(len(pushes), 1)



    def test_send_pending_sensitive_pushes_selected_record(self):
        pushes = []
        with tempfile.TemporaryDirectory() as directory, patch.object(
            github_crawler, "push_alert", lambda *args, **kwargs: pushes.append(args)
        ):
            state_file = Path(directory) / "seen.txt"
            pending = Path(directory) / "pending-sensitive.jsonl"
            pending.write_text(
                json.dumps(
                    {
                        "record_id": "abc",
                        "event_query": "keyword Taiwan",
                        "regions": ["hong_kong", "taiwan"],
                        "reason": "review reason",
                        "title": "example/repo",
                        "source_url": "https://github.com/example/repo",
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            count = send_pending_sensitive(state_file, mattermost_server_url="https://mattermost.example", mattermost_bot_token="token", mattermost_channel_id="a")

        self.assertEqual(count, 1)
        self.assertEqual(len(pushes), 1)

if __name__ == "__main__":
    unittest.main()
