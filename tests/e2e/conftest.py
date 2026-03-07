"""E2E test session fixtures — clean up stale sprout-e2e-test issues before running."""
from __future__ import annotations

import os

import pytest


@pytest.fixture(scope="session", autouse=True)
def cleanup_stale_e2e_issues():
    """Close any open sprout-e2e-test issues left from previous aborted runs."""
    token = os.getenv("GITHUB_TOKEN")
    if not token:
        yield
        return

    owner = os.getenv("GITHUB_OWNER", "Fullstop000")
    repo = os.getenv("GITHUB_REPO", "sprout")

    try:
        import httpx
        from llm247_v2.github.client import GitHubClient

        client = GitHubClient(token=token, owner=owner, repo=repo, label="sprout-e2e-test")
        stale = client.list_open_issues()
        for issue in stale:
            try:
                client.close_issue(issue["number"], state_reason="not_planned")
            except Exception:
                pass
        if stale:
            print(f"\n[E2E cleanup] Closed {len(stale)} stale sprout-e2e-test issue(s) before session.")
    except Exception:
        pass

    yield
