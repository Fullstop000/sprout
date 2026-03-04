from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional


# Core scheduler decision: whether a task should run at this moment.
def is_task_due(
    now: datetime,
    last_run_at: Optional[datetime],
    interval_seconds: int,
) -> bool:
    """Return True when a task has never run or interval has elapsed."""
    if interval_seconds <= 0:
        raise ValueError("interval_seconds must be greater than 0")

    if last_run_at is None:
        return True

    return now - last_run_at >= timedelta(seconds=interval_seconds)
