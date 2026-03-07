from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from llm247_v2.github.sync import sync_github_issues
from llm247_v2.storage.store import TaskStore
from llm247_v2.storage.thread_store import ThreadStore
from llm247_v2.core.models import Task, TaskStatus


def _make_issue(number: int = 1, title: str = "Bug report", state: str = "open"):
    return {
        "number": number,
        "title": title,
        "html_url": f"https://github.com/owner/repo/issues/{number}",
        "body": "Description here",
        "state": state,
    }


def _make_github(open_issues=None, comments=None, single_issue=None):
    gh = MagicMock()
    gh.list_open_issues.return_value = open_issues or []
    gh.get_issue_comments.return_value = comments or []
    gh.get_issue.return_value = single_issue or _make_issue(state="closed")
    gh.create_comment.return_value = {"id": 101, "body": "test"}
    return gh


class TestSyncGithubIssues(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.thread_store = ThreadStore(base / "threads.db")
        self.task_store = TaskStore(base / "tasks.db")

    def tearDown(self):
        self.thread_store.close()
        self.task_store.close()
        self.tmp.cleanup()

    def _insert_task(self, task_id="t1"):
        task = Task(id=task_id, title="Test", description="", source="manual",
                    status=TaskStatus.QUEUED.value, priority=2)
        self.task_store.insert_task(task)
        return task

    # ── Shape B: new issue becomes new_thread ──────────────────────────────

    def test_new_issue_appears_in_new_threads(self):
        gh = _make_github(open_issues=[_make_issue(1)])
        result = sync_github_issues(gh, self.thread_store, self.task_store)
        self.assertEqual(len(result.new_threads), 1)
        self.assertEqual(result.new_threads[0].github_issue_number, 1)

    def test_already_linked_thread_not_in_new_threads(self):
        issue = _make_issue(1)
        thread = self.thread_store.upsert_thread(issue)
        self.thread_store.set_status(thread.id, "linked")
        gh = _make_github(open_issues=[issue])
        result = sync_github_issues(gh, self.thread_store, self.task_store)
        self.assertEqual(len(result.new_threads), 0)

    # ── Shape A: awaiting_human + new human reply → unblocked ─────────────

    def test_human_reply_unblocks_awaiting_thread(self):
        issue = _make_issue(1)
        thread = self.thread_store.upsert_thread(issue)
        self.thread_store.set_status(thread.id, "awaiting_human")

        new_comment = {
            "id": 55, "body": "Here is the info you need.",
            "created_at": "2024-06-01T00:00:00Z",
            "performed_via_github_app": None,
        }
        gh = _make_github(open_issues=[issue], comments=[new_comment])
        result = sync_github_issues(gh, self.thread_store, self.task_store)

        self.assertEqual(len(result.unblocked), 1)
        updated_thread, messages = result.unblocked[0]
        self.assertEqual(updated_thread.status, "human_responded")
        self.assertEqual(len(messages), 1)

    def test_agent_comment_does_not_unblock(self):
        issue = _make_issue(1)
        thread = self.thread_store.upsert_thread(issue)
        self.thread_store.set_status(thread.id, "awaiting_human")

        agent_comment = {
            "id": 56, "body": "Still working...",
            "created_at": "2024-06-01T00:00:00Z",
            "performed_via_github_app": True,
        }
        gh = _make_github(open_issues=[issue], comments=[agent_comment])
        result = sync_github_issues(gh, self.thread_store, self.task_store)
        self.assertEqual(len(result.unblocked), 0)

    # ── Human closes issue → cancelled ─────────────────────────────────────

    def test_human_closed_issue_cancels_linked_tasks(self):
        issue = _make_issue(1)
        thread = self.thread_store.upsert_thread(issue)
        self.thread_store.set_status(thread.id, "linked")
        self.thread_store.link_task(thread.id, "t1")

        closed_issue = _make_issue(1, state="closed")
        gh = _make_github(open_issues=[], single_issue=closed_issue)
        result = sync_github_issues(gh, self.thread_store, self.task_store)

        self.assertIn("t1", result.cancelled_task_ids)

    def test_issue_not_in_open_but_still_open_is_not_cancelled(self):
        # Issue disappeared from list but is still open (outside since window)
        issue = _make_issue(1)
        thread = self.thread_store.upsert_thread(issue)
        self.thread_store.set_status(thread.id, "linked")

        # get_issue returns open state
        open_issue = _make_issue(1, state="open")
        gh = _make_github(open_issues=[], single_issue=open_issue)
        result = sync_github_issues(gh, self.thread_store, self.task_store)
        self.assertEqual(len(result.cancelled_task_ids), 0)

    # ── Flush outbox ────────────────────────────────────────────────────────

    def test_flush_outbox_posts_pending_comments(self):
        issue = _make_issue(1)
        thread = self.thread_store.upsert_thread(issue)
        self.thread_store.queue_agent_comment(thread.id, "I'll look into this.")

        gh = _make_github(open_issues=[issue])
        result = sync_github_issues(gh, self.thread_store, self.task_store)

        self.assertEqual(result.comments_posted, 1)
        gh.create_comment.assert_called_once_with(1, "I'll look into this.")

    def test_flush_outbox_marks_comment_posted(self):
        issue = _make_issue(1)
        thread = self.thread_store.upsert_thread(issue)
        self.thread_store.queue_agent_comment(thread.id, "Done!")

        gh = _make_github(open_issues=[issue])
        sync_github_issues(gh, self.thread_store, self.task_store)

        remaining = self.thread_store.get_pending_comments()
        self.assertEqual(len(remaining), 0)

    # ── Error resilience ────────────────────────────────────────────────────

    def test_list_issues_failure_returns_empty_result(self):
        gh = MagicMock()
        gh.list_open_issues.side_effect = Exception("network error")
        gh.get_pending_comments = MagicMock(return_value=[])
        # Patch get_pending_comments via thread_store
        result = sync_github_issues(gh, self.thread_store, self.task_store)
        self.assertEqual(len(result.new_threads), 0)
        self.assertEqual(len(result.unblocked), 0)


if __name__ == "__main__":
    unittest.main()
