import tempfile
import unittest
from pathlib import Path

from llm247_v2.__main__ import _bootstrap_status
from llm247_v2.core.models import ModelType
from llm247_v2.storage.model_registry import ModelRegistryStore


class TestBootstrapStatus(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = ModelRegistryStore(Path(self.tmp.name) / "models.db")

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def test_requires_setup_when_no_default_llm_exists(self):
        status = _bootstrap_status(self.store)

        self.assertFalse(status["ready"])
        self.assertTrue(status["requires_setup"])
        self.assertIn("default_llm", status["missing"])

    def test_is_ready_after_registering_one_llm(self):
        self.store.register_model(
            model_type=ModelType.LLM.value,
            base_url="https://example.com/v1",
            model_name="default-model",
            api_key="secret-ak",
        )

        status = _bootstrap_status(self.store)

        self.assertTrue(status["ready"])
        self.assertFalse(status["requires_setup"])
        self.assertEqual(status["missing"], [])


if __name__ == "__main__":
    unittest.main()
