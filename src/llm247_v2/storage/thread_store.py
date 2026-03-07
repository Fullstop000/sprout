from __future__ import annotations

import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

_SCHEMA = """
CREATE TABLE IF NOT EXISTS threads (
    id                    TEXT PRIMARY KEY,
    github_issue_number   INTEGER NOT NULL,
    github_issue_url      TEXT NOT NULL,
    github_issue_title    TEXT NOT NULL,
    status                TEXT DEFAULT 'pending',
    created_by            TEXT NOT NULL,
    last_synced_at        TEXT NOT NULL,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id                  TEXT PRIMARY KEY,
    thread_id           TEXT NOT NULL,
    role                TEXT NOT NULL,
    body                TEXT NOT NULL,
    github_comment_id   INTEGER DEFAULT 0,
    created_at          TEXT NOT NULL,
    FOREIGN KEY(thread_id) REFERENCES threads(id)
);

CREATE TABLE IF NOT EXISTS thread_tasks (
    thread_id   TEXT NOT NULL,
    task_id     TEXT NOT NULL,
    role        TEXT DEFAULT 'primary',
    PRIMARY KEY (thread_id, task_id),
    FOREIGN KEY(thread_id) REFERENCES threads(id)
);

CREATE TABLE IF NOT EXISTS pending_comments (
    id          TEXT PRIMARY KEY,
    thread_id   TEXT NOT NULL,
    body        TEXT NOT NULL,
    posted      INTEGER DEFAULT 0,
    github_comment_id INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL,
    FOREIGN KEY(thread_id) REFERENCES threads(id)
);

CREATE INDEX IF NOT EXISTS idx_threads_status   ON threads(status);
CREATE INDEX IF NOT EXISTS idx_threads_number   ON threads(github_issue_number);
CREATE INDEX IF NOT EXISTS idx_messages_thread  ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_tt_thread        ON thread_tasks(thread_id);
CREATE INDEX IF NOT EXISTS idx_tt_task          ON thread_tasks(task_id);
CREATE INDEX IF NOT EXISTS idx_pc_posted        ON pending_comments(posted);
"""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex[:16]


@dataclass
class Thread:
    id: str
    github_issue_number: int
    github_issue_url: str
    github_issue_title: str
    status: str
    created_by: str
    last_synced_at: str
    created_at: str
    updated_at: str


@dataclass
class Message:
    id: str
    thread_id: str
    role: str
    body: str
    github_comment_id: int
    created_at: str


@dataclass
class PendingComment:
    id: str
    thread_id: str
    body: str
    github_comment_id: int


def _row_to_thread(row: sqlite3.Row) -> Thread:
    d = dict(row)
    return Thread(
        id=d["id"],
        github_issue_number=d["github_issue_number"],
        github_issue_url=d["github_issue_url"],
        github_issue_title=d["github_issue_title"],
        status=d["status"],
        created_by=d["created_by"],
        last_synced_at=d["last_synced_at"],
        created_at=d["created_at"],
        updated_at=d["updated_at"],
    )


def _row_to_message(row: sqlite3.Row) -> Message:
    d = dict(row)
    return Message(
        id=d["id"],
        thread_id=d["thread_id"],
        role=d["role"],
        body=d["body"],
        github_comment_id=d["github_comment_id"],
        created_at=d["created_at"],
    )


