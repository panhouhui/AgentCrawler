import unittest
import sys
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.modules.setdefault(
    "kan_push_bridge",
    types.SimpleNamespace(KanPushError=Exception, dispatch_kan_message=lambda *args, **kwargs: None),
)
import telegram_ai_tool as tg


class TelegramDiscoveryTests(unittest.TestCase):
    def setUp(self):
        now = datetime.now(timezone.utc)
        self.config = tg.TelegramConfig(1, "test", "test")
        self.channels = [tg.Channel(id=i, title=f"Channel {i}", photo=None, date=now) for i in range(1, 27)]
        self.messages = {
            entity.id: [SimpleNamespace(id=j, date=now, message=f"news {j}", chat=entity) for j in range(1, 5)]
            for entity in self.channels
        }
        self.visited = []

        def iter_messages(entity, limit):
            self.visited.append(entity.id)
            return iter(self.messages[entity.id][:limit])

        client = SimpleNamespace(
            iter_dialogs=lambda: iter(SimpleNamespace(entity=c) for c in self.channels),
            iter_messages=iter_messages,
        )
        self.client_patch = patch.object(tg, "make_client")
        factory = self.client_patch.start()
        factory.return_value.__enter__.return_value = client
        self.addCleanup(self.client_patch.stop)

    def crawl(self, **kwargs):
        return tg.crawl_dialogs(self.config, dialogs=[str(i) for i in range(1, 27)], max_results=3, **kwargs)

    def test_every_target_is_scanned_despite_busy_first_dialog(self):
        result = self.crawl(per_dialog=True)
        self.assertEqual(self.visited, list(range(1, 27)))
        self.assertEqual(result["scanned_dialog_count"], 26)
        self.assertEqual(result["message_count"], 78)
        self.assertEqual(result["group_count"], 26)
        self.assertTrue(all(g["count"] == 3 for g in result["groups"]))
        self.assertEqual(result["max_results_scope"], "per_dialog")

    def test_default_retains_total_limit_for_existing_callers(self):
        result = self.crawl()
        self.assertEqual(result["message_count"], 3)
        self.assertEqual(self.visited, [1])
        self.assertEqual(result["max_results_scope"], "total")

    def test_old_or_empty_dialogs_do_not_block_later_dialogs(self):
        for message in self.messages[1]:
            message.date -= timedelta(days=2)
        self.messages[2] = []
        result = self.crawl(per_dialog=True)
        self.assertEqual(result["scanned_dialog_count"], 26)
        self.assertEqual(result["group_count"], 24)
        self.assertEqual(result["message_count"], 72)

    def test_query_and_message_deduplication_remain_per_dialog(self):
        for messages in self.messages.values():
            messages[1].message = "unique2"
            messages.insert(0, messages[1])
        result = self.crawl(per_dialog=True, query="unique2")
        self.assertEqual(result["message_count"], 26)
        self.assertTrue(all(g["count"] == 1 for g in result["groups"]))

    def test_payload_enables_per_dialog_only_with_explicit_flag(self):
        with patch.object(tg, "read_config", return_value=self.config), patch.object(
            tg, "read_push_dialogs", return_value=["1", "26"]
        ):
            result = tg.run_payload(
                {"action": "crawl_dialogs", "max_results": 3, "per_dialog": True},
                env_path=Path("unused"),
            )
        self.assertEqual(result["message_count"], 6)
        self.assertEqual(self.visited, [1, 26])


if __name__ == "__main__":
    unittest.main()
