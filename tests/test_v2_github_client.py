from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from llm247_v2.github.client import GitHubClient


def _make_client(**kwargs):
    return GitHubClient(token="tok", owner="owner", repo="repo", **kwargs)


def _mock_response(json_data, status_code=200):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.raise_for_status = MagicMock()
    return resp


class TestGitHubClientListOpenIssues(unittest.TestCase):
    def test_filters_pull_requests(self):
        issues = [
            {"number": 1, "title": "Bug", "html_url": "u1"},
            {"number": 2, "title": "PR", "html_url": "u2", "pull_request": {}},
        ]
        with patch("httpx.get", return_value=_mock_response(issues)):
            client = _make_client()
            result = client.list_open_issues()
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["number"], 1)

    def test_passes_label_and_state_params(self):
        with patch("httpx.get", return_value=_mock_response([])) as mock_get:
            client = _make_client(label="sprout")
            client.list_open_issues()
            call_kwargs = mock_get.call_args
            params = call_kwargs.kwargs.get("params") or call_kwargs[1].get("params", {})
            self.assertEqual(params["labels"], "sprout")
            self.assertEqual(params["state"], "open")

    def test_passes_since_param_when_provided(self):
        with patch("httpx.get", return_value=_mock_response([])) as mock_get:
            _make_client().list_open_issues(since="2024-01-01T00:00:00Z")
            params = mock_get.call_args.kwargs.get("params") or mock_get.call_args[1]["params"]
            self.assertIn("since", params)


class TestGitHubClientGetIssue(unittest.TestCase):
    def test_returns_issue_dict(self):
        payload = {"number": 5, "state": "open", "title": "Test"}
        with patch("httpx.get", return_value=_mock_response(payload)):
            result = _make_client().get_issue(5)
        self.assertEqual(result["number"], 5)


class TestGitHubClientCreateIssue(unittest.TestCase):
    def test_uses_default_label(self):
        payload = {"number": 10, "html_url": "https://github.com/owner/repo/issues/10"}
        with patch("httpx.post", return_value=_mock_response(payload)) as mock_post:
            client = _make_client(label="sprout")
            result = client.create_issue("Title", "Body")
        sent = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1]["json"]
        self.assertIn("sprout", sent["labels"])
        self.assertEqual(result["number"], 10)

    def test_uses_default_assignees(self):
        with patch("httpx.post", return_value=_mock_response({"number": 1})) as mock_post:
            client = _make_client(assignees=["alice", "bob"])
            client.create_issue("Title", "Body")
        sent = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1]["json"]
        self.assertEqual(sent["assignees"], ["alice", "bob"])

    def test_override_assignees(self):
        with patch("httpx.post", return_value=_mock_response({"number": 1})) as mock_post:
            client = _make_client(assignees=["alice"])
            client.create_issue("Title", "Body", assignees=["charlie"])
        sent = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1]["json"]
        self.assertEqual(sent["assignees"], ["charlie"])


class TestGitHubClientCreateComment(unittest.TestCase):
    def test_posts_comment(self):
        payload = {"id": 99, "body": "hello"}
        with patch("httpx.post", return_value=_mock_response(payload)) as mock_post:
            result = _make_client().create_comment(3, "hello")
        self.assertEqual(result["id"], 99)
        url_arg = mock_post.call_args.args[0] if mock_post.call_args.args else mock_post.call_args[0][0]
        self.assertIn("/issues/3/comments", url_arg)


class TestGitHubClientCloseIssue(unittest.TestCase):
    def test_patches_state_closed(self):
        with patch("httpx.patch", return_value=_mock_response({})) as mock_patch:
            _make_client().close_issue(7, state_reason="completed")
        sent = mock_patch.call_args.kwargs.get("json") or mock_patch.call_args[1]["json"]
        self.assertEqual(sent["state"], "closed")
        self.assertEqual(sent["state_reason"], "completed")


class TestGitHubClientLabels(unittest.TestCase):
    def test_add_labels(self):
        with patch("httpx.post", return_value=_mock_response([])) as mock_post:
            _make_client().add_labels(1, ["needs-human"])
        sent = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1]["json"]
        self.assertEqual(sent["labels"], ["needs-human"])

    def test_remove_label_ignores_404(self):
        resp = _mock_response({}, status_code=404)
        resp.raise_for_status.side_effect = Exception("should not raise")
        with patch("httpx.delete", return_value=resp):
            # Should not raise
            _make_client().remove_label(1, "sprout")


if __name__ == "__main__":
    unittest.main()
