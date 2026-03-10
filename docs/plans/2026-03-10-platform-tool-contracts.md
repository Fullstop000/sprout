# Platform Tool Contract Design

> Status: Approved
> Created: 2026-03-10
> Completed:
> PR:
> Proposal: docs/proposals/2026-03-10-persona-driven-soft-architecture.md

---

## Overview

Design and implement the platform tool layer: the atomic capabilities that kernel programs invoke. Tool contracts are the syscall interface of the kernel architecture — they must be right before anything is built on top.

This plan is extracted from Phase 1.0 of the [persona-driven architecture plan](2026-03-10-persona-driven-soft-architecture.md) because tool contract design is independently reviewable and is the highest-priority prerequisite for all other work.

---

## Design Principles

- Each tool does exactly one thing (atomic)
- Every tool has typed input, typed output, and typed errors
- Tool contracts are append-only: new tools can be added, existing contracts cannot change
- Tools are **pluggable**: each tool is a self-contained module that registers itself with the tool registry. Adding a new tool = writing one file + registering it. No changes to existing code.
- Tools belong to the constitution/platform boundary — the agent cannot modify tool implementations, but can request new tools through self-improvement proposals
- **LLM reasoning is NOT a tool** — the LLM executing the kernel program IS the reasoner. It does not need to "call itself" to analyze content. Tools are for capabilities the LLM cannot perform by itself: interacting with filesystems, running code, accessing networks, querying databases.

---

## Tool Taxonomy

Tools are organized into 8 categories following the capability taxonomy from `__loop_design.md`. Not all tools need to be implemented immediately — the pluggable architecture means tools can be added incrementally. But the complete catalog should be defined upfront so the taxonomy is coherent.

**Implementation priority**: `P0` = exists or trivial to add, `P1` = near-term, `P2` = later phases

