from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from llm247.reports import ReportWriter
from llm247.storage import TaskStateStore
from llm247.worker import ContinuousWorker, WorkerTask


class FakeClient:
    """A deterministic model client for worker behavior tests."""

    def __init__(self) -> None:
        self.prompts = []

    def generate_text(self, prompt: str) -> str:
        self.prompts.append(prompt)
        return "model-result"


class WorkerTests(unittest.TestCase):
    """Cover key worker scheduling and fault isolation behaviors."""

    def test_runs_due_task_and_writes_report(self) -> None:
        """Due tasks should call model client and persist outputs."""
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            state_store = TaskStateStore(root / "state.json")
            report_writer = ReportWriter(root / "reports")
            model_client = FakeClient()
            task = WorkerTask(
                name="watchdog",
                interval_seconds=60,
                prompt_builder=lambda ctx: "check repo",
            )
            worker = ContinuousWorker(
                workspace_path=root,
                state_store=state_store,
                report_writer=report_writer,
                model_client=model_client,
                tasks=[task],
            )

            now = datetime(2026, 3, 4, 0, 0, tzinfo=timezone.utc)
            generated = worker.run_once(now=now)

            self.assertEqual(1, len(generated))
            self.assertEqual(["check repo"], model_client.prompts)
            self.assertIsNotNone(state_store.get_last_run("watchdog"))

    def test_skips_task_when_interval_not_reached(self) -> None:
        """Recently executed tasks should not consume tokens again immediately."""
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            state_store = TaskStateStore(root / "state.json")
            report_writer = ReportWriter(root / "reports")
            model_client = FakeClient()

            run_at = datetime(2026, 3, 4, 0, 0, tzinfo=timezone.utc)
            state_store.mark_run("watchdog", run_at)

            task = WorkerTask(
                name="watchdog",
                interval_seconds=120,
                prompt_builder=lambda ctx: "check repo",
            )
            worker = ContinuousWorker(
                workspace_path=root,
                state_store=state_store,
                report_writer=report_writer,
                model_client=model_client,
                tasks=[task],
            )

            generated = worker.run_once(now=run_at + timedelta(seconds=30))

            self.assertEqual([], generated)
            self.assertEqual([], model_client.prompts)

    def test_continues_when_one_task_fails(self) -> None:
        """Worker should isolate task failures and continue executing others."""

        def fail_builder(ctx) -> str:
            raise RuntimeError("boom")

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            state_store = TaskStateStore(root / "state.json")
            report_writer = ReportWriter(root / "reports")
            model_client = FakeClient()

            tasks = [
                WorkerTask(name="broken", interval_seconds=1, prompt_builder=fail_builder),
                WorkerTask(name="healthy", interval_seconds=1, prompt_builder=lambda ctx: "ok"),
            ]
            worker = ContinuousWorker(
                workspace_path=root,
                state_store=state_store,
                report_writer=report_writer,
                model_client=model_client,
                tasks=tasks,
            )

            now = datetime(2026, 3, 4, 0, 0, tzinfo=timezone.utc)
            generated = worker.run_once(now=now)

            self.assertEqual(1, len(generated))
            self.assertEqual(["ok"], model_client.prompts)
            self.assertIsNone(state_store.get_last_run("broken"))
            self.assertEqual(now, state_store.get_last_run("healthy"))


if __name__ == "__main__":
    unittest.main()
