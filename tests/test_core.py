from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from llm247.reports import ReportWriter
from llm247.scheduler import is_task_due
from llm247.storage import TaskStateStore


class SchedulerTests(unittest.TestCase):
    """Validate scheduling decisions for periodic tasks."""

    def test_is_due_when_never_run(self) -> None:
        """A task without run history must execute immediately."""
        now = datetime(2026, 3, 4, 0, 0, tzinfo=timezone.utc)
        self.assertTrue(is_task_due(now=now, last_run_at=None, interval_seconds=60))

    def test_is_not_due_within_interval(self) -> None:
        """A task should wait until interval has elapsed."""
        now = datetime(2026, 3, 4, 0, 0, tzinfo=timezone.utc)
        last_run_at = now - timedelta(seconds=30)
        self.assertFalse(is_task_due(now=now, last_run_at=last_run_at, interval_seconds=60))

    def test_is_due_after_interval(self) -> None:
        """A task should execute after enough time has passed."""
        now = datetime(2026, 3, 4, 0, 0, tzinfo=timezone.utc)
        last_run_at = now - timedelta(seconds=61)
        self.assertTrue(is_task_due(now=now, last_run_at=last_run_at, interval_seconds=60))


class TaskStateStoreTests(unittest.TestCase):
    """Ensure task run timestamps persist across process restarts."""

    def test_marks_and_reads_last_run(self) -> None:
        """Persisted state must survive a new store instance."""
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "state.json"
            store = TaskStateStore(state_path)
            run_at = datetime(2026, 3, 4, 0, 0, tzinfo=timezone.utc)

            store.mark_run(task_name="demo", run_at=run_at)
            loaded = TaskStateStore(state_path).get_last_run("demo")

            self.assertEqual(run_at, loaded)

    def test_returns_none_for_unknown_task(self) -> None:
        """Unknown tasks should not crash and should return empty state."""
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "state.json"
            store = TaskStateStore(state_path)
            self.assertIsNone(store.get_last_run("missing"))

    def test_rewrites_invalid_state_file(self) -> None:
        """Corrupted state file should recover to an empty dict."""
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "state.json"
            state_path.write_text("{not_json", encoding="utf-8")
            store = TaskStateStore(state_path)

            run_at = datetime(2026, 3, 4, 0, 0, tzinfo=timezone.utc)
            store.mark_run(task_name="demo", run_at=run_at)

            data = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertIn("demo", data)


class ReportWriterTests(unittest.TestCase):
    """Verify report files are created with deterministic names."""

    def test_writes_markdown_report(self) -> None:
        """Writer should create a dated markdown report file."""
        with tempfile.TemporaryDirectory() as temp_dir:
            report_dir = Path(temp_dir)
            writer = ReportWriter(report_dir=report_dir)
            now = datetime(2026, 3, 4, 8, 30, tzinfo=timezone.utc)

            report_path = writer.write(
                task_name="engineering_watchdog",
                content="# Hello\n",
                generated_at=now,
            )

            self.assertTrue(report_path.exists())
            self.assertTrue(report_path.name.startswith("engineering_watchdog-20260304-083000"))
            self.assertIn("# Hello", report_path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
