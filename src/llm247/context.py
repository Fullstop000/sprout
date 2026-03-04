from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path
from typing import Iterable, List


# Run shell command safely and return human-readable output for prompts.
def run_command(command: List[str], workspace_path: Path, timeout_seconds: int = 10) -> str:
    """Run a command in workspace and return trimmed output or error text."""
    try:
        completed = subprocess.run(
            command,
            cwd=workspace_path,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
    except FileNotFoundError:
        return "<command-not-found>"
    except OSError as error:
        return f"<os-error: {error}>"
    except subprocess.TimeoutExpired:
        return "<timeout>"

    if completed.returncode != 0:
        stderr = completed.stderr.strip() or completed.stdout.strip() or "unknown error"
        return f"<non-zero-exit: {stderr}>"

    return completed.stdout.strip() or "<empty>"


def collect_git_status(workspace_path: Path) -> str:
    """Collect compact git status; tolerate non-git directories."""
    return run_command(["git", "status", "--short", "--branch"], workspace_path)


def collect_recent_commits(workspace_path: Path, limit: int = 6) -> str:
    """Collect recent commit titles for context-aware planning."""
    return run_command(
        ["git", "log", f"--max-count={limit}", "--pretty=format:%h %ad %s", "--date=short"],
        workspace_path,
    )


def collect_todo_items(workspace_path: Path, limit: int = 30) -> str:
    """Collect TODO-like lines from the workspace for prioritization tasks."""
    if shutil.which("rg"):
        todo_text = run_command(
            ["rg", "-n", "TODO|FIXME|BUG|HACK", "--glob", "!reports/**", "--glob", "!.git/**"],
            workspace_path,
        )
        if todo_text not in {"<empty>", "<command-not-found>"}:
            return "\n".join(todo_text.splitlines()[:limit])

    collected: List[str] = []
    matcher = re.compile(r"TODO|FIXME|BUG|HACK")
    for file_path in _iter_text_files(workspace_path):
        if "reports" in file_path.parts or ".git" in file_path.parts:
            continue
        try:
            for line_index, line_text in enumerate(file_path.read_text(encoding="utf-8", errors="ignore").splitlines(), start=1):
                if matcher.search(line_text):
                    collected.append(f"{file_path.relative_to(workspace_path)}:{line_index}:{line_text.strip()}")
                    if len(collected) >= limit:
                        return "\n".join(collected)
        except OSError:
            continue

    if not collected:
        return "<no-todo-items-found>"
    return "\n".join(collected)


def collect_recent_reports(report_dir: Path, limit_files: int = 4, max_chars: int = 6000) -> str:
    """Load snippets from latest reports to provide historical memory."""
    if not report_dir.exists():
        return "<no-reports-yet>"

    report_files = sorted(
        (path for path in report_dir.glob("*.md") if path.is_file()),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )[:limit_files]

    snippets: List[str] = []
    current_chars = 0
    for report_path in report_files:
        try:
            content = report_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue

        chunk = f"## {report_path.name}\n{content}\n"
        remaining = max_chars - current_chars
        if remaining <= 0:
            break

        snippets.append(chunk[:remaining])
        current_chars += min(len(chunk), remaining)

    if not snippets:
        return "<no-readable-reports>"
    return "\n".join(snippets)


def _iter_text_files(workspace_path: Path) -> Iterable[Path]:
    """Yield candidate text files for TODO fallback scanning."""
    for path in workspace_path.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".zip", ".bin", ".pdf"}:
            continue
        yield path