```yaml
tools:

  # ═══════════════════════════════════════════════════
  # Category 1: FILESYSTEM
  # Read, write, search local files
  # ═══════════════════════════════════════════════════

  read_file:                                           # P0 (exists)
    description: Read contents of a file
    input:
      path: str
      max_lines: int                 # optional, default 500
      offset: int                    # optional, start from line N
    output: FileContent              # {path, content, line_count}
    errors: [not_found, permission_denied, too_large]

  write_file:                                          # P0 (exists)
    description: Write or overwrite a file
    input:
      path: str
      content: str
    output: WriteResult              # {path, bytes_written}
    errors: [permission_denied, path_protected]

  edit_file:                                           # P0 (exists)
    description: Replace exact string in a file
    input:
      path: str
      old_string: str
      new_string: str
    output: EditResult               # {path, replacements_made}
    errors: [not_found, no_match, multiple_matches]

  delete_file:                                         # P0 (exists)
    description: Delete a file
    input:
      path: str
    output: DeleteResult             # {path}
    errors: [not_found, permission_denied, path_protected]

  find_files:                                          # P0 (exists as list_directory)
    description: List files matching glob patterns
    input:
      globs: List[str]
      exclude_globs: List[str]       # optional
    output: List[FileInfo]           # {path, size_bytes, modified_at}
    errors: [invalid_glob, timeout]

  grep_files:                                          # P0 (exists as search_files)
    description: Search file contents by regex pattern
    input:
      patterns: List[str]
      file_globs: List[str]
      exclude_globs: List[str]       # optional
      max_results: int               # optional, default 100
    output: List[Match]              # {file_path, line_number, match_text, context}
    errors: [invalid_pattern, timeout]


  # ═══════════════════════════════════════════════════
  # Category 2: CODE EXECUTION
  # Run code, scripts, and experiments
  # Critical for Technical Reproduction and Build
  # ═══════════════════════════════════════════════════

  run_command:                                         # P0 (exists)
    description: Execute a shell command (SafetyPolicy enforced)
    input:
      command: str
      timeout_ms: int                # optional, default 30000
      cwd: str                       # optional, working directory
    output: CommandResult            # {stdout, stderr, exit_code}
    errors: [permission_denied, timeout, nonzero_exit]

  run_python:                                          # P0
    description: Execute Python code in an isolated environment
    input:
      code: str                      # Python source code to execute
      timeout_ms: int                # optional, default 60000
      requirements: List[str]        # optional, pip packages to install first
    output: CodeResult               # {stdout, stderr, exit_code, artifacts}
    errors: [syntax_error, runtime_error, timeout, dependency_error]
    notes: >
      Unlike run_command, this provides a sandboxed Python execution
      environment. Can install dependencies, produce artifacts (files,
      images, data), and return structured output. Essential for
      technical reproduction, data analysis, and experimentation.

  run_tests:                                           # P0 (can wrap run_command)
    description: Run test suite and return structured results
    input:
      test_path: str                 # file or directory
      framework: str                 # optional, "pytest" | "unittest", default auto-detect
    output: TestResult               # {passed, failed, errors, test_details}
    errors: [not_found, timeout, framework_error]

  run_benchmark:                                       # P2
    description: Run a benchmark and return metrics
    input:
      script: str                    # benchmark script path or inline code
      metrics: List[str]            # what to measure, e.g. ["latency", "throughput"]
      iterations: int                # optional, default 3
    output: BenchmarkResult          # {metrics: Dict[str, float], raw_results}
    errors: [script_error, timeout]


  # ═══════════════════════════════════════════════════
  # Category 3: VERSION CONTROL
  # Git operations for own repo and external repos
  # ═══════════════════════════════════════════════════

  git_status:                                          # P0
    description: Show working tree status
    input:
      path: str                      # optional, repo path
    output: GitStatus                # {branch, staged, unstaged, untracked}
    errors: [not_a_repo]

  git_diff:                                            # P0
    description: Show changes in working tree or between commits
    input:
      target: str                    # optional, e.g. "HEAD~3..HEAD"
      path: str                      # optional, repo path
    output: DiffResult               # {files_changed, insertions, deletions, diff_text}
    errors: [invalid_ref]

  git_blame:                                           # P0
    description: Show line-by-line authorship and recency
    input:
      path: str
      lines: str                     # optional, e.g. "10,20"
    output: List[BlameLine]          # {line_number, author, date, commit_sha}
    errors: [not_found, not_tracked]

  git_log:                                             # P0
    description: Show commit history
    input:
      path: str                      # optional, file or repo path
      max_count: int                 # optional, default 20
      since: str                     # optional, e.g. "7 days ago"
    output: List[CommitInfo]         # {sha, author, date, message, files_changed}
    errors: [invalid_ref]

  git_create_worktree:                                 # P0 (exists)
    description: Create an isolated branch and worktree for changes
    input:
      branch_name: str
    output: WorktreeResult           # {path, branch}
    errors: [branch_exists, worktree_error]

  git_commit:                                          # P0 (exists)
    description: Stage all changes and commit
    input:
      message: str
    output: CommitResult             # {sha, files_committed}
    errors: [nothing_to_commit, commit_error]

  git_push:                                            # P0 (exists)
    description: Push current branch to remote
    output: PushResult               # {branch, remote}
    errors: [push_rejected, auth_error]

  git_create_pr:                                       # P0 (exists)
    description: Create a pull request
    input:
      title: str
      body: str
    output: PRResult                 # {url, number}
    errors: [pr_exists, auth_error]

  git_clone:                                           # P1
    description: Clone an external repository for study or reproduction
    input:
      url: str
      target_dir: str                # optional
      depth: int                     # optional, shallow clone depth
    output: CloneResult              # {path, branch, commit_sha}
    errors: [clone_error, auth_error, disk_full]
    notes: >
      Essential for Technical Reproduction: clone a trending repo,
      read its code, run its experiments, adapt its techniques.
      Cloned repos live in a sandboxed workspace, not the main repo.


  # ═══════════════════════════════════════════════════
  # Category 4: NETWORK / INTERNET
  # Web search, fetch, browse, API access
  # The agent's window to the external world
  # ═══════════════════════════════════════════════════

  web_search:                                          # P1
    description: Search the web via a search engine API
    input:
      query: str
      max_results: int               # optional, default 10
      search_type: str               # optional, "general" | "news" | "academic"
    output: List[SearchResult]       # {title, url, snippet}
    errors: [network_error, rate_limited]

  web_fetch:                                           # P1
    description: Fetch and extract content from a URL
    input:
      url: str
      extract: str                   # optional, "text" | "html" | "raw", default "text"
      max_length: int                # optional, truncate after N chars
    output: WebContent               # {url, content, content_type, title}
    errors: [network_error, timeout, blocked]

  web_browse:                                          # P2
    description: Interactive browser session — navigate, click, extract
    input:
      url: str
      actions: List[BrowseAction]    # [{type: "click"|"scroll"|"extract", selector: ...}]
    output: BrowseResult             # {content, screenshots, extracted_data}
    errors: [navigation_error, timeout]
    notes: >
      For sites that require JS rendering or interaction.
      Heavier than web_fetch — use only when needed.

  api_call:                                            # P1
    description: Call a structured API endpoint
    input:
      url: str
      method: str                    # default GET
      headers: Dict[str, str]        # optional
      query: Dict[str, str]          # optional
      body: Dict                     # optional
      auth_ref: str                  # optional, references credential store key
    output: APIResponse              # {status_code, data, headers}
    errors: [network_error, auth_error, rate_limited, timeout]

  rss_fetch:                                           # P1
    description: Fetch and parse RSS/Atom feed
    input:
      url: str
      max_items: int                 # optional, default 20
      since: str                     # optional, only items after this date
    output: List[FeedItem]           # {title, url, summary, published_at, author}
    errors: [network_error, parse_error]


  # ═══════════════════════════════════════════════════
  # Category 5: STORAGE / KNOWLEDGE
  # Agent's persistent memory and knowledge management
  # ═══════════════════════════════════════════════════

  db_query:                                            # P0
    description: Query the agent's SQLite databases (read-only)
    input:
      database: str                  # "tasks" | "experience" | "models"
      query: str                     # SQL SELECT only
    output: QueryResult              # {rows, columns, row_count}
    errors: [invalid_query, permission_denied]

  db_write:                                            # P0
    description: Insert or update records in agent databases
    input:
      database: str
      query: str                     # SQL INSERT/UPDATE only
    output: WriteResult              # {rows_affected}
    errors: [invalid_query, permission_denied, constraint_violation]

  vector_store:                                        # P1 (depends on embedding infra)
    description: Store content with embedding in a vector collection
    input:
      collection: str                # "experience" | "knowledge" | "signals"
      content: str
      metadata: Dict[str, Any]       # optional
    output: StoreResult              # {id, collection}
    errors: [collection_not_found, embedding_error]

  vector_search:                                       # P1 (depends on embedding infra)
    description: Semantic search against a vector collection
    input:
      query: str
      collection: str
      top_k: int                     # optional, default 5
      filter: Dict[str, Any]         # optional, metadata filter
    output: List[VectorResult]       # {id, content, similarity_score, metadata}
    errors: [collection_not_found, embedding_error]

  knowledge_graph_query:                               # P2
    description: Query relationships in the agent's knowledge graph
    input:
      query: str                     # graph query (e.g. "related_to(X, concurrency)")
      depth: int                     # optional, traversal depth
    output: GraphResult              # {nodes, edges, paths}
    errors: [invalid_query]


  # ═══════════════════════════════════════════════════
  # Category 6: DATA PROCESSING
  # Parse, transform, analyze structured data
  # ═══════════════════════════════════════════════════

  parse_document:                                      # P1
    description: Parse structured documents (PDF, CSV, JSON, YAML, HTML)
    input:
      path_or_content: str           # file path or raw content
      format: str                    # "pdf" | "csv" | "json" | "yaml" | "html" | "auto"
      extract: str                   # optional, what to extract ("tables", "text", "structured")
    output: ParsedDocument           # {content, tables, metadata, format}
    errors: [parse_error, unsupported_format, too_large]

  data_query:                                          # P2
    description: Run SQL-like queries on tabular data (CSV, JSON arrays)
    input:
      data_source: str               # file path or inline JSON
      query: str                     # SQL-like query
    output: DataResult               # {rows, columns, row_count}
    errors: [parse_error, invalid_query]

  generate_chart:                                      # P2
    description: Generate a chart/visualization from data
    input:
      data: List[Dict]              # data points
      chart_type: str                # "bar" | "line" | "scatter" | "pie"
      config: Dict                   # labels, title, etc.
    output: ChartResult              # {image_path, svg}
    errors: [invalid_data, render_error]


  # ═══════════════════════════════════════════════════
  # Category 7: COMMUNICATION
  # Publish results, interact with external platforms
  # ═══════════════════════════════════════════════════

  github_issue_create:                                 # P1
    description: Create a GitHub issue
    input:
      repo: str                      # "owner/repo"
      title: str
      body: str
      labels: List[str]              # optional
    output: IssueResult              # {url, number}
    errors: [auth_error, repo_not_found]

  github_issue_comment:                                # P1
    description: Comment on a GitHub issue or PR
    input:
      repo: str
      issue_number: int
      body: str
    output: CommentResult            # {id, url}
    errors: [auth_error, not_found]

  publish_report:                                      # P2
    description: Publish a structured report to the agent's report directory
    input:
      title: str
      content: str
      report_type: str               # "daily" | "weekly" | "insight" | "analysis"
    output: ReportResult             # {path, url_if_dashboard}
    errors: [write_error]

  send_notification:                                   # P2
    description: Send a notification via configured channel (webhook, email, etc.)
    input:
      channel: str                   # references notification config
      message: str
      urgency: str                   # "low" | "medium" | "high"
    output: NotificationResult       # {delivered, channel}
    errors: [channel_not_configured, delivery_error]


  # ═══════════════════════════════════════════════════
  # Category 8: AI / EMBEDDING
  # Specialized AI capabilities beyond the executing LLM
  # Note: The LLM executing the kernel program IS the reasoner.
  # These tools are for SPECIALIZED capabilities the executing
  # LLM cannot do inline (embeddings, different models, reranking).
  # ═══════════════════════════════════════════════════

  embed_text:                                          # P1
    description: Generate embedding vector for text
    input:
      text: str
      model: str                     # optional, defaults to configured embedding model
    output: EmbeddingResult          # {vector, model_used, dimensions}
    errors: [embedding_error, model_not_found]

  rerank:                                              # P2
    description: Rerank a list of items by relevance to a query
    input:
      query: str
      items: List[str]
      top_k: int                     # optional
    output: List[RankedItem]         # {index, score, content}
    errors: [rerank_error]

  call_model:                                          # P2
    description: Call a different LLM model for a specific sub-task
    input:
      model: str                     # model binding point name
      prompt: str
      max_tokens: int                # optional
    output: ModelResult              # {response, model_used, token_cost}
    errors: [model_not_found, llm_error, token_budget_exceeded]
    notes: >
      For cases where the kernel program needs a DIFFERENT model —
      e.g., a cheaper model for bulk classification, or a specialized
      model for code generation. The executing LLM handles its own
      reasoning directly; this tool is for delegation to other models.
```