class ThreadStore:
    """SQLite mirror of GitHub Issue threads and messages."""

    def __init__(self, db_path: Path) -> None:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    # ── Sync ──────────────────────────────────────────────────────────────────

    def upsert_thread(self, github_issue: dict, created_by: str = "human") -> Thread:
        """Mirror one GitHub Issue into the thread table."""
        number = github_issue["number"]
        now = _now_iso()
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM threads WHERE github_issue_number=?", (number,)
            ).fetchone()
            if row:
                self._conn.execute(
                    """UPDATE threads SET github_issue_title=?, status=CASE
                           WHEN status IN ('closed_completed','closed_cancelled','closed_abandoned')
                           THEN status ELSE status END,
                           last_synced_at=?, updated_at=?
                       WHERE github_issue_number=?""",
                    (github_issue["title"], now, now, number),
                )
                self._conn.commit()
                row = self._conn.execute(
                    "SELECT * FROM threads WHERE github_issue_number=?", (number,)
                ).fetchone()
                return _row_to_thread(row)

            thread_id = _new_id()
            self._conn.execute(
                """INSERT INTO threads
                   (id, github_issue_number, github_issue_url, github_issue_title,
                    status, created_by, last_synced_at, created_at, updated_at)
                   VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)""",
                (thread_id, number, github_issue["html_url"],
                 github_issue["title"], created_by, now, now, now),
            )
            # Mirror issue body as first message
            self._conn.execute(
                """INSERT INTO messages (id, thread_id, role, body, github_comment_id, created_at)
                   VALUES (?, ?, 'human', ?, 0, ?)""",
                (_new_id(), thread_id, github_issue.get("body") or "", now),
            )
            self._conn.commit()
            row = self._conn.execute(
                "SELECT * FROM threads WHERE id=?", (thread_id,)
            ).fetchone()
            return _row_to_thread(row)

    def upsert_message(
        self,
        thread_id: str,
        role: str,
        body: str,
        github_comment_id: int,
        created_at: str = "",
    ) -> Message:
        """Mirror one GitHub comment into the messages table (idempotent by comment id)."""
        with self._lock:
            if github_comment_id:
                row = self._conn.execute(
                    "SELECT * FROM messages WHERE github_comment_id=? AND thread_id=?",
                    (github_comment_id, thread_id),
                ).fetchone()
                if row:
                    return _row_to_message(row)
            msg_id = _new_id()
            ts = created_at or _now_iso()
            self._conn.execute(
                """INSERT INTO messages (id, thread_id, role, body, github_comment_id, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (msg_id, thread_id, role, body, github_comment_id, ts),
            )
            self._conn.commit()
            row = self._conn.execute(
                "SELECT * FROM messages WHERE id=?", (msg_id,)
            ).fetchone()
            return _row_to_message(row)

    # ── Task linkage ──────────────────────────────────────────────────────────

    def link_task(self, thread_id: str, task_id: str, role: str = "primary") -> None:
        with self._lock:
            self._conn.execute(
                "INSERT OR IGNORE INTO thread_tasks (thread_id, task_id, role) VALUES (?, ?, ?)",
                (thread_id, task_id, role),
            )
            self._conn.commit()

    def get_tasks_for_thread(self, thread_id: str) -> list[str]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT task_id FROM thread_tasks WHERE thread_id=?", (thread_id,)
            ).fetchall()
        return [r["task_id"] for r in rows]

    def get_thread_for_task(self, task_id: str) -> Optional[Thread]:
        with self._lock:
            row = self._conn.execute(
                """SELECT t.* FROM threads t
                   JOIN thread_tasks tt ON tt.thread_id = t.id
                   WHERE tt.task_id=?
                   ORDER BY t.created_at DESC LIMIT 1""",
                (task_id,),
            ).fetchone()
        return _row_to_thread(row) if row else None

    def get_thread_by_issue_number(self, number: int) -> Optional[Thread]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM threads WHERE github_issue_number=?", (number,)
            ).fetchone()
        return _row_to_thread(row) if row else None

    # ── Status queries ────────────────────────────────────────────────────────

    def get_pending_threads(self) -> list[Thread]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM threads WHERE status='pending'"
            ).fetchall()
        return [_row_to_thread(r) for r in rows]

    def get_threads_awaiting_human(self) -> list[Thread]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM threads WHERE status='awaiting_human'"
            ).fetchall()
        return [_row_to_thread(r) for r in rows]

    def get_new_human_messages(self, thread_id: str, since_created_at: str) -> list[Message]:
        """Return human messages posted after since_created_at."""
        with self._lock:
            rows = self._conn.execute(
                """SELECT * FROM messages
                   WHERE thread_id=? AND role='human' AND created_at > ?
                   ORDER BY created_at ASC""",
                (thread_id, since_created_at),
            ).fetchall()
        return [_row_to_message(r) for r in rows]

    def get_messages(self, thread_id: str) -> list[Message]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM messages WHERE thread_id=? ORDER BY created_at ASC",
                (thread_id,),
            ).fetchall()
        return [_row_to_message(r) for r in rows]

    def count_agent_messages(self, thread_id: str) -> int:
        with self._lock:
            row = self._conn.execute(
                "SELECT COUNT(*) FROM messages WHERE thread_id=? AND role='agent'",
                (thread_id,),
            ).fetchone()
        return row[0] if row else 0

    # ── Status updates ────────────────────────────────────────────────────────

    def set_status(self, thread_id: str, status: str) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE threads SET status=?, updated_at=? WHERE id=?",
                (status, _now_iso(), thread_id),
            )
            self._conn.commit()

    def mark_last_synced(self, thread_id: str) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE threads SET last_synced_at=?, updated_at=? WHERE id=?",
                (_now_iso(), _now_iso(), thread_id),
            )
            self._conn.commit()

    # ── Comment outbox ────────────────────────────────────────────────────────

    def queue_agent_comment(self, thread_id: str, body: str) -> str:
        """Queue a comment to be posted to GitHub on the next sync."""
        comment_id = _new_id()
        with self._lock:
            self._conn.execute(
                """INSERT INTO pending_comments (id, thread_id, body, posted, created_at)
                   VALUES (?, ?, ?, 0, ?)""",
                (comment_id, thread_id, body, _now_iso()),
            )
            self._conn.commit()
        return comment_id

    def get_pending_comments(self) -> list[PendingComment]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM pending_comments WHERE posted=0 ORDER BY created_at ASC"
            ).fetchall()
        return [PendingComment(id=r["id"], thread_id=r["thread_id"],
                               body=r["body"], github_comment_id=r["github_comment_id"])
                for r in rows]

    def mark_comment_posted(self, comment_id: str, github_comment_id: int) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE pending_comments SET posted=1, github_comment_id=? WHERE id=?",
                (github_comment_id, comment_id),
            )
            self._conn.commit()

    def close(self) -> None:
        self._conn.close()
