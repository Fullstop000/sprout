from __future__ import annotations

from datetime import datetime
from pathlib import Path


class ReportWriter:
    """Write model outputs into timestamped markdown reports."""

    def __init__(self, report_dir: Path) -> None:
        self.report_dir = report_dir

    def write(self, task_name: str, content: str, generated_at: datetime) -> Path:
        """Create and return a report path for one task execution."""
        self.report_dir.mkdir(parents=True, exist_ok=True)
        safe_task_name = "".join(
            char if char.isalnum() or char in ("-", "_") else "_" for char in task_name
        )
        file_name = "{task}-{stamp}.md".format(
            task=safe_task_name,
            stamp=generated_at.strftime("%Y%m%d-%H%M%S"),
        )
        path = self.report_dir / file_name
        path.write_text(content, encoding="utf-8")
        return path
