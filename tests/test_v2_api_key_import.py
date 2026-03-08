import tempfile
import unittest
from pathlib import Path

from llm247_v2.core.models import ModelType
from llm247_v2.storage.model_registry import ModelRegistryStore


class TestApiKeyImport(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.workspace = Path(self.tmp.name)
        self.model_store = ModelRegistryStore(self.workspace / "models.db")
        self.api_key_file = self.workspace / "api_key.yaml"

    def tearDown(self):
        self.model_store.close()
        self.tmp.cleanup()

    def write_sample(self, text: str) -> None:
        self.api_key_file.write_text(text, encoding="utf-8")

    def test_parse_api_key_yaml_reads_sample_shape(self):
        from llm247_v2.startup.api_key_import import parse_api_key_yaml

        self.write_sample(
            """kimi-2.5-code:
  model: kimi-for-coding
  entrypoint: https://api.kimi.com/coding/v1
  ak: secret-ak
  desc: kimi 2.5 code
  model_family: kimi
  type: llm
  roocode_wrapper: true
"""
        )

        entries = parse_api_key_yaml(self.api_key_file)

        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].alias, "kimi-2.5-code")
        self.assertEqual(entries[0].model_name, "kimi-for-coding")
        self.assertEqual(entries[0].endpoint, "https://api.kimi.com/coding/v1")
        self.assertEqual(entries[0].api_key, "secret-ak")
        self.assertEqual(entries[0].model_type, ModelType.LLM.value)
        self.assertTrue(entries[0].roocode_wrapper)

    def test_import_api_key_file_registers_model(self):
        from llm247_v2.startup.api_key_import import import_api_key_file

        self.write_sample(
            """kimi-2.5-code:
  model: kimi-for-coding
  entrypoint: https://api.kimi.com/coding/v1
  ak: secret-ak
  desc: kimi 2.5 code
  type: llm
  roocode_wrapper: true
"""
        )

        imported = import_api_key_file(self.model_store, self.api_key_file)
        models = self.model_store.list_models()

        self.assertEqual(len(imported), 1)
        self.assertEqual(len(models), 1)
        self.assertEqual(models[0].model_name, "kimi-for-coding")
        self.assertEqual(models[0].base_url, "https://api.kimi.com/coding/v1")
        self.assertEqual(models[0].api_key, "secret-ak")
        self.assertTrue(models[0].roocode_wrapper)

    def test_import_api_key_file_updates_matching_model_instead_of_duplicating(self):
        from llm247_v2.startup.api_key_import import import_api_key_file

        self.write_sample(
            """kimi-2.5-code:
  model: kimi-for-coding
  entrypoint: https://api.kimi.com/coding/v1
  ak: secret-ak
  desc: first import
  type: llm
"""
        )
        import_api_key_file(self.model_store, self.api_key_file)

        self.write_sample(
            """kimi-2.5-code:
  model: kimi-for-coding
  entrypoint: https://api.kimi.com/coding/v1
  ak: rotated-secret-ak
  desc: updated import
  type: llm
"""
        )
        imported = import_api_key_file(self.model_store, self.api_key_file)
        models = self.model_store.list_models()

        self.assertEqual(len(imported), 1)
        self.assertEqual(len(models), 1)
        self.assertEqual(models[0].api_key, "rotated-secret-ak")
        self.assertEqual(models[0].desc, "updated import")


if __name__ == "__main__":
    unittest.main()
