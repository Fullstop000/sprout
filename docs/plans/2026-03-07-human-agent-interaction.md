# Plan: Human-Agent Interaction via GitHub Issues

> Status: Approved
> Created: 2026-03-07
> Completed:
> PR:
> Proposal: [docs/proposals/2026-03-07-human-agent-interaction.md](../proposals/2026-03-07-human-agent-interaction.md)

## Goal

Replace the one-shot `human_help_request` / `human_resolved` handoff with a bidirectional interaction model backed by GitHub Issues. The agent opens issues when blocked (Shape A) and picks up human-opened issues as tasks (Shape B). An internal SQLite mirror enables fast local reads and dashboard display without repeated GitHub API calls.

## Scope

- New module: `src/llm247_v2/github/` — GitHub API client + issue sync
- New storage: `src/llm247_v2/storage/thread_store.py` — threads + messages mirror
- Model change: `Task.github_issue_url` field
- Agent cycle: new `_phase_sync_github_issues` phase
- Agent execution: open/close/comment GitHub Issues on task state transitions
- Dashboard: thread display in task detail view
- Config: GitHub token + repo coordinates + label name

Out of scope for this plan: Shape C (ambient directives), real-time push, non-GitHub deployments.

---

## Component Breakdown

### 1. `src/llm247_v2/github/client.py`

Thin wrapper over the GitHub REST API (`/repos/{owner}/{repo}/issues`).

```python
class GitHubClient:
    def __init__(self, token: str, owner: str, repo: str, label: str = "sprout") -> None: ...

    def list_open_issues(self, since: str | None = None) -> list[dict]: ...
    # GET /issues?state=open&labels={label}&since={iso}

    def get_issue_comments(self, issue_number: int, since: str | None = None) -> list[dict]: ...
    # GET /issues/{number}/comments?since={iso}

    def create_issue(self, title: str, body: str) -> dict: ...
    # POST /issues

    def create_comment(self, issue_number: int, body: str) -> dict: ...
    # POST /issues/{number}/comments

    def close_issue(self, issue_number: int, comment: str | None = None) -> None: ...
    # optional POST comment, then PATCH /issues/{number} state=closed
```

Uses `httpx` (already a project dependency) with `Authorization: Bearer {token}`.

---

### 2. `src/llm247_v2/storage/thread_store.py`

SQLite mirror of GitHub Issue threads.

**Schema:**

```sql
CREATE TABLE threads (
    id              TEXT PRIMARY KEY,   -- internal UUID
    github_issue_number INTEGER NOT NULL,
    github_issue_url    TEXT NOT NULL,
    github_issue_title  TEXT NOT NULL,
    task_id             TEXT DEFAULT '',  -- linked task, empty if not yet created
    status              TEXT DEFAULT 'open',  -- open | closed
    last_synced_at      TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE TABLE messages (
    id                  TEXT PRIMARY KEY,
    thread_id           TEXT NOT NULL,
    role                TEXT NOT NULL,    -- human | agent
    body                TEXT NOT NULL,
    github_comment_id   INTEGER DEFAULT 0,  -- 0 = issue body itself
    created_at          TEXT NOT NULL,
    FOREIGN KEY(thread_id) REFERENCES threads(id)
);

CREATE INDEX idx_threads_task_id ON threads(task_id);
CREATE INDEX idx_threads_status  ON threads(status);
CREATE INDEX idx_messages_thread ON messages(thread_id);
```

**Key methods:**

```python
class ThreadStore:
    def upsert_thread(self, github_issue: dict) -> Thread: ...
    def upsert_message(self, thread_id: str, role: str, body: str,
                       github_comment_id: int = 0, created_at: str = "") -> Message: ...
    def link_task(self, thread_id: str, task_id: str) -> None: ...
    def get_open_unlinked_threads(self) -> list[Thread]: ...
    def get_threads_for_task(self, task_id: str) -> list[Thread]: ...
    def get_messages(self, thread_id: str) -> list[Message]: ...
    def get_new_human_messages(self, thread_id: str, since_message_id: str) -> list[Message]: ...
    def mark_closed(self, thread_id: str) -> None: ...
    def get_pending_agent_comments(self) -> list[PendingComment]: ...
    def queue_agent_comment(self, thread_id: str, body: str) -> None: ...
    def mark_comment_posted(self, pending_id: str, github_comment_id: int) -> None: ...
```

---

### 3. `src/llm247_v2/core/models.py`

Add one field to `Task`:

```python
@dataclass
class Task:
    ...
    github_issue_url: str = ""   # URL of linked GitHub Issue, if any
```

Add corresponding DB migration in `store.py`:

```sql
ALTER TABLE tasks ADD COLUMN github_issue_url TEXT DEFAULT ''
```

---

### 4. `src/llm247_v2/github/sync.py`

Orchestrates a single sync cycle: fetch from GitHub → mirror to ThreadStore → return action lists for the agent to act on.

```python
@dataclass
class SyncResult:
    new_unlinked_issues: list[Thread]      # → create Tasks (Shape B)
    unblocked_tasks: list[tuple[Task, list[Message]]]  # → re-queue as human_resolved (Shape A)
    issues_to_close: list[Thread]          # → already handled, close on GitHub

def sync_github_issues(
    github: GitHubClient,
    thread_store: ThreadStore,
    task_store: TaskStore,
    since: str | None,
) -> SyncResult: ...
```

Steps:
1. Fetch open issues from GitHub (with `since` cursor to limit API calls)
2. Upsert threads + messages into ThreadStore
3. For each open thread with `task_id` pointing to a `needs_human` task that has new human messages → add to `unblocked_tasks`
4. For each open thread with no `task_id` → add to `new_unlinked_issues`
5. Post any queued agent comments back to GitHub, mark them sent