---

## Why LLM Reasoning is NOT a Tool

The previous design included `llm_analyze` as a platform tool. This was wrong. The LLM executing the kernel program in the ReAct loop **is** the analyzer. When a kernel program body says "assess the complexity of concurrent patterns," the LLM does this as part of its reasoning — it reads the code (via `read_file` tool), then thinks about what it sees. It does not need to "call itself" to think.

Tools exist for capabilities the LLM **cannot perform inline**:
- It cannot read files → `read_file`
- It cannot run code → `run_python`
- It cannot access the internet → `web_fetch`
- It cannot generate embeddings → `embed_text`
- It cannot query databases → `db_query`

But it CAN: analyze, summarize, classify, compare, reason, judge, plan, evaluate — all as part of its natural reasoning within the ReAct loop. Making these into tools would add overhead (extra tool call round-trip) with no capability gain.

The exception is `call_model` — this calls a **different** model, not the executing LLM. Useful for delegating bulk work to a cheaper model or specialized tasks to a fine-tuned model.

---

## Pluggable Tool Architecture

Tools are **pluggable modules**. The tool registry is a directory where each tool is a self-contained Python file:

```
src/llm247_v2/platform/tools/
├── __init__.py              # ToolRegistry class: discovers and loads tools
├── _base.py                 # BaseTool abstract class + type definitions
├── filesystem.py            # read_file, write_file, edit_file, delete_file, find_files, grep_files
├── code_execution.py        # run_command, run_python, run_tests
├── git.py                   # git_status, git_diff, git_blame, git_log, git_create_worktree, ...
├── network.py               # web_search, web_fetch, api_call, rss_fetch
├── storage.py               # db_query, db_write, vector_store, vector_search
├── data.py                  # parse_document, data_query, generate_chart
├── communication.py         # github_issue_create, github_issue_comment, publish_report
└── ai.py                    # embed_text, rerank, call_model
```

