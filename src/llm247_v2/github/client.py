from __future__ import annotations

import logging
from typing import Optional

import httpx

logger = logging.getLogger("llm247_v2.github.client")

_BASE = "https://api.github.com"
_TIMEOUT = 15.0


class GitHubClient:
    """Thin httpx wrapper over the GitHub Issues REST API."""

    def __init__(
        self,
        token: str,
        owner: str,
        repo: str,
        label: str = "sprout",
        assignees: Optional[list[str]] = None,
    ) -> None:
        self._owner = owner
        self._repo = repo
        self.label = label
        self.assignees = assignees or []
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def _url(self, path: str) -> str:
        return f"{_BASE}/repos/{self._owner}/{self._repo}{path}"

    def list_open_issues(self, since: Optional[str] = None) -> list[dict]:
        """List open issues with this client's label, optionally filtered by update time."""
        params: dict = {"state": "open", "labels": self.label, "per_page": 100}
        if since:
            params["since"] = since
        resp = httpx.get(self._url("/issues"), headers=self._headers,
                         params=params, timeout=_TIMEOUT)
        resp.raise_for_status()
        # GitHub /issues returns PRs too — filter them out
        return [i for i in resp.json() if "pull_request" not in i]

    def get_issue(self, issue_number: int) -> dict:
        resp = httpx.get(self._url(f"/issues/{issue_number}"),
                         headers=self._headers, timeout=_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    def get_issue_comments(
        self, issue_number: int, since: Optional[str] = None
    ) -> list[dict]:
        params: dict = {"per_page": 100}
        if since:
            params["since"] = since
        resp = httpx.get(self._url(f"/issues/{issue_number}/comments"),
                         headers=self._headers, params=params, timeout=_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    def create_issue(
        self,
        title: str,
        body: str,
        assignees: Optional[list[str]] = None,
        labels: Optional[list[str]] = None,
    ) -> dict:
        payload: dict = {"title": title, "body": body}
        payload["labels"] = labels if labels is not None else [self.label]
        if assignees is not None:
            payload["assignees"] = assignees
        elif self.assignees:
            payload["assignees"] = self.assignees
        resp = httpx.post(self._url("/issues"), headers=self._headers,
                          json=payload, timeout=_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    def add_labels(self, issue_number: int, labels: list[str]) -> None:
        resp = httpx.post(self._url(f"/issues/{issue_number}/labels"),
                          headers=self._headers, json={"labels": labels},
                          timeout=_TIMEOUT)
        resp.raise_for_status()

    def remove_label(self, issue_number: int, label: str) -> None:
        resp = httpx.delete(self._url(f"/issues/{issue_number}/labels/{label}"),
                            headers=self._headers, timeout=_TIMEOUT)
        if resp.status_code != 404:
            resp.raise_for_status()

    def create_comment(self, issue_number: int, body: str) -> dict:
        resp = httpx.post(self._url(f"/issues/{issue_number}/comments"),
                          headers=self._headers, json={"body": body},
                          timeout=_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    def close_issue(
        self, issue_number: int, state_reason: str = "completed"
    ) -> None:
        """Close an issue. state_reason: 'completed' | 'not_planned'."""
        resp = httpx.patch(self._url(f"/issues/{issue_number}"),
                           headers=self._headers,
                           json={"state": "closed", "state_reason": state_reason},
                           timeout=_TIMEOUT)
        resp.raise_for_status()
