from __future__ import annotations

import io
import logging
import tempfile
import unittest
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

from llm247.__main__ import configure_logging, log_lifecycle_event
from llm247.token_usage import record_token_usage, reset_token_usage_tracker


class LoggingConfigTests(unittest.TestCase):
    """Validate lifecycle log handler configuration."""

    def test_configure_logging_uses_daily_rotation(self) -> None:
        """Agent logs should rotate daily with retention control."""
        with tempfile.TemporaryDirectory() as temp_dir:
            log_path = Path(temp_dir) / "agent.log"
            configure_logging(str(log_path), retention_days=10)

            handlers = logging.getLogger().handlers
            rotating_handlers = [handler for handler in handlers if isinstance(handler, TimedRotatingFileHandler)]

            self.assertEqual(1, len(rotating_handlers))
            self.assertEqual("MIDNIGHT", rotating_handlers[0].when)
            self.assertEqual(10, rotating_handlers[0].backupCount)
            self.assertIn("token_cost=", rotating_handlers[0].formatter._fmt)
            self.assertIn("token_total_tokens=", rotating_handlers[0].formatter._fmt)

    def test_lifecycle_log_keeps_utf8_goal_text(self) -> None:
        """Lifecycle JSON log should keep Chinese text instead of unicode escapes."""
        stream = io.StringIO()
        logger = logging.getLogger("llm247.lifecycle")
        previous_handlers = list(logger.handlers)
        previous_level = logger.level
        previous_propagate = logger.propagate
        logger.handlers = [logging.StreamHandler(stream)]
        logger.setLevel(logging.INFO)
        logger.propagate = False
        try:
            log_lifecycle_event(
                "planner_goal",
                goal="梳理工作区中所有TODO/FIXME/BUG注释，生成优先级排序的任务列表",
            )
        finally:
            logger.handlers = previous_handlers
            logger.setLevel(previous_level)
            logger.propagate = previous_propagate

        output = stream.getvalue()
        self.assertIn("梳理工作区", output)
        self.assertNotIn("\\u68b3", output)

    def test_logs_include_live_token_cost(self) -> None:
        """Every log line should include current accumulated token cost."""
        with tempfile.TemporaryDirectory() as temp_dir:
            log_path = Path(temp_dir) / "agent.log"
            configure_logging(str(log_path), retention_days=5)
            reset_token_usage_tracker()

            logger = logging.getLogger("llm247.test")
            logger.info("before usage")
            record_token_usage(input_tokens=10, output_tokens=20, total_tokens=30)
            logger.info("after usage")

            for handler in logging.getLogger().handlers:
                handler.flush()

            content = log_path.read_text(encoding="utf-8")
            self.assertIn("token_total_tokens=0", content)
            self.assertIn("token_total_tokens=30", content)


if __name__ == "__main__":
    unittest.main()