---

### 5. Agent cycle — `src/llm247_v2/agent.py`

Add `_phase_sync_github_issues` as the first phase in `run_cycle`, before discovery:

```python
def run_cycle(self) -> dict:
    ...
    if self.github:
        sync_result = self._phase_sync_github_issues()
        summary["issues_synced"] = len(sync_result.new_unlinked_issues)
    ...
```

```python
def _phase_sync_github_issues(self) -> SyncResult:
    result = sync_github_issues(self.github, self.thread_store, self.store, self._last_github_sync)
    self._last_github_sync = _now_iso()

    # Shape B: human-opened issues → create Tasks
    for thread in result.new_unlinked_issues:
        task = Task(
            id=_new_id(), title=thread.github_issue_title,
            description=thread.messages[0].body if thread.messages else "",
            source="github_issue", status=TaskStatus.QUEUED.value, priority=3,
            github_issue_url=thread.github_issue_url,
        )
        self.store.insert_task(task)
        self.thread_store.link_task(thread.id, task.id)
        self.obs.task_queued(task.id, task.title, "github_issue")

    # Shape A: tasks unblocked by human reply → re-queue
    for task, new_messages in result.unblocked_tasks:
        task.status = TaskStatus.HUMAN_RESOLVED.value
        task.human_help_request = ""
        self.store.update_task(task)

    return result
```

---

### 6. Agent execution — `src/llm247_v2/agent.py`

**When task → `needs_human`** (in `_execute_single_task`):

```python
if not success and self.github:
    issue = self.github.create_issue(
        title=f"[sprout] Blocked: {task.title}",
        body=_format_blocked_issue_body(task),
    )
    task.github_issue_url = issue["html_url"]
    self.thread_store.upsert_thread(issue)
    self.thread_store.link_task(thread.id, task.id)
```

**When task → `completed` or `failed`** (end of `_execute_single_task`):

```python
if task.github_issue_url and self.github:
    outcome = "completed" if success else "failed"
    self.thread_store.queue_agent_comment(thread.id, _format_outcome_comment(task, outcome))
    # comment is posted to GitHub in next _phase_sync_github_issues
    self.github.close_issue(issue_number)
```

---

### 7. `src/llm247_v2/github/__init__.py`

```python
from llm247_v2.github.client import GitHubClient
from llm247_v2.github.sync import SyncResult, sync_github_issues
```

---

### 8. `AutonomousAgentV2` constructor

Add optional GitHub fields:

```python
def __init__(
    self,
    ...
    github_client: Optional[GitHubClient] = None,
    thread_store: Optional[ThreadStore] = None,
) -> None:
    ...
    self.github = github_client
    self.thread_store = thread_store
```

Bootstrap (`bootstrap.py`) reads `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_LABEL` from environment and constructs `GitHubClient` + `ThreadStore` if all are present. GitHub integration is entirely optional — the agent runs normally without it.

---

### 9. Dashboard — task detail thread view

In `src/llm247_v2/dashboard/server.py`, extend `_api_task_detail` to include thread messages:

```python
def _api_task_detail(store, task_id, thread_store=None):
    task = store.get_task(task_id)
    ...
    result["thread"] = []
    if thread_store:
        threads = thread_store.get_threads_for_task(task_id)
        for thread in threads:
            result["thread"] = [
                {"role": m.role, "body": m.body, "created_at": m.created_at}
                for m in thread_store.get_messages(thread.id)
            ]
    result["github_issue_url"] = task.github_issue_url
    return result
```

Frontend renders the thread as a simple read-only comment list with role badges and a link to the GitHub Issue.

---

## Migration Notes

- `Task.github_issue_url` added via `ALTER TABLE` migration in `store.py` — safe for existing databases
- `ThreadStore` is a new SQLite file (`threads.db`) alongside `tasks.db` — no migration needed
- GitHub integration is opt-in via environment variables — existing deployments are unaffected

---

## Test Plan

| Layer | Test |
|-------|------|
| `GitHubClient` | Mock `httpx` responses; assert correct API calls for list/create/comment/close |
| `ThreadStore` | Unit test upsert, link, queue/mark-sent logic |
| `sync_github_issues` | Mock client + stores; assert SyncResult fields for each scenario |
| Agent cycle | Mock `GitHubClient`; assert tasks created for new issues, tasks re-queued for human replies |
| Agent execution | Mock `GitHubClient`; assert issue opened on `needs_human`, closed on completion |
| Dashboard API | Assert `thread` field present in task detail response when `ThreadStore` populated |

---

## File Checklist

- [ ] `src/llm247_v2/github/__init__.py`
- [ ] `src/llm247_v2/github/client.py`
- [ ] `src/llm247_v2/github/sync.py`
- [ ] `src/llm247_v2/storage/thread_store.py`
- [ ] `src/llm247_v2/core/models.py` — add `github_issue_url`
- [ ] `src/llm247_v2/storage/store.py` — migration for `github_issue_url`
- [ ] `src/llm247_v2/agent.py` — `_phase_sync_github_issues`, open/close issue on state transitions
- [ ] `src/llm247_v2/bootstrap.py` — construct `GitHubClient` + `ThreadStore` from env
- [ ] `src/llm247_v2/dashboard/server.py` — thread in task detail response
- [ ] `tests/test_v2_github_client.py`
- [ ] `tests/test_v2_thread_store.py`
- [ ] `tests/test_v2_github_sync.py`
- [ ] `tests/test_v2_agent.py` — extend with GitHub interaction scenarios
