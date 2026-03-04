from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv as _load_dotenv
except ModuleNotFoundError:  # pragma: no cover - optional dependency
    _load_dotenv = None


# Load .env from current workspace without overriding exported variables.
def load_local_env() -> None:
    """Load environment from .env file with safe fallback parser."""
    env_path = Path.cwd() / ".env"
    if not env_path.exists():
        return

    if _load_dotenv is not None:
        _load_dotenv(dotenv_path=env_path, override=False)
        return

    try:
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("'").strip('"')
            if key and key not in os.environ:
                os.environ[key] = value
    except OSError:
        return


@dataclass(frozen=True)
class WorkerConfig:
    """Runtime configuration loaded from environment variables."""

    api_key: str
    base_url: str
    model: str
    run_mode: str
    poll_interval_seconds: int
    workspace_path: Path
    state_path: Path
    autonomous_state_path: Path
    report_dir: Path
    log_path: Path
    log_retention_days: int
    autonomous_max_actions: int
    command_timeout_seconds: int
    web_result_limit: int
    daemon_restart_delay_seconds: int
    daemon_max_restarts: int

    @staticmethod
    def from_env() -> "WorkerConfig":
        """Create validated config from process environment."""
        # Load local .env for long-running daemon setups.
        load_local_env()

        api_key = os.getenv("ARK_API_KEY", "").strip()
        if not api_key:
            raise ValueError("ARK_API_KEY is required")

        base_url = os.getenv("ARK_BASE_URL", "https://ark-cn-beijing.bytedance.net/api/v3").strip()
        model = os.getenv("ARK_MODEL", "").strip()
        if not model:
            raise ValueError("ARK_MODEL is required")
        run_mode = os.getenv("RUN_MODE", "autonomous").strip().lower()
        if run_mode not in {"autonomous", "legacy"}:
            raise ValueError("RUN_MODE must be one of: autonomous, legacy")

        poll_interval_seconds = int(os.getenv("POLL_INTERVAL_SECONDS", "60"))
        if poll_interval_seconds <= 0:
            raise ValueError("POLL_INTERVAL_SECONDS must be greater than 0")

        autonomous_max_actions = int(os.getenv("AUTONOMOUS_MAX_ACTIONS", "5"))
        if autonomous_max_actions <= 0:
            raise ValueError("AUTONOMOUS_MAX_ACTIONS must be greater than 0")

        command_timeout_seconds = int(os.getenv("COMMAND_TIMEOUT_SECONDS", "60"))
        if command_timeout_seconds <= 0:
            raise ValueError("COMMAND_TIMEOUT_SECONDS must be greater than 0")

        web_result_limit = int(os.getenv("WEB_RESULT_LIMIT", "5"))
        if web_result_limit <= 0:
            raise ValueError("WEB_RESULT_LIMIT must be greater than 0")

        log_retention_days = int(os.getenv("LOG_RETENTION_DAYS", "30"))
        if log_retention_days <= 0:
            raise ValueError("LOG_RETENTION_DAYS must be greater than 0")

        daemon_restart_delay_seconds = int(os.getenv("DAEMON_RESTART_DELAY_SECONDS", "5"))
        if daemon_restart_delay_seconds <= 0:
            raise ValueError("DAEMON_RESTART_DELAY_SECONDS must be greater than 0")

        daemon_max_restarts = int(os.getenv("DAEMON_MAX_RESTARTS", "0"))
        if daemon_max_restarts < 0:
            raise ValueError("DAEMON_MAX_RESTARTS must be greater than or equal to 0")

        workspace_path = Path(os.getenv("WORKSPACE_PATH", os.getcwd())).resolve()
        state_path = Path(os.getenv("STATE_PATH", workspace_path / ".llm247" / "state.json")).resolve()
        autonomous_state_path = Path(
            os.getenv("AUTONOMOUS_STATE_PATH", workspace_path / ".llm247" / "autonomous_state.json")
        ).resolve()
        report_dir = Path(os.getenv("REPORT_DIR", workspace_path / "reports" / "llm247")).resolve()
        log_path = Path(os.getenv("LOG_PATH", workspace_path / ".llm247" / "worker.log")).resolve()

        return WorkerConfig(
            api_key=api_key,
            base_url=base_url,
            model=model,
            run_mode=run_mode,
            poll_interval_seconds=poll_interval_seconds,
            workspace_path=workspace_path,
            state_path=state_path,
            autonomous_state_path=autonomous_state_path,
            report_dir=report_dir,
            log_path=log_path,
            log_retention_days=log_retention_days,
            autonomous_max_actions=autonomous_max_actions,
            command_timeout_seconds=command_timeout_seconds,
            web_result_limit=web_result_limit,
            daemon_restart_delay_seconds=daemon_restart_delay_seconds,
            daemon_max_restarts=daemon_max_restarts,
        )
