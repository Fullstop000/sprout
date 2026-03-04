from __future__ import annotations

from llm247.runtime_codes import EXIT_BUDGET_EXHAUSTED, EXIT_INTERRUPTED


# Decide whether supervisor should restart child after it exits.
def should_restart_child(child_exit_code: int, restart_count: int, max_restarts: int) -> bool:
    """Return True when daemon should restart child process."""
    if child_exit_code in {0, EXIT_BUDGET_EXHAUSTED, EXIT_INTERRUPTED}:
        return False

    if max_restarts > 0 and restart_count >= max_restarts:
        return False

    return True
