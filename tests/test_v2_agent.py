import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from llm247_v2.agent import AutonomousAgentV2, run_agent_loop
from llm247_v2.core.constitution import load_constitution
from llm247_v2.core.directive import save_directive
from llm247_v2.execution.executor import ExecutionResult
from llm247_v2.llm.client import BudgetExhaustedError
from llm247_v2.core.models import Directive, PlanStep, Task, TaskPlan, TaskSourceConfig, TaskStatus
from llm247_v2.observability.observer import MemoryHandler, Observer
from llm247_v2.storage.store import TaskStore
from llm247_v2.execution.verifier import CheckResult, VerificationResult


class FakeLLM:
    def __init__(self):
        self.call_count = 0

    def generate(self, prompt: str) -> str:
        self.call_count += 1
        return '{"tasks": [{"title": "Improve test coverage", "description": "Add tests", "priority": 2}]}'


class TestAutonomousAgentV2(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.workspace = Path(self.tmp.name)
        (self.workspace / "src").mkdir()
        (self.workspace / "tests").mkdir()
        (self.workspace / "src" / "example.py").write_text("x = 1\n", encoding="utf-8")

        self.state_dir = self.workspace / ".llm247_v2"
        self.db_path = self.state_dir / "tasks.db"
        self.directive_path = self.state_dir / "directive.json"
        self.constitution_path = self.state_dir / "constitution.md"
        self.exploration_map_path = self.state_dir / "exploration_map.json"

        self.store = TaskStore(self.db_path)
        self.llm = FakeLLM()

        directive = Directive(
            task_sources={
                "todo_scan": TaskSourceConfig(enabled=False),
                "test_gap": TaskSourceConfig(enabled=True, priority=2),
                "lint_check": TaskSourceConfig(enabled=False),
                "self_improvement": TaskSourceConfig(enabled=False),
            }
        )
        save_directive(self.directive_path, directive)

        self.memory_handler = MemoryHandler()
        self.observer = Observer(handlers=[self.memory_handler])

        self.agent = AutonomousAgentV2(
            workspace=self.workspace,
            store=self.store,
            llm=self.llm,
            directive_path=self.directive_path,
            constitution_path=self.constitution_path,
            exploration_map_path=self.exploration_map_path,
            observer=self.observer,
        )

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def test_paused_directive_skips_cycle(self):
        directive = Directive(paused=True)
        save_directive(self.directive_path, directive)
        result = self.agent.run_cycle()
        self.assertEqual(result["status"], "paused")
        paused_events = self.memory_handler.find(phase="cycle", action="paused")
        self.assertEqual(len(paused_events), 1)

    def test_discovery_phase_creates_tasks(self):
        result = self.agent.run_cycle()
        self.assertGreaterEqual(result["tasks_discovered"], 0)
        cycles = self.store.get_recent_cycles()
        self.assertEqual(len(cycles), 1)

    def test_cycle_creates_cycle_record(self):
        self.agent.run_cycle()
        cycles = self.store.get_recent_cycles()
        self.assertGreater(len(cycles), 0)
        self.assertEqual(cycles[0].status, "completed")

    def test_observer_receives_cycle_events(self):
        self.agent.run_cycle()
        starts = self.memory_handler.find(phase="cycle", action="started")
        ends = self.memory_handler.find(phase="cycle", action="completed")
        self.assertEqual(len(starts), 1)
        self.assertEqual(len(ends), 1)

    def test_execution_failure_requests_human_help(self):
        task = Task(
            id="needs-help-1",
            title="Task that needs human help",
            description="manual test",
            source="manual",
            status=TaskStatus.QUEUED.value,
            priority=1,
        )
        self.store.insert_task(task)

        plan = TaskPlan(
            task_id=task.id,
            steps=[PlanStep(action="run_command", target="false")],
            commit_message="fix(test): simulate blocked command",
            pr_title="",
            pr_body="",
        )
        failed_result = ExecutionResult(step_index=0, action="run_command", target="false", success=False, output="command failed")
        directive = Directive()
        constitution = load_constitution(self.constitution_path)

        with patch("llm247_v2.agent.plan_task_with_constitution", return_value=plan):
            with patch.object(self.agent, "_cleanup_worktree"):
                with patch("llm247_v2.agent.PlanExecutor") as MockExecutor:
                    MockExecutor.return_value.execute_plan.return_value = (False, [failed_result])
                    success = self.agent._execute_single_task(task, directive, constitution)

        self.assertFalse(success)
        updated = self.store.get_task(task.id)
        self.assertEqual(updated.status, TaskStatus.NEEDS_HUMAN.value)
        self.assertTrue(updated.human_help_request)
        # Verify structured help request includes context
        self.assertIn("Task that needs human help", updated.human_help_request)
        self.assertIn("Execution", updated.human_help_request)
        self.assertIn("Suggested actions", updated.human_help_request)

        # Verify observer got task_needs_human, not task_failed
        needs_human_events = self.memory_handler.find(phase="execute", action="task_needs_human")
        self.assertEqual(len(needs_human_events), 1)

    def test_human_resolved_task_continues_verification(self):
        task = Task(
            id="needs-help-2",
            title="Resume verification",
            description="manual test",
            source="manual",
            status=TaskStatus.HUMAN_RESOLVED.value,
            priority=1,
            execution_log="[0] OK edit_file src/example.py",
            human_help_request="",
        )
        self.store.insert_task(task)

        directive = Directive()
        constitution = load_constitution(self.constitution_path)
        passing_verification = VerificationResult(
            passed=True,
            checks=[CheckResult(name="tests", passed=True, output="ok")],
            summary="tests: PASS",
        )

        with patch("llm247_v2.agent.plan_task_with_constitution") as plan_mock:
            with patch("llm247_v2.agent.verify_task", return_value=passing_verification):
                success = self.agent._execute_single_task(task, directive, constitution)

        self.assertTrue(success)
        plan_mock.assert_not_called()
        updated = self.store.get_task(task.id)
        self.assertEqual(updated.status, TaskStatus.COMPLETED.value)


class TestRunAgentLoop(unittest.TestCase):
    def _make_agent_mock(self, **overrides):
        agent = MagicMock()
        agent.shutdown_requested = False
        for k, v in overrides.items():
            setattr(agent, k, v)
        return agent

    def test_max_cycles(self):
        agent = self._make_agent_mock()
        agent.run_cycle.return_value = {"status": "ok"}
        noop = lambda _: None
        reason = run_agent_loop(agent, poll_interval=0, max_cycles=2, sleeper=noop)
        self.assertEqual(reason, "max_cycles_reached")
        self.assertEqual(agent.run_cycle.call_count, 2)

    def test_budget_exhausted(self):
        agent = self._make_agent_mock()
        agent.run_cycle.side_effect = BudgetExhaustedError("quota exceeded")
        noop = lambda _: None
        reason = run_agent_loop(agent, poll_interval=0, max_cycles=10, sleeper=noop)
        self.assertEqual(reason, "budget_exhausted")

    def test_shutdown_event_stops_loop(self):
        agent = self._make_agent_mock(shutdown_requested=True)
        noop = lambda _: None
        reason = run_agent_loop(agent, poll_interval=0, max_cycles=10, sleeper=noop)
        self.assertEqual(reason, "interrupted")
        agent.run_cycle.assert_not_called()


if __name__ == "__main__":
    unittest.main()
