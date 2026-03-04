from __future__ import annotations

import unittest

from llm247.ark_client import is_budget_exhausted_error


class BudgetErrorDetectionTests(unittest.TestCase):
    """Verify budget-exhausted error detection heuristics."""

    def test_detects_quota_exhausted_message(self) -> None:
        """Known quota exhausted message should be treated as terminal budget stop."""
        error = RuntimeError("insufficient_quota: exceeded your current quota")
        self.assertTrue(is_budget_exhausted_error(error))

    def test_ignores_non_budget_error_message(self) -> None:
        """Regular transient errors should not be treated as budget exhaustion."""
        error = RuntimeError("temporary network timeout")
        self.assertFalse(is_budget_exhausted_error(error))


if __name__ == "__main__":
    unittest.main()
