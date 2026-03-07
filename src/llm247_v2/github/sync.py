from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

from llm247_v2.github.client import GitHubClient
from llm247_v2.storage.store import TaskStore
from llm247_v2.storage.thread_store import Message, Thread, ThreadStore

logger = logging.getLogger("llm247_v2.github.sync")


@dataclass
class SyncResult:
    new_threads: list[Thread] = field(default_factory=list)
    """Shape B: newly detected issues with no linked task."""

    unblocked: list[tuple[Thread, list[Message]]] = field(default_factory=list)
    """Shape A: awaiting_human threads that now have new human replies."""

    cancelled_task_ids: list[str] = field(default_factory=list)
    """Tasks whose linked issue was closed by a human."""

    comments_posted: int = 0
    """Number of pending agent comments successfully flushed to GitHub."""


def sync_github_issues(
    github: GitHubClient,
    thread_store: ThreadStore,
    task_store: TaskStore,
    since: Optional[str] = None,
) -> SyncResult:
    """One sync cycle: mirror GitHub → local, return actionable result sets."""
    result = SyncResult()

    # 1. Flush outbox first so human sees agent responses promptly
    result.comments_posted = _flush_outbox(github, thread_store)

    # 2. Fetch open issues from GitHub
    try:
        open_issues = github.list_open_issues(since=since)
    except Exception as exc:
        logger.warning("GitHub list_open_issues failed: %s", exc)
        return result

    open_numbers = {i["number"] for i in open_issues}

    # 3. Mirror each open issue and its new comments
    for issue in open_issues:
        number = issue["number"]
        thread = thread_store.upsert_thread(issue, created_by="human")

        # Fetch comments since last sync for this thread
        new_comments = _sync_comments(github, thread_store, thread, since)

        if thread.status == "pending":
            result.new_threads.append(thread)

        elif thread.status == "awaiting_human" and new_comments:
            human_comments = [m for m in new_comments if m.role == "human"]
            if human_comments:
                thread_store.set_status(thread.id, "human_responded")
                # Reload updated thread
                updated = thread_store.get_thread_by_issue_number(number)
                result.unblocked.append((updated or thread, human_comments))

        thread_store.mark_last_synced(thread.id)

    # 4. Detect issues closed by human: any non-closed thread whose issue is no longer open
    _detect_human_closed(github, thread_store, task_store, open_numbers, result)

    return result


def _sync_comments(
    github: GitHubClient,
    thread_store: ThreadStore,
    thread: Thread,
    since: Optional[str],
) -> list[Message]:
    """Fetch new comments for one issue and mirror them; return newly added messages."""
    try:
        raw_comments = github.get_issue_comments(
            thread.github_issue_number, since=thread.last_synced_at or since
        )
    except Exception as exc:
        logger.warning("Failed to fetch comments for issue #%d: %s",
                       thread.github_issue_number, exc)
        return []

    new_messages: list[Message] = []
    for comment in raw_comments:
        role = "agent" if comment.get("performed_via_github_app") else "human"
        msg = thread_store.upsert_message(
            thread_id=thread.id,
            role=role,
            body=comment["body"],
            github_comment_id=comment["id"],
            created_at=comment["created_at"],
        )
        new_messages.append(msg)
    return new_messages


def _detect_human_closed(
    github: GitHubClient,
    thread_store: ThreadStore,
    task_store: TaskStore,
    open_numbers: set[int],
    result: SyncResult,
) -> None:
    """Mark threads whose GitHub issues were closed by humans."""
    active_statuses = ("pending", "linked", "awaiting_human", "human_responded")
    for status in active_statuses:
        for thread in _get_threads_by_status(thread_store, status):
            if thread.github_issue_number not in open_numbers:
                # Verify it's actually closed (not just outside the since window)
                try:
                    issue = github.get_issue(thread.github_issue_number)
                except Exception:
                    continue
                if issue.get("state") == "closed":
                    thread_store.set_status(thread.id, "closed_cancelled")
                    for task_id in thread_store.get_tasks_for_thread(thread.id):
                        result.cancelled_task_ids.append(task_id)
                    logger.info("Issue #%d closed by human — %d task(s) cancelled",
                                thread.github_issue_number,
                                len(thread_store.get_tasks_for_thread(thread.id)))


def _get_threads_by_status(thread_store: ThreadStore, status: str) -> list[Thread]:
    # ThreadStore exposes pending and awaiting_human; use internal query for others
    if status == "pending":
        return thread_store.get_pending_threads()
    if status == "awaiting_human":
        return thread_store.get_threads_awaiting_human()
    # For linked / human_responded query directly
    with thread_store._lock:
        rows = thread_store._conn.execute(
            "SELECT * FROM threads WHERE status=?", (status,)
        ).fetchall()
    from llm247_v2.storage.thread_store import _row_to_thread
    return [_row_to_thread(r) for r in rows]


def _flush_outbox(github: GitHubClient, thread_store: ThreadStore) -> int:
    """Post pending agent comments to GitHub; return count posted."""
    posted = 0
    for pc in thread_store.get_pending_comments():
        thread = thread_store.get_thread_by_issue_number(0)  # need number
        # Look up thread to get issue number
        with thread_store._lock:
            row = thread_store._conn.execute(
                "SELECT t.github_issue_number FROM threads t WHERE t.id=?",
                (pc.thread_id,),
            ).fetchone()
        if not row:
            continue
        issue_number = row[0]
        try:
            comment = github.create_comment(issue_number, pc.body)
            thread_store.mark_comment_posted(pc.id, comment["id"])
            posted += 1
        except Exception as exc:
            logger.warning("Failed to post comment to issue #%d: %s", issue_number, exc)
    return posted
