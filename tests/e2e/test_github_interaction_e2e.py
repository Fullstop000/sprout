"""E2E tests for GitHub Issues ↔ agent interaction.

These tests require a real GitHub token and are skipped automatically when
GITHUB_TOKEN is not set. They use the `sprout-e2e-test` label to isolate
test issues from production ones. All created issues are closed at the end.
"""
from __future__ import annotations

import os
import tempfile
import time
import unittest
from pathlib import Path

_GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
_GITHUB_OWNER = os.getenv("GITHUB_OWNER", "Fullstop000")
_GITHUB_REPO = os.getenv("GITHUB_REPO", "sprout")
_E2E_LABEL = "sprout-e2e-test"

_SKIP_REASON = "GITHUB_TOKEN not set — skipping E2E GitHub interaction tests"


@unittest.skipUnless(_GITHUB_TOKEN, _SKIP_REASON)
class TestGitHubClientE2E(unittest.TestCase):
    """Verify that GitHubClient can talk to the real GitHub API."""

    def setUp(self):
        from llm247_v2.github.client import GitHubClient
        self.client = GitHubClient(
            token=_GITHUB_TOKEN,
            owner=_GITHUB_OWNER,
            repo=_GITHUB_REPO,
            label=_E2E_LABEL,
        )
        self._opened_issues: list[int] = []

    def tearDown(self):
        for number in self._opened_issues:
            try:
                self.client.close_issue(number, state_reason="not_planned")
            except Exception:
                pass

    def _create_issue(self, title: str, body: str = "E2E test issue") -> dict:
        issue = self.client.create_issue(title, body)
        self._opened_issues.append(issue["number"])
        return issue

    def test_create_and_get_issue(self):
        issue = self._create_issue("[E2E] Create and Get")
        number = issue["number"]
        fetched = self.client.get_issue(number)
        self.assertEqual(fetched["number"], number)
        self.assertIn("[E2E] Create and Get", fetched["title"])

    def test_list_open_issues_returns_e2e_issue(self):
        issue = self._create_issue("[E2E] List Open Issues")
        time.sleep(1)  # let GitHub index the new issue
        issues = self.client.list_open_issues()
        numbers = [i["number"] for i in issues]
        self.assertIn(issue["number"], numbers)

    def test_create_and_read_comment(self):
        issue = self._create_issue("[E2E] Comment Round-Trip")
        comment = self.client.create_comment(issue["number"], "E2E agent comment")
        self.assertIn("id", comment)
        comments = self.client.get_issue_comments(issue["number"])
        bodies = [c["body"] for c in comments]
        self.assertIn("E2E agent comment", bodies)

    def test_add_and_remove_label(self):
        issue = self._create_issue("[E2E] Labels")
        self.client.add_labels(issue["number"], ["needs-human"])
        time.sleep(0.5)
        # Remove label — should not raise even if label absent (404 is tolerated)
        self.client.remove_label(issue["number"], "needs-human")

    def test_close_issue(self):
        issue = self._create_issue("[E2E] Close Issue")
        self.client.close_issue(issue["number"], state_reason="not_planned")
        self._opened_issues.remove(issue["number"])  # already closed, skip tearDown
        fetched = self.client.get_issue(issue["number"])
        self.assertEqual(fetched["state"], "closed")


@unittest.skipUnless(_GITHUB_TOKEN, _SKIP_REASON)
class TestSyncRoundTripE2E(unittest.TestCase):
    """Verify that sync_github_issues detects real GitHub issues as new_threads."""

    def setUp(self):
        from llm247_v2.github.client import GitHubClient
        from llm247_v2.storage.thread_store import ThreadStore
        from llm247_v2.storage.store import TaskStore

        self.client = GitHubClient(
            token=_GITHUB_TOKEN,
            owner=_GITHUB_OWNER,
            repo=_GITHUB_REPO,
            label=_E2E_LABEL,
        )
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.thread_store = ThreadStore(base / "threads.db")
        self.task_store = TaskStore(base / "tasks.db")
        self._opened_issues: list[int] = []

    def tearDown(self):
        for number in self._opened_issues:
            try:
                self.client.close_issue(number, state_reason="not_planned")
            except Exception:
                pass
        self.thread_store.close()
        self.task_store.close()
        self.tmp.cleanup()

    def test_new_issue_detected_as_new_thread(self):
        from llm247_v2.github.sync import sync_github_issues

        issue = self.client.create_issue("[E2E] Sync Round-Trip", "Test body for sync")
        self._opened_issues.append(issue["number"])
        time.sleep(1)

        result = sync_github_issues(self.client, self.thread_store, self.task_store)
        new_numbers = [t.github_issue_number for t in result.new_threads]
        self.assertIn(issue["number"], new_numbers)

    def test_outbox_flush_posts_comment_to_real_github(self):
        from llm247_v2.github.sync import sync_github_issues

        issue = self.client.create_issue("[E2E] Outbox Flush", "Comment test")
        self._opened_issues.append(issue["number"])
        time.sleep(1)

        # Mirror issue
        thread = self.thread_store.upsert_thread(issue)
        self.thread_store.queue_agent_comment(thread.id, "E2E outbox flush test")

        result = sync_github_issues(self.client, self.thread_store, self.task_store)
        self.assertGreaterEqual(result.comments_posted, 1)

        # Verify comment appeared on GitHub
        time.sleep(1)
        comments = self.client.get_issue_comments(issue["number"])
        bodies = [c["body"] for c in comments]
        self.assertIn("E2E outbox flush test", bodies)


if __name__ == "__main__":
    unittest.main()
