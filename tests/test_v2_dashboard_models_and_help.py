import tempfile
from pathlib import Path
import unittest

from llm247_v2.dashboard.server import (
    _api_models, _api_register_model, _api_update_model, _api_delete_model,
    _api_set_model_bindings, _api_stats, _api_help_center, _api_resolve_help_request,
    _api_experiences, _api_bootstrap_status, _api_discovery
)
from llm247_v2.core.models import Directive, ModelBindingPoint, ModelType, Task, TaskStatus
from llm247_v2.storage.model_registry import ModelRegistryStore
from llm247_v2.storage.store import TaskStore
from llm247_v2.storage.experience import Experience, ExperienceStore


class TestDashboardModelsAPI(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp.name) / "test.db"
        self.store = TaskStore(self.db_path)
        self.model_store = ModelRegistryStore(Path(self.tmp.name) / "models.db")
        self.directive_path = Path(self.tmp.name) / "directive.json"
        save_directive(self.directive_path, Directive())

    def tearDown(self):
        self.model_store.close()
        self.store.close()
        self.tmp.cleanup()

    def test_register_model_api_persists_model(self):
        payload = _api_register_model(
            self.model_store,
            {
                "model_type": ModelType.LLM.value,
                "base_url": "https://example.com/v1",
                "model_name": "planner-model",
                "api_key": "secret-ak",
                "desc": "Primary planner model",
            },
        )

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["model"]["model_name"], "planner-model")
        self.assertEqual(payload["model"]["api_key_preview"], "se***ak")
        self.assertEqual(payload["model"]["desc"], "Primary planner model")

    def test_register_embedding_model_api_persists_api_path(self):
        payload = _api_register_model(
            self.model_store,
            {
                "model_type": ModelType.EMBEDDING.value,
                "api_path": "https://ark.example.com/api/v3/embeddings/multimodal",
                "model_name": "embed-model",
                "api_key": "embed-ak",
                "desc": "Multimodal embedding endpoint",
            },
        )

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["model"]["model_type"], ModelType.EMBEDDING.value)
        self.assertEqual(
            payload["model"]["api_path"],
            "https://ark.example.com/api/v3/embeddings/multimodal",
        )
        self.assertEqual(payload["model"]["base_url"], "")

    def test_bootstrap_status_requires_setup_without_default_llm(self):
        payload = _api_bootstrap_status(self.model_store)

        self.assertFalse(payload["ready"])
        self.assertTrue(payload["requires_setup"])
        self.assertIn("default_llm", payload["missing"])

    def test_models_api_returns_models_and_binding_points(self):
        model = self.model_store.register_model(
            model_type=ModelType.LLM.value,
            base_url="https://example.com/v1",
            model_name="planner-model",
            api_key="secret-ak",
            desc="Primary planner model",
        )
        self.model_store.set_binding(ModelBindingPoint.EXECUTION.value, model.id)

        payload = _api_models(self.model_store)

        self.assertEqual(len(payload["models"]), 1)
        self.assertEqual(payload["bindings"][ModelBindingPoint.EXECUTION.value]["model_id"], model.id)
        self.assertTrue(any(item["binding_point"] == ModelBindingPoint.EXECUTION.value for item in payload["binding_points"]))


class TestDashboardHelpAndExperiencesAPI(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp.name) / "test.db"
        self.store = TaskStore(self.db_path)
        self.exp_store = ExperienceStore(Path(self.tmp.name) / "experience.db")
        self.directive_path = Path(self.tmp.name) / "directive.json"
        save_directive(self.directive_path, Directive())

    def tearDown(self):
        self.store.close()
        self.exp_store.close()
        self.tmp.cleanup()

    def test_api_stats(self):
        self.store.insert_task(Task(
            id="t1", title="T", description="D", source="manual",
            status="completed", priority=2,
        ))
        stats = _api_stats(self.store)
        self.assertEqual(stats["total_tasks"], 1)
        self.assertIn("completed", stats["status_counts"])

    def test_help_center_lists_only_needs_human(self):
        needs_help = Task(
            id="h1",
            title="Needs Human",
            description="blocked",
            source="manual",
            status=TaskStatus.NEEDS_HUMAN.value,
            priority=1,
            human_help_request="Please resolve credentials issue in runtime env.",
        )
        normal = Task(
            id="q1",
            title="Queued",
            description="normal",
            source="manual",
            status=TaskStatus.QUEUED.value,
            priority=2,
        )
        self.store.insert_task(needs_help)
        self.store.insert_task(normal)

        result = _api_help_center(self.store)
        self.assertEqual(len(result["requests"]), 1)
        self.assertEqual(result["requests"][0]["id"], "h1")
        self.assertIn("credentials issue", result["requests"][0]["human_help_request"])

    def test_help_center_resolve_transitions_to_human_resolved(self):
        task = Task(
            id="h2",
            title="Need resolve",
            description="blocked",
            source="manual",
            status=TaskStatus.NEEDS_HUMAN.value,
            priority=2,
            human_help_request="Please fix flaky external service.",
        )
        self.store.insert_task(task)

        result = _api_resolve_help_request(self.store, {"task_id": "h2", "resolution": "Service restored"})
        self.assertEqual(result["status"], "ok")

        updated = self.store.get_task("h2")
        self.assertEqual(updated.status, TaskStatus.HUMAN_RESOLVED.value)
        self.assertEqual(updated.human_help_request, "")

        events = self.store.get_events("h2")
        self.assertTrue(any(e["event_type"] == "human_resolved" for e in events))

    def test_experiences_returns_recent_entries(self):
        self.exp_store.add(
            Experience(
                id="exp1",
                task_id="t1",
                category="insight",
                summary="Always check task status transitions.",
                detail="A missing transition can stall the queue.",
                confidence=0.9,
            )
        )
        result = _api_experiences(self.exp_store, limit=10, category="", query="")
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["experiences"][0]["id"], "exp1")
        self.assertEqual(result["experiences"][0]["category"], "insight")
