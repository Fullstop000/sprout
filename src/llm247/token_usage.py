from __future__ import annotations

import logging
import threading
from dataclasses import dataclass


@dataclass(frozen=True)
class TokenUsageSnapshot:
    """Immutable view of accumulated token usage statistics."""

    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    call_count: int = 0


class TokenUsageTracker:
    """Thread-safe accumulator for model token usage across runtime lifecycle."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._input_tokens = 0
        self._output_tokens = 0
        self._total_tokens = 0
        self._call_count = 0

    def record(self, input_tokens: int, output_tokens: int, total_tokens: int) -> None:
        """Accumulate one model call usage sample."""
        safe_input = max(0, int(input_tokens))
        safe_output = max(0, int(output_tokens))
        safe_total = max(0, int(total_tokens))

        if safe_total == 0:
            safe_total = safe_input + safe_output

        with self._lock:
            self._input_tokens += safe_input
            self._output_tokens += safe_output
            self._total_tokens += safe_total
            self._call_count += 1

    def snapshot(self) -> TokenUsageSnapshot:
        """Return current usage snapshot."""
        with self._lock:
            return TokenUsageSnapshot(
                input_tokens=self._input_tokens,
                output_tokens=self._output_tokens,
                total_tokens=self._total_tokens,
                call_count=self._call_count,
            )

    def reset(self) -> None:
        """Reset usage statistics, useful for tests or controlled restarts."""
        with self._lock:
            self._input_tokens = 0
            self._output_tokens = 0
            self._total_tokens = 0
            self._call_count = 0


class TokenUsageLogFilter(logging.Filter):
    """Inject live token cost fields into every emitted log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        snapshot = get_token_usage_snapshot()
        record.token_input_tokens = snapshot.input_tokens
        record.token_output_tokens = snapshot.output_tokens
        record.token_total_tokens = snapshot.total_tokens
        record.token_calls = snapshot.call_count
        # Use accumulated total tokens as canonical token cost metric.
        record.token_cost = snapshot.total_tokens
        return True


_TRACKER = TokenUsageTracker()


# Record one usage sample from model response usage block.
def record_token_usage(input_tokens: int, output_tokens: int, total_tokens: int) -> None:
    """Record usage values into global tracker."""
    _TRACKER.record(input_tokens=input_tokens, output_tokens=output_tokens, total_tokens=total_tokens)


# Return immutable snapshot for logging or external reporting.
def get_token_usage_snapshot() -> TokenUsageSnapshot:
    """Return global token usage snapshot."""
    return _TRACKER.snapshot()


# Reset global tracker in tests or explicit maintenance workflows.
def reset_token_usage_tracker() -> None:
    """Reset global token usage tracker."""
    _TRACKER.reset()
