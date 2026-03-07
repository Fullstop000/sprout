from __future__ import annotations

"""Issue body and comment templates for all agent-generated GitHub content."""

from llm247_v2.core.models import Task

_FOOTER = "\n\n---\n*Reply to this issue to unblock execution. Sprout will pick up your response on the next cycle (~2 min).*"


def fmt_blocked_body(task: Task, dashboard_url: str = "") -> str:
    branch = f"`{task.branch_name}`" if task.branch_name else "none"
    detail_link = f"{dashboard_url}/tasks/{task.id}" if dashboard_url else f"task `{task.id}`"
    log_tail = _tail(task.execution_log, 20)
    return (
        f"## Blocked: {task.title}\n\n"
        f"**Task:** `{task.id}` | **Source:** {task.source} | **Branch:** {branch}\n"
        f"**Dashboard:** {detail_link}\n\n"
        f"## What I tried\n```\n{log_tail}\n```\n\n"
        f"## Where I'm stuck\n{task.human_help_request or '(see execution log above)'}"
        f"{_FOOTER}"
    )


def fmt_still_blocked(task: Task, attempt: int) -> str:
    return (
        f"**Still blocked** (attempt {attempt})\n\n"
        f"{task.human_help_request or task.error_message or '(see task detail for details)'}"
    )


def fmt_pickup(task_id: str) -> str:
    return f"Picked up as task `{task_id}`. Starting execution."


def fmt_pickup_decomposed(task_ids: list[str]) -> str:
    ids = ", ".join(f"`{t}`" for t in task_ids)
    return f"Decomposed into {len(task_ids)} sub-tasks: {ids}. Starting execution."


def fmt_completed(task: Task) -> str:
    pr = f"\n\nPR: {task.pr_url}" if task.pr_url else ""
    summary = _tail(task.execution_log, 5)
    return f"**Completed** ✓\n\n{summary}{pr}"


def fmt_abandoned(task: Task, attempts: int) -> str:
    err = task.error_message or "(see task detail)"
    return (
        f"**Giving up** after {attempts} attempt(s).\n\n"
        f"Last error: {err}\n\n"
        f"Task `{task.id}` marked as failed. "
        "Re-open this issue after resolving the underlying problem and Sprout will retry."
    )


def fmt_cancelled(task_id: str) -> str:
    return f"Acknowledged. Task `{task_id}` has been cancelled."


def _tail(text: str, n: int) -> str:
    if not text:
        return "(no log)"
    lines = text.strip().splitlines()
    return "\n".join(lines[-n:])
