from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from llm247.config import WorkerConfig


class WorkerConfigTests(unittest.TestCase):
    """Validate environment-based configuration loading behavior."""

    def test_loads_api_key_from_dotenv_when_env_missing(self) -> None:
        """Config should read ARK_API_KEY from .env in current workspace."""
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / ".env").write_text(
                "ARK_API_KEY=dotenv-secret\nARK_MODEL=ep-test-model\n",
                encoding="utf-8",
            )

            with patch.dict(os.environ, {}, clear=True):
                previous_cwd = Path.cwd()
                try:
                    os.chdir(root)
                    config = WorkerConfig.from_env()
                finally:
                    os.chdir(previous_cwd)

            self.assertEqual("dotenv-secret", config.api_key)
            self.assertEqual("autonomous", config.run_mode)
            self.assertEqual(5, config.autonomous_max_actions)
            self.assertEqual(30, config.log_retention_days)
            self.assertEqual(5, config.daemon_restart_delay_seconds)
            self.assertEqual(0, config.daemon_max_restarts)

    def test_rejects_missing_model_name(self) -> None:
        """Config should require ARK_MODEL from environment."""
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / ".env").write_text("ARK_API_KEY=dotenv-secret\n", encoding="utf-8")

            with patch.dict(os.environ, {}, clear=True):
                previous_cwd = Path.cwd()
                try:
                    os.chdir(root)
                    with self.assertRaises(ValueError):
                        WorkerConfig.from_env()
                finally:
                    os.chdir(previous_cwd)

    def test_rejects_invalid_run_mode(self) -> None:
        """Config should fail fast for unsupported RUN_MODE values."""
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / ".env").write_text(
                "ARK_API_KEY=dotenv-secret\nARK_MODEL=ep-test-model\nRUN_MODE=invalid\n",
                encoding="utf-8",
            )

            with patch.dict(os.environ, {}, clear=True):
                previous_cwd = Path.cwd()
                try:
                    os.chdir(root)
                    with self.assertRaises(ValueError):
                        WorkerConfig.from_env()
                finally:
                    os.chdir(previous_cwd)

    def test_rejects_negative_daemon_max_restarts(self) -> None:
        """Config should reject negative daemon restart limits."""
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / ".env").write_text(
                "ARK_API_KEY=dotenv-secret\nARK_MODEL=ep-test-model\nDAEMON_MAX_RESTARTS=-1\n",
                encoding="utf-8",
            )

            with patch.dict(os.environ, {}, clear=True):
                previous_cwd = Path.cwd()
                try:
                    os.chdir(root)
                    with self.assertRaises(ValueError):
                        WorkerConfig.from_env()
                finally:
                    os.chdir(previous_cwd)


if __name__ == "__main__":
    unittest.main()
