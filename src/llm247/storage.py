from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional


class TaskStateStore:
    """Persist and load each task's last successful run timestamp."""

    def __init__(self, state_path: Path) -> None:
        self.state_path = state_path

    def get_last_run(self, task_name: str) -> Optional[datetime]:
        """Return the last run timestamp for a task or None if absent."""
        state = self._load_state()
        raw_value = state.get(task_name)
        if raw_value is None:
            return None

        try:
            return datetime.fromisoformat(raw_value)
        except ValueError:
            return None

    def mark_run(self, task_name: str, run_at: datetime) -> None:
        """Record the latest successful task timestamp and persist to disk."""
        state = self._load_state()
        state[task_name] = run_at.isoformat()
        self._write_state(state)

    def _load_state(self) -> Dict[str, str]:
        """Load on-disk state, recovering from corruption as empty state."""
        if not self.state_path.exists():
            return {}

        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                return {}
            return {str(key): str(value) for key, value in data.items()}
        except (OSError, json.JSONDecodeError):
            return {}

    def _write_state(self, state: Dict[str, str]) -> None:
        """Safely flush state to disk using atomic file replacement."""
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self.state_path.with_suffix(self.state_path.suffix + ".tmp")
        temp_path.write_text(
            json.dumps(state, ensure_ascii=True, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        temp_path.replace(self.state_path)
