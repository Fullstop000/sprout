import tempfile
from pathlib import Path
import unittest

from llm247_v2.dashboard.server import _api_tasks, _api_inject_task, _api_task_detail, _task_row, _task_full
from llm247_v2.core.models import Directive, Task, TaskStatus
from llm247_v2.storage.store import TaskStore
from llm247_v2.storage.thread_store import ThreadStore


class TestDashboardTasksAPI(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp.name) / "test.db"
        self.store = TaskStore(self.db_path)
        self.thread_store = ThreadStore(Path(self.tmp.name) / "threads.db")

    def tearDown(self):
        self.store.close()
        self.thread_store.close()
        self.tmp.cleanup()

    def test_api_tasks_empty(self):
        result = _api_tasks(self.store)
        self.assertIn("tasks", result)
        self.assertEqual(len(result["tasks"]), 0)

    def test_api_tasks_with_data(self):
        self.store.insert_task(Task(
            id="t1", title="Test", description="D", source="manual",
            status="queued", priority=2,
        ))
        result = _api_tasks(self.store)
        self.assertEqual(len(result["tasks"]), 1)
        self.assertEqual(result["tasks"][0]["title"], "Test")

    def test_inject_task(self):
        result = _api_inject_task(self.store, {"title": "Manual task", "priority": 1})
        self.assertEqual(result["status"], "ok")
        tasks = self.store.list_tasks()
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0].title, "Manual task")

    def test_inject_no_title(self):
        result = _api_inject_task(self.store, {})
        self.assertIn("error", result)


class TestTaskDetailAPI(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp.name) / "test.db"
        self.store = TaskStore(self.db_path)
        self.thread_store = ThreadStore(Path(self.tmp.name) / "threads.db")

    def tearDown(self):
        self.store.close()
        self.thread_store.close()
        self.tmp.cleanup()

    def test_task_detail_with_thread_store_linked(self):
        """_api_task_detail must not access removed Thread attributes."""
        self.store.insert_task(Task(
            id="ts1", title="Blocked Task", description="d",
            source="manual", status="needs_human", priority=2,
        ))
        thread = self.thread_store.create_thread(title="Blocked Task", created_by="agent", body="Need help")
        self.thread_store.link_task(thread.id, "ts1")
        result = _api_task_detail(self.store, "ts1", thread_store=self.thread_store)
        self.assertIn("task", result)
        self.assertIn("thread", result)
        thread_data = result["thread"]
        self.assertEqual(thread_data["id"], thread.id)
        self.assertEqual(thread_data["status"], "open")
        self.assertNotIn("github_issue_number", thread_data)
        self.assertIsInstance(thread_data["messages"], list)

    def test_task_detail_with_thread_store_no_link(self):
        """Result must not include 'thread' key when no thread is linked."""
        self.store.insert_task(Task(
            id="ts2", title="Unlinked Task", description="d",
            source="manual", status="queued", priority=2,
        ))
        result = _api_task_detail(self.store, "ts2", thread_store=self.thread_store)
        self.assertNotIn("thread", result)
