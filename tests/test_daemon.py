from __future__ import annotations

import unittest

from llm247.daemon import should_restart_child
from llm247.runtime_codes import EXIT_BUDGET_EXHAUSTED, EXIT_INTERRUPTED


class DaemonPolicyTests(unittest.TestCase):
    """Validate daemon restart policy for child process exits."""

    def test_stops_on_budget_exhausted_exit_code(self) -> None:
        """Daemon should stop supervising when budget is exhausted."""
        self.assertFalse(
            should_restart_child(
                child_exit_code=EXIT_BUDGET_EXHAUSTED,
                restart_count=0,
                max_restarts=0,
            )
        )

    def test_stops_on_interrupted_exit_code(self) -> None:
        """Daemon should stop on user interruption exit code."""
        self.assertFalse(
            should_restart_child(
                child_exit_code=EXIT_INTERRUPTED,
                restart_count=0,
                max_restarts=0,
            )
        )

    def test_restarts_on_crash_exit_code(self) -> None:
        """Daemon should restart on unexpected non-zero exits."""
        self.assertTrue(
            should_restart_child(
                child_exit_code=1,
                restart_count=0,
                max_restarts=0,
            )
        )

    def test_stops_when_max_restarts_reached(self) -> None:
        """Daemon should stop restarting after reaching configured cap."""
        self.assertFalse(
            should_restart_child(
                child_exit_code=2,
                restart_count=3,
                max_restarts=3,
            )
        )


if __name__ == "__main__":
    unittest.main()
