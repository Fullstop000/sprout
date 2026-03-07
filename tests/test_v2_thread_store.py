from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from llm247_v2.storage.thread_store import ThreadStore


def _issue(number: int = 1, title: str = "Help needed", body: str = "Details"):
    return {
        "number": number,
        "html_url": f"https://github.com/owner/repo/issues/{number}",
        "title": title,
        "body": body,
    }


class TestThreadStore(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = ThreadStore(Path(self.tmp.name) / "threads.db")

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    # ── upsert_thread ──────────────────────────────────────────────────────

    def test_upsert_creates_new_thread(self):
        thread = self.store.upsert_thread(_issue(1), created_by="human")
        self.assertEqual(thread.github_issue_number, 1)
        self.assertEqual(thread.status, "pending")
        self.assertEqual(thread.created_by, "human")

    def test_upsert_is_idempotent(self):
        self.store.upsert_thread(_issue(1))
        self.store.upsert_thread(_issue(1, title="Updated"))
        threads = self.store.get_pending_threads()
        self.assertEqual(len(threads), 1)
        self.assertEqual(threads[0].github_issue_title, "Updated")

    def test_upsert_mirrors_body_as_first_message(self):
        thread = self.store.upsert_thread(_issue(1, body="Please fix this bug."))
        messages = self.store.get_messages(thread.id)
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0].role, "human")
        self.assertEqual(messages[0].body, "Please fix this bug.")

    def test_upsert_second_time_does_not_duplicate_body_message(self):
        thread = self.store.upsert_thread(_issue(1))
        self.store.upsert_thread(_issue(1))
        messages = self.store.get_messages(thread.id)
        self.assertEqual(len(messages), 1)

    # ── upsert_message ─────────────────────────────────────────────────────

    def test_upsert_message_adds_comment(self):
        thread = self.store.upsert_thread(_issue(1))
        msg = self.store.upsert_message(
            thread.id, role="agent", body="Working on it.", github_comment_id=42
        )
        self.assertEqual(msg.role, "agent")
        self.assertEqual(msg.body, "Working on it.")

    def test_upsert_message_deduplicates_by_comment_id(self):
        thread = self.store.upsert_thread(_issue(1))
        self.store.upsert_message(thread.id, role="human", body="First", github_comment_id=99)
        self.store.upsert_message(thread.id, role="human", body="First", github_comment_id=99)
        messages = self.store.get_messages(thread.id)
        human_msgs = [m for m in messages if m.github_comment_id == 99]
        self.assertEqual(len(human_msgs), 1)

    # ── task linkage ───────────────────────────────────────────────────────

    def test_link_task_and_get_thread_for_task(self):
        thread = self.store.upsert_thread(_issue(1))
        self.store.link_task(thread.id, "task-abc")
        found = self.store.get_thread_for_task("task-abc")
        self.assertIsNotNone(found)
        self.assertEqual(found.id, thread.id)

    def test_get_thread_for_task_returns_none_when_unlinked(self):
        self.assertIsNone(self.store.get_thread_for_task("nonexistent"))

    def test_get_tasks_for_thread(self):
        thread = self.store.upsert_thread(_issue(1))
        self.store.link_task(thread.id, "t1")
        self.store.link_task(thread.id, "t2")
        tasks = self.store.get_tasks_for_thread(thread.id)
        self.assertCountEqual(tasks, ["t1", "t2"])

    def test_link_task_is_idempotent(self):
        thread = self.store.upsert_thread(_issue(1))
        self.store.link_task(thread.id, "t1")
        self.store.link_task(thread.id, "t1")
        self.assertEqual(len(self.store.get_tasks_for_thread(thread.id)), 1)

    # ── status queries ─────────────────────────────────────────────────────

    def test_get_pending_threads(self):
        self.store.upsert_thread(_issue(1))
        self.store.upsert_thread(_issue(2))
        pending = self.store.get_pending_threads()
        self.assertEqual(len(pending), 2)

    def test_set_status_transitions(self):
        thread = self.store.upsert_thread(_issue(1))
        self.store.set_status(thread.id, "awaiting_human")
        awaiting = self.store.get_threads_awaiting_human()
        self.assertEqual(len(awaiting), 1)
        self.assertEqual(awaiting[0].id, thread.id)

    def test_get_thread_by_issue_number(self):
        self.store.upsert_thread(_issue(7))
        found = self.store.get_thread_by_issue_number(7)
        self.assertIsNotNone(found)
        self.assertEqual(found.github_issue_number, 7)

    def test_get_thread_by_issue_number_returns_none_for_missing(self):
        self.assertIsNone(self.store.get_thread_by_issue_number(999))

    def test_count_agent_messages(self):
        thread = self.store.upsert_thread(_issue(1))
        self.store.upsert_message(thread.id, role="agent", body="A", github_comment_id=1)
        self.store.upsert_message(thread.id, role="agent", body="B", github_comment_id=2)
        self.store.upsert_message(thread.id, role="human", body="C", github_comment_id=3)
        self.assertEqual(self.store.count_agent_messages(thread.id), 2)

    # ── comment outbox ─────────────────────────────────────────────────────

    def test_queue_and_get_pending_comments(self):
        thread = self.store.upsert_thread(_issue(1))
        self.store.queue_agent_comment(thread.id, "I'll look into this.")
        pending = self.store.get_pending_comments()
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0].body, "I'll look into this.")

    def test_mark_comment_posted_clears_from_pending(self):
        thread = self.store.upsert_thread(_issue(1))
        comment_id = self.store.queue_agent_comment(thread.id, "Done!")
        self.store.mark_comment_posted(comment_id, github_comment_id=77)
        pending = self.store.get_pending_comments()
        self.assertEqual(len(pending), 0)

    def test_get_new_human_messages(self):
        # Use a future since_created_at so only explicitly inserted messages qualify
        thread = self.store.upsert_thread(_issue(1))
        self.store.upsert_message(
            thread.id, role="human", body="Old msg",
            github_comment_id=1, created_at="2020-01-01T00:00:00+00:00"
        )
        self.store.upsert_message(
            thread.id, role="human", body="New msg",
            github_comment_id=2, created_at="2099-06-01T00:00:00+00:00"
        )
        new = self.store.get_new_human_messages(thread.id, since_created_at="2099-01-01T00:00:00+00:00")
        self.assertEqual(len(new), 1)
        self.assertEqual(new[0].body, "New msg")


if __name__ == "__main__":
    unittest.main()