**Adding a new tool**:
1. Write a function in the appropriate category file (or create a new category file)
2. Decorate with `@tool(name="...", description="...", input_schema=..., output_type=...)`
3. The `ToolRegistry` auto-discovers all decorated functions on startup
4. The new tool is immediately available in kernel program envelopes

```python
# Example: adding a new tool
@tool(
    name="run_docker",
    description="Run a command inside a Docker container",
    input_schema={
        "image": {"type": "str", "required": True},
        "command": {"type": "str", "required": True},
        "timeout_ms": {"type": "int", "default": 120000},
    },
    output_type=CommandResult,
    errors=["image_not_found", "timeout", "runtime_error"],
    safety_check=True,  # must pass SafetyPolicy
)
def run_docker(image: str, command: str, timeout_ms: int = 120000) -> CommandResult:
    ...
```

No changes to `ToolRegistry`, `KernelExecutor`, or any existing tool. The decorator handles registration.

**Error model**: every tool returns either `{success: true, result: <typed output>}` or `{success: false, error: {type: <error_type>, message: str}}`. Kernel program bodies handle errors in natural language ("if the file is not found, skip it and continue to the next one") — the LLM in the ReAct loop interprets this and acts accordingly.

---

## Implementation

- New directory: `src/llm247_v2/platform/tools/` with pluggable tool module structure
- `BaseTool` abstract class with `@tool` decorator for auto-registration
- `ToolRegistry` class: discovers tools on startup, provides schema export for LLM function-calling format
- P0: migrate existing 13 tools from `execution/tools/` into the new pluggable structure
- P1: add network, vector, communication, data parsing tools
- P2: add browser, benchmark, docker, chart, rerank, call_model tools
- Tool contracts are part of the Constitution layer — implementations can change, contracts cannot

---

## Deliverables

- [ ] Tool taxonomy reviewed and contract schemas locked
- [ ] `_base.py`: `BaseTool` abstract class, `@tool` decorator, typed result/error model
- [ ] `__init__.py`: `ToolRegistry` with auto-discovery and LLM function-calling schema export
- [ ] P0 tool modules: `filesystem.py`, `code_execution.py`, `git.py`, `storage.py` (migrate existing 13 tools)
- [ ] Type definitions for all output types (`FileContent`, `CommandResult`, `GitStatus`, etc.)
- [ ] Tests: tool type validation (every tool input/output matches declared schema), decorator registration, schema export format

---

## Testing Strategy

### Unit Tests
- Every `@tool`-decorated function has matching input/output types
- `ToolRegistry` discovers all decorated tools on startup
- Schema export produces valid LLM function-calling format
- Error model: every tool error is typed and matches declared error list
- Safety check: tools with `safety_check=True` call `SafetyPolicy.check()` before execution

### Integration Tests
- Migrate one existing tool (e.g., `read_file`) end-to-end: old interface → new pluggable module → same behavior
- Adding a new tool file → `ToolRegistry` picks it up without code changes
- `KernelExecutor` can filter tool set to a subset declared in an envelope
