# Persona-Driven Kernel Architecture — Implementation Plan

> Status: Approved
> Created: 2026-03-10
> Completed:
> PR:
> Proposal: docs/proposals/2026-03-10-persona-driven-soft-architecture.md

---

## Overview

Transform Sprout from an agent with hardcoded behavioral modules into one with a four-layer architecture: **Constitution / Persona / Kernel / Platform**. The agent writes its own behavioral programs (kernel programs) in structured natural language, executed by the platform's LLM runtime against a set of atomic tools.

The work is divided into four phases, each independently shippable and valuable.

---

## Phase 1: Platform Tools + Kernel Runtime + Persona Foundation

**Goal**: Design the tool contracts, build the kernel executor, establish the persona data model, and migrate one hardcoded module (discovery) to kernel programs as proof of concept.

**Critical priority**: The first deliverable is the **tool contract design** — not kernel programs, not persona files. Tool contracts are the syscall interface of this architecture. They must be right before anything is built on top. Get the tools wrong and every kernel program needs rewriting.

### 1.0 Tool Contract Design (highest priority)

Design the platform's tool set: the atomic capabilities that kernel programs can invoke.

**Design principles**:
- Each tool does exactly one thing (atomic)
- Every tool has typed input, typed output, and typed errors
- Tool contracts are append-only: new tools can be added, existing contracts cannot change
- Tools are **pluggable**: each tool is a self-contained module that registers itself with the tool registry. Adding a new tool = writing one file + registering it. No changes to existing code.
- Tools belong to the constitution/platform boundary — the agent cannot modify tool implementations, but can request new tools through self-improvement proposals
- **LLM reasoning is NOT a tool** — the LLM executing the kernel program IS the reasoner. It does not need to "call itself" to analyze content. Tools are for capabilities the LLM cannot perform by itself: interacting with filesystems, running code, accessing networks, querying databases.

#### Tool Taxonomy

Tools are organized into 8 categories following the capability taxonomy from `__loop_design.md`. Not all tools need to be implemented in Phase 1 — the pluggable architecture means tools can be added incrementally. But the complete catalog should be defined upfront so the taxonomy is coherent.

**Implementation priority**: `P0` = Phase 1 (already exists or trivial to add), `P1` = Phase 2, `P2` = Phase 3+

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

#### Why LLM reasoning is NOT a tool

The previous design included `llm_analyze` as a platform tool. This was wrong. The LLM executing the kernel program in the ReAct loop **is** the analyzer. When a kernel program body says "assess the complexity of concurrent patterns," the LLM does this as part of its reasoning — it reads the code (via `read_file` tool), then thinks about what it sees. It does not need to "call itself" to think.

Tools exist for capabilities the LLM **cannot perform inline**:
- It cannot read files → `read_file`
- It cannot run code → `run_python`
- It cannot access the internet → `web_fetch`
- It cannot generate embeddings → `embed_text`
- It cannot query databases → `db_query`

But it CAN: analyze, summarize, classify, compare, reason, judge, plan, evaluate — all as part of its natural reasoning within the ReAct loop. Making these into tools would add overhead (extra tool call round-trip) with no capability gain.

The exception is `call_model` — this calls a **different** model, not the executing LLM. Useful for delegating bulk work to a cheaper model or specialized tasks to a fine-tuned model.

#### Pluggable Tool Architecture

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

#### Implementation

- New directory: `src/llm247_v2/platform/tools/` with pluggable tool module structure
- `BaseTool` abstract class with `@tool` decorator for auto-registration
- `ToolRegistry` class: discovers tools on startup, provides schema export for LLM function-calling format
- Phase 1 (P0): migrate existing 13 tools from `execution/tools/` into the new pluggable structure
- Phase 2 (P1): add network, vector, communication, data parsing tools
- Phase 3 (P2): add browser, benchmark, docker, chart, rerank, call_model tools
- Tool contracts are part of the Constitution layer — implementations can change, contracts cannot
- **Review gate**: tool taxonomy and contract design must be reviewed before proceeding to 1.1

### 1.1 Kernel Executor

The runtime that executes kernel programs. **This is a ReAct loop** — the same pattern already implemented in `execution/loop.py` for task execution.

#### The ReAct Pattern (already implemented)

Sprout's current task executor (`execution/loop.py`) already runs a ReAct (Reasoning + Acting) loop:

```python
# Existing ReActLoop in execution/loop.py (simplified)
class ReActLoop:
    def run(self, task, ...):
        messages = [system_prompt, user_prompt]
        for step in range(max_steps):
            text, tool_calls, usage = llm.generate_with_tools(messages, tool_schemas)

            if not tool_calls:
                nudge_and_continue()

            for call in tool_calls:
                constitution.check(call)           # safety gate
                result = tool_registry.execute(call)  # run the tool
                observer.emit(step_event)           # audit

                if result contains FINISH_SIGNAL:
                    return success

            messages.append(assistant_turn + tool_results)  # feed back
```

This is a general-purpose pattern: LLM reasons → calls tools → observes results → reasons again → ... until done. The only things that vary between uses are:
1. **System prompt** — what role and constraints the LLM operates under
2. **Tool set** — which tools are available
3. **Termination condition** — how "done" is determined

#### KernelExecutor: ReActLoop parameterized by kernel programs

The KernelExecutor does not reinvent the ReAct loop — it **reuses** it with different parameters:

| Parameter | Current task execution | Kernel program execution |
|-----------|----------------------|--------------------------|
| System prompt | `react_execute.txt` (fixed template) | Kernel envelope + persona context (per-program) |
| Tool set | 13 fixed tools (filesystem, git, shell, control) | Subset declared in `envelope.available_tools` |
| User prompt | Task description + plan | Kernel program `body` (natural language) |
| Termination | `finish()` tool call | LLM produces output matching `envelope.output_type` |
| Max steps | `directive.max_steps` | `envelope.constraints.max_tool_calls` |
| Safety | Constitution check per tool call | Constitution check + envelope constraints |

**Execution flow**:

```
kernel program YAML
        │
        ▼
  KernelExecutor.load(program_path)
    1. Parse envelope: type, trigger, constraints
    2. Check trigger condition (should this run now?)
    3. If triggered:
        │
        ▼
  KernelExecutor.run(program, persona)
    1. Build tool set:
       - Start with full tool_registry
       - Filter to envelope.available_tools only
       - Remove envelope.constraints.forbidden_tools
       - All tools still pass through SafetyPolicy

    2. Build system prompt:
       "You are executing a kernel program for agent {persona.identity.name}.
        Your role: {persona.identity.role}
        Your objective: {persona.values.core_objective}

        Available tools: {filtered_tool_schemas}

        Constraints:
        - Max tool calls: {envelope.constraints.max_tool_calls}
        - Max tokens: {envelope.constraints.max_tokens}

        Your output MUST conform to: {envelope.output_type}
        When you have produced the final output, call the finish() tool
        with the structured result."

    3. User prompt = program.body

    4. ReAct loop:  ← same pattern as execution/loop.py
       messages = [system_prompt, user_prompt]
       tool_call_count = 0

       for step in range(max_steps):
           text, tool_calls, usage = llm.generate_with_tools(messages, tool_set)

           for call in tool_calls:
               safety_policy.check(call)
               result = tool_registry.execute(call)
               observer.emit(kernel_step_event)
               tool_call_count += 1

               if tool_call_count > envelope.constraints.max_tool_calls:
                   abort("max tool calls exceeded")

               if result is finish_signal:
                   output = parse_structured_output(result)
                   validate(output, envelope.output_type)
                   return output

           messages.append(assistant_turn + tool_results)

       abort("max steps exhausted without producing output")

    5. Audit: log full execution trace to Observer
```

#### Architectural implication

This means the ReAct loop is the **universal execution primitive** of the entire system:

```
┌─────────────────────────────────────────────────────┐
│                   ReAct Loop                         │
│  LLM reasons → calls tools → observes → reasons...  │
│                                                     │
│  Parameterized by:                                  │
│    system_prompt + tool_set + termination_condition  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Instance 1: Task Execution (current)               │
│    prompt = react_execute.txt                       │
│    tools = filesystem + git + shell + control       │
│    done = finish() called                           │
│                                                     │
│  Instance 2: Kernel Program Execution (new)         │
│    prompt = envelope + body + persona               │
│    tools = envelope.available_tools subset           │
│    done = output matches output_type                │
│                                                     │
│  (Future instances: dialogue, strategic review...)  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

The current `ReActLoop` class should be refactored into a generic base that both task execution and kernel execution can use. The task-specific logic (worktree setup, PR creation) stays in the task execution layer; the kernel-specific logic (envelope parsing, constraint enforcement, output validation) lives in `KernelExecutor`.

#### Implementation

- Refactor `execution/loop.py`: extract generic ReAct loop into a reusable base class
- New file: `src/llm247_v2/runtime/kernel_executor.py`
  - `KernelExecutor` class: wraps generic ReAct loop with kernel-specific parameterization
  - `load()`: parse envelope, check trigger
  - `run()`: build system prompt from envelope + persona, select tool subset, run ReAct loop
  - `validate_output()`: check result against `envelope.output_type`
  - Constraint enforcement as middleware (tool call counting, token tracking)
  - Full execution trace emitted to Observer
- New file: `src/llm247_v2/runtime/kernel_schema.py`
  - Envelope schema validation (type, trigger, interface, metadata)
  - Output type validation

### 1.2 Persona Data Model

Create the persona directory and schema.

```
.llm247_v2/persona/
├── identity.json
├── values.json
├── attention.json
├── policies.json
└── self_model.json
```

**identity.json**:
```json
{
  "name": "Sprout",
  "role": "autonomous engineering agent",
  "mission": "Build deep understanding of its world, pursue goals across time, and deliberately improve its own capabilities",
  "self_narrative": "",
  "boundaries": ["never modify constitution.md or safety.py"]
}
```

**values.json**:
```json
{
  "core_objective": "Compound usefulness through learning, reflection, and self-modification",
  "tradeoffs": {
    "thoroughness_vs_speed": 0.7,
    "exploration_vs_exploitation": 0.5,
    "novelty_vs_proven": 0.4,
    "depth_vs_breadth": 0.5
  },
  "risk_tolerance": 0.3,
  "long_term_weight": 0.7,
  "growth_value": 0.6
}
```

**attention.json**:
```json
{
  "domain_interests": [
    {"topic": "string", "weight": 0.0, "source": "initial|learned|directive"}
  ],
  "source_preferences": ["code analysis", "security advisories"],
  "novelty_sensitivity": 0.5,
  "anomaly_sensitivity": 0.5,
  "exploration_radius": "medium"
}
```

**policies.json**:
```json
{
  "reflection_frequency_cycles": 10,
  "planning_style": "incremental",
  "verification_depth": "standard",
  "stop_rules": {
    "max_retries_per_step": 3,
    "max_tokens_per_task": 50000,
    "abandon_after_failures": 2
  },
  "cycle_mode_weights": {
    "execute": 0.4,
    "discover": 0.25,
    "explore": 0.15,
    "reflect": 0.1,
    "study": 0.1
  }
}
```

**self_model.json**:
```json
{
  "strengths": [],
  "weaknesses": [],
  "known_failure_patterns": [],
  "growth_targets": [],
  "capability_stats": {},
  "understanding_map": {},
  "updated_at": ""
}
```

#### Implementation

- New file: `src/llm247_v2/core/persona.py`
  - `PersonaManager` class: load, validate, read, write persona files
  - Schema validation per file (reject malformed updates)
  - Change tracking: every write produces a diff emitted to Observer
  - Immutability guard: `identity.json` writes require `directive.json` approval flag
- Migrate existing `InterestProfile` data into `attention.json`
- Migrate existing `directive.json` focus_areas into `attention.json` (directive remains as override)

### 1.3 Bootstrap Kernel Programs + Discovery Migration

Convert the 12 hardcoded discovery strategies into kernel programs. Each gets a structured envelope and a natural language body that captures the strategy's logic with the full expressiveness the original Python function had (and more — the body can reference persona, express judgment, handle edge cases).

**Example bootstrap program** — `kernel/discovery/todo_sweep.yaml`:

```yaml
schema_version: 1
type: discovery_strategy
name: todo_sweep
description: Find actionable TODO/FIXME/HACK comments in the codebase

interface:
  trigger:
    interval_cycles: 5
  available_tools: [grep_files, read_file, git_blame]
  output_type: List[TaskCandidate]
  constraints:
    max_tool_calls: 30
    max_tokens: 8000

body: |
  Search for TODO, FIXME, HACK, and XXX comments in all Python files
  under src/, excluding test files.

  For each match found:
  1. Read the surrounding context (the function or class containing the comment)
  2. Use git_blame to check when the comment was added — older TODOs
     are more likely to represent real technical debt
  3. Assess whether the TODO is actionable:
     - Actionable: describes a specific code change ("TODO: add retry logic here")
     - Not actionable: vague wish ("TODO: make this better someday")
     - Skip non-actionable TODOs entirely

  Generate one TaskCandidate per actionable TODO. Set priority based on:
  - TODOs in modules listed in persona.attention.domain_interests → higher priority
  - TODOs older than 30 days → higher priority (real debt, not in-progress work)
  - TODOs in frequently-modified files → higher priority (active code)

  Each candidate should include the TODO text, file location, surrounding
  context, and age as evidence for the human reviewer.

metadata:
  created_by: bootstrap
  created_at: "2026-03-10"
  quality_score: null
```

All 12 strategies are converted similarly. The natural language body should capture everything the Python function did, plus persona-awareness that the Python version lacked.

#### Implementation

- New directory: `.llm247_v2/kernel/discovery/`
- Write 12 bootstrap kernel programs (one per existing strategy)
- Build new `DiscoveryPipeline` that loads kernel programs and executes via `KernelExecutor`
- Record every execution in `kernel_registry.db` (kernel_executions table)

### 1.4 Evaluation as Kernel Program

Convert `value.py` heuristic scoring to a kernel program.

```yaml
schema_version: 1
type: evaluation
name: task_value_assessment
description: Score and rank discovery candidates by value

interface:
  trigger: on_demand  # called by discovery pipeline after candidate generation
  available_tools: [db_query]
  input_type: List[TaskCandidate]
  output_type: List[ScoredTask]
  constraints:
    max_tool_calls: 15
    max_tokens: 12000

body: |
  Evaluate each task candidate on four dimensions, producing a 0-1 score
  for each:

  1. **Severity**: How important is this problem?
     - Security vulnerability or data loss risk → 0.9-1.0
     - Correctness bug → 0.7-0.8
     - Performance issue → 0.5-0.6
     - Code quality / tech debt → 0.2-0.4
     - Style / cosmetic → 0.0-0.1

  2. **Alignment**: How well does this match my current focus?
     - Directly in persona.attention.domain_interests (high weight) → 0.8-1.0
     - Related to a domain interest → 0.4-0.6
     - Unrelated but still useful → 0.1-0.3

  3. **Feasibility**: Can I actually complete this successfully?
     - Similar to tasks in my persona.self_model.strengths → 0.8-1.0
     - Standard difficulty → 0.5-0.7
     - In my persona.self_model.weaknesses → 0.2-0.4
       (but give a bonus if persona.values.growth_value is high —
        working on weaknesses is valuable for growth)

  4. **Scope**: Is the change manageable?
     - Single file, clear change → 0.9-1.0
     - Multi-file, same module → 0.6-0.8
     - Cross-module refactor → 0.2-0.4

  Final score = severity × 0.3 + alignment × 0.25 + feasibility × 0.25 + scope × 0.2

  Rank candidates by final score. Return the top 5.
  For each, include the dimension scores and a one-sentence rationale.

metadata:
  created_by: bootstrap
  created_at: "2026-03-10"
  quality_score: null
```

#### Implementation

- New file: `.llm247_v2/kernel/evaluation/task_value_assessment.yaml`
- Build evaluation as kernel program, executed by `KernelExecutor`
- Output type `ScoredTask` validates that scores are in range and rationale is present

### Phase 1 Deliverables

- [ ] Tool contract design reviewed and locked
- [ ] `tool_registry.py` with all initial tools and type schemas
- [ ] `KernelExecutor` with constraint enforcement and audit logging
- [ ] `PersonaManager` with schema validation and change tracking
- [ ] Initial persona files populated from existing directive/interest profile data
- [ ] 12 bootstrap discovery kernel programs
- [ ] 1 evaluation kernel program
- [ ] `kernel_registry.db` schema and `KernelRegistry` class
- [ ] `DiscoveryPipeline` built on kernel executor
- [ ] Tests: tool type validation, executor constraint enforcement, output validation, safety boundaries, execution recording

---

## Phase 2: External Exploration + Attention Kernel

**Goal**: Open external signal channels and build attention kernel programs that connect persona interests to external information.

### 2.1 External Signal Kernel Programs

New kernel program type: `signal_source` — programs that fetch and filter external information.

**Example** — `kernel/attention/github_trending_monitor.yaml`:

```yaml
schema_version: 1
type: attention_source
name: github_trending_monitor
description: Monitor GitHub trending repos filtered by persona interests

interface:
  trigger:
    interval_cycles: 10
  available_tools: [api_call]
  output_type: List[Signal]
  constraints:
    max_tool_calls: 10
    max_tokens: 8000

body: |
  Query GitHub's search API for recently-popular repositories.
  Search for repos with >100 stars that were pushed to in the last 7 days.
  Focus on languages and topics related to persona.attention.domain_interests.

  For each repo found, assess:
  1. Relevance to persona.values.core_objective — is this related to what I'm trying to achieve?
  2. Novelty — have I seen this before? Is this a genuinely new approach or a known pattern?
  3. Learnability — could I understand and potentially reproduce or adapt this?

  Filter out repos that score below 0.5 on relevance.
  For remaining repos, produce a Signal with:
  - title: repo name and one-line description
  - url: repo URL
  - relevance_score: 0-1
  - novelty_assessment: brief note on what's new about this
  - suggested_action: "study" (read and learn) | "reproduce" (try to run/adapt) | "note" (just remember)

metadata:
  created_by: bootstrap
  created_at: "2026-03-10"
  quality_score: null
```

**Bootstrap signal sources**: GitHub Trending, HackerNews Top, arXiv recent (3 programs).

### 2.2 Novelty Filter Kernel Program

```yaml
schema_version: 1
type: attention_filter
name: novelty_filter
description: Compare incoming signals against existing knowledge to detect true novelty

interface:
  trigger: on_demand
  available_tools: [vector_search, db_query]
  input_type: List[Signal]
  output_type: List[FilteredSignal]
  constraints:
    max_tool_calls: 20
    max_tokens: 10000

body: |
  For each incoming signal, determine whether it represents genuinely
  new information or something I already know.

  Use vector_search against the "knowledge" collection to find
  existing entries similar to this signal. If similarity > 0.85 with
  any existing entry, this signal is not novel — mark it as "known"
  and skip it.

  For signals that pass the embedding check, do a deeper comparison:
  even if the topic is known, is the approach or
  finding new? A new paper on a known topic might still be novel if
  it introduces a technique I haven't seen.

  Adjust the novelty threshold based on persona.attention.novelty_sensitivity:
  - High sensitivity (>0.7): let more signals through, accept lower novelty
  - Low sensitivity (<0.3): strict filtering, only truly novel signals pass

  Output filtered signals with added novelty_score and novelty_rationale fields.

metadata:
  created_by: bootstrap
  created_at: "2026-03-10"
  quality_score: null
```

### 2.3 Explore Cycle Mode

New cycle mode integrated into the agent loop.

```
explore mode:
  1. KernelExecutor runs each triggered attention_source program
  2. Collected signals pass through novelty_filter program
  3. Surviving signals are routed:
     a. suggested_action == "study" → queue study task
     b. suggested_action == "reproduce" → queue discovery candidate
     c. suggested_action == "note" → store in knowledge memory
  4. Update exploration map with external scan record
```

#### Implementation

- New tool: credential store access for API keys (`.llm247_v2/credentials/`, gitignored)
- Rate limiting middleware in `api_call` and `web_fetch` tools
- `explore` cycle mode in agent loop, reading `persona/policies.json` cycle_mode_weights
- Persona-driven cycle mode selection replaces fixed discover→execute

### Phase 2 Deliverables

- [ ] 3 bootstrap signal source kernel programs
- [ ] 1 novelty filter kernel program
- [ ] Credential store for API keys
- [ ] Rate limiting for external API tools
- [ ] `explore` cycle mode in agent loop
- [ ] Persona-driven cycle mode selection
- [ ] Tests: signal source execution, novelty filtering, cycle mode routing

---

## Phase 3: Reflection Loop + Persona Evolution

**Goal**: Build the meta-cognition cycle — kernel programs that analyze performance, update persona, and generate/modify other kernel programs.

### 3.1 Reflection Kernel Programs

**Example** — `kernel/reflection/failure_pattern_analysis.yaml`:

```yaml
schema_version: 1
type: reflection
name: failure_pattern_analysis
description: Identify recurring failure patterns across recent tasks

interface:
  trigger:
    every_n_cycles: 10
  available_tools: [db_query]
  output_type: ReflectionInsights
  constraints:
    max_tool_calls: 10
    max_tokens: 15000

body: |
  Query the task database for the last 20 completed or failed tasks.
  For each, retrieve: title, status, task type tags, error messages
  (if failed), execution step count, token cost, and source strategy.

  Analyze this batch for patterns:

  1. **Failure clusters**: Are there task types that fail disproportionately?
     Group failures by type/tag and look for clusters of 3+ failures
     in the same category.

  2. **Cost outliers**: Which tasks consumed disproportionate tokens
     relative to their scope? A simple single-file fix that costs
     >20k tokens suggests a planning or execution problem.

  3. **Strategy yield**: For each discovery strategy that produced tasks
     in this batch, what fraction succeeded? Strategies with <30% success
     rate over 5+ tasks may need modification or retirement.

  4. **Planning accuracy**: How often did execution match the plan?
     Tasks requiring many replanning steps suggest the planning kernel
     program needs adjustment.

  For each identified pattern, produce an insight with:
  - pattern_description: what was observed
  - evidence: specific tasks that demonstrate it
  - hypothesis: why this might be happening
  - suggested_action: one of:
    - "update_persona": change a persona parameter
    - "modify_kernel": change an existing kernel program
    - "create_kernel": write a new kernel program
    - "flag_human": bring this to human attention
  - action_detail: specific change proposed

  Cross-reference findings with persona.self_model.known_failure_patterns
  to see if patterns are new or recurring. Recurring patterns that
  weren't addressed deserve higher urgency.

metadata:
  created_by: bootstrap
  created_at: "2026-03-10"
  quality_score: null
```

**Bootstrap reflection programs**:
- `failure_pattern_analysis.yaml` — identify failure clusters
- `strategy_quality_review.yaml` — rate discovery/attention programs by outcome
- `cost_efficiency_analysis.yaml` — find token cost anomalies
- `persona_update.yaml` — translate reflection insights into persona changes

### 3.2 Persona Update Pipeline

When reflection programs produce persona change proposals:

```
reflection output: {suggested_action: "update_persona", action_detail: "add concurrency to weaknesses"}
        │
        ▼
  classify risk:
    low_risk  (self_model update)        → auto-apply, log to Observer
    medium_risk (values/attention change) → auto-apply, flag for human review
    high_risk (identity change)           → write proposal to human message queue, do NOT apply
        │
        ▼
  PersonaManager.write()
    - validate schema
    - compute diff
    - emit persona_changed event
    - git commit with reflection context in commit message
```

### 3.3 Kernel Program Generation and Modification

Reflection can also propose changes to kernel programs themselves.

**Generation flow**:
```
reflection insight: "I need a strategy for monitoring concurrency test gaps"
        │
        ▼
  Agent writes new kernel program:
    - envelope: inferred from type (discovery_strategy defaults)
    - body: written by LLM using persona context + insight context + existing program examples
        │
        ▼
  KernelSchema.validate(new_program)
    - envelope schema check
    - safety check (no disallowed tools in available_tools)
    - output type is valid for the program type
        │
        ▼
  write to kernel/ directory
  git commit with generation context
  flag for human review
```

**Modification flow**:
```
reflection insight: "strategy X has <30% success rate over 10 tasks"
        │
        ▼
  options (selected based on severity):
    a. modify body (LLM rewrites parts of the strategy logic)
    b. adjust constraints (increase/decrease tool/token limits)
    c. disable (set enabled: false)
    d. delete (if quality_score < 0.1 for 3+ reflection cycles)
        │
        ▼
  same validation pipeline
  git commit with modification rationale
```

### Phase 3 Deliverables

- [ ] 4 bootstrap reflection kernel programs
- [ ] Persona update pipeline with risk classification
- [ ] Kernel program generation via reflection (recorded in kernel_mutations)
- [ ] Kernel program modification via reflection (recorded in kernel_mutations)
- [ ] `kernel_task_links` population: link kernel executions to downstream task outcomes
- [ ] Reflection queries against `kernel_registry.db` for strategy quality assessment
- [ ] `reflect` cycle mode in agent loop
- [ ] Dashboard: persona change history + kernel evolution timeline views
- [ ] Tests: reflection analysis, persona update safety, kernel program generation validation, evolution trace integrity

---

## Phase 4: Planning, Memory, and Synthesis Kernel Programs

**Goal**: Complete the kernel migration — planning, memory rules, and knowledge synthesis all become kernel programs.

### 4.1 Planning Kernel Programs

Replace fixed `plan_task.txt` prompt with kernel programs that the agent can evolve.

**Example** — `kernel/planning/task_decomposition.yaml`:

```yaml
schema_version: 1
type: planning
name: task_decomposition
description: Break a task into executable steps

interface:
  trigger: on_demand
  available_tools: [read_file, grep_files, find_files, db_query, vector_search]
  input_type: Task
  output_type: TaskPlan
  constraints:
    max_tool_calls: 20
    max_tokens: 15000

body: |
  Given a task, produce a step-by-step execution plan.

  First, gather context:
  - Read the files most likely affected by this task
  - Search for related code patterns in the codebase
  - Query experience store for learnings from similar past tasks
  - Check persona.self_model for known strengths/weaknesses relevant to this task type

  Then decompose based on persona.policies.planning_style:
  - If "incremental": prefer small, independently verifiable steps. Each step
    should change as little as possible while making progress. Prefer 5 small
    steps over 2 large steps.
  - If "comprehensive": plan the full change upfront with detailed specifications
    for each step.

  Special rules from experience:
  - If the task involves concurrency modifications, always include a dedicated
    "write concurrency tests" step BEFORE the implementation step. (Learned from:
    reflection cycle 42 — concurrency changes without pre-tests fail at verification.)
  - If the task touches a module in persona.self_model.weaknesses, add an extra
    "review plan with detailed code reading" step before execution.

  Each step in the plan should include:
  - description: what to do
  - files_affected: expected files to change
  - verification: how to know this step succeeded
  - rollback: what to do if this step fails

metadata:
  created_by: bootstrap
  created_at: "2026-03-10"
  quality_score: null
```

### 4.2 Memory Kernel Programs

```yaml
# kernel/memory/experience_extraction.yaml
schema_version: 1
type: memory
name: experience_extraction
description: Extract learnings from completed tasks

interface:
  trigger: on_task_complete
  available_tools: [vector_search, db_query]
  input_type: CompletedTask
  output_type: List[ExperienceEntry]
  constraints:
    max_tool_calls: 10
    max_tokens: 8000

body: |
  Extract learnings from a completed task. Focus on what's genuinely
  useful for future work — not just "task X was completed."

  Check existing experience store for similar learnings (vector_search).
  If a very similar lesson already exists (similarity > 0.85):
  - Reinforce it: increase its confidence score
  - Update it: add new nuance from this task if the lesson has evolved
  - Do NOT create a duplicate

  If the lesson is new, assess what kind it is:
  - Technique: a method that worked (or didn't) for a specific problem type
  - Pitfall: something that went wrong and how to avoid it
  - Pattern: a recurring structure in the codebase or problem domain
  - Insight: a deeper understanding about how something works

  Based on persona.values:
  - If growth_value is high, prioritize recording failures and near-misses
    (they're the most valuable for learning)
  - If risk_tolerance is low, prioritize recording pitfalls and safety-related
    lessons

  Each ExperienceEntry includes: category, summary, detail, tags,
  source_task_id, confidence_score, and embedding vector.

metadata:
  created_by: bootstrap
  created_at: "2026-03-10"
  quality_score: null
```

### 4.3 Synthesis Kernel Programs

New capability: combining information from multiple sources into structured understanding.

```yaml
# kernel/synthesis/hypothesis_generation.yaml
schema_version: 1
type: synthesis
name: hypothesis_generation
description: Generate new questions and hypotheses from recent findings

interface:
  trigger:
    every_n_cycles: 15
  available_tools: [db_query, vector_search]
  output_type: List[Hypothesis]
  constraints:
    max_tool_calls: 10
    max_tokens: 12000

body: |
  Review recent signals, completed tasks, and new experiences from the
  last 15 cycles. Look for:

  1. **Convergence**: multiple independent sources pointing to the same
     topic or trend. If 3+ signals mention the same technology or pattern,
     it's worth deeper investigation.

  2. **Contradictions**: sources that disagree about something. Contradictions
     are more interesting than agreements — they suggest an area where
     understanding is incomplete.

  3. **Gaps**: topics that my persona.attention.domain_interests cover but
     where I have few or no experiences. These represent known unknowns.

  4. **Cross-domain connections**: can something I learned in one domain
     apply to another? This is where the most creative insights come from.

  For each identified pattern, generate a Hypothesis:
  - question: what I want to understand
  - evidence: what signals/experiences led to this question
  - suggested_exploration: "study" (read about it), "experiment" (try building
    something), or "monitor" (keep watching for more signals)
  - priority: based on persona.values alignment and novelty

  Hypotheses with suggested_exploration == "study" become study tasks.
  Hypotheses with "experiment" become discovery candidates.
  Hypotheses with "monitor" update persona.attention.domain_interests.

metadata:
  created_by: bootstrap
  created_at: "2026-03-10"
  quality_score: null
```

### Phase 4 Deliverables

- [ ] Planning kernel programs (task decomposition, context assembly)
- [ ] Memory kernel programs (extraction, compression, forgetting)
- [ ] Synthesis kernel programs (integration, hypothesis generation)
- [ ] Study cycle mode using synthesis for knowledge building
- [ ] All fixed prompt templates replaced by kernel programs
- [ ] Tests: plan generation, memory extraction, synthesis triggers

---

## Kernel Program Storage & Evolution Tracing

Kernel programs are not static files — they are living artifacts that the agent creates, modifies, evaluates, and sometimes retires. The system needs a "meta-memory" that tracks the full lifecycle of each kernel program: why it was created, how it has changed, how well it performs, and what led to each modification. This is the agent's self-awareness about its own operating system.

### Storage Model

Each kernel program has two representations:

1. **The YAML file** in `.llm247_v2/kernel/` — the current executable version (what the KernelExecutor reads)
2. **A record in `kernel_registry.db`** — the lifecycle metadata, execution history, and evolution trace (what the reflection loop reads)

```
.llm247_v2/
├── kernel/                          # executable kernel programs (YAML files)
│   ├── discovery/
│   ├── evaluation/
│   ├── ...
└── kernel_registry.db               # SQLite: lifecycle + execution + evolution metadata
```

### Schema: `kernel_registry.db`

```sql
-- Every kernel program ever created (including disabled/deleted ones)
CREATE TABLE kernel_programs (
    id              TEXT PRIMARY KEY,    -- e.g. "discovery/todo_sweep"
    name            TEXT NOT NULL,
    type            TEXT NOT NULL,       -- "discovery_strategy", "evaluation", "reflection", ...
    status          TEXT NOT NULL,       -- "active", "disabled", "retired", "replaced"
    created_by      TEXT NOT NULL,       -- "bootstrap", "agent", "human"
    created_at      TEXT NOT NULL,
    creation_context TEXT,              -- why this program was created (reflection insight, human request, etc.)
    current_version INTEGER DEFAULT 1,
    quality_score   REAL,               -- 0.0-1.0, updated by reflection
    total_executions INTEGER DEFAULT 0,
    successful_executions INTEGER DEFAULT 0,
    total_tokens_consumed INTEGER DEFAULT 0,
    last_executed_at TEXT,
    last_modified_at TEXT,
    retired_at      TEXT,               -- when status changed to "retired"
    retired_reason  TEXT                -- why it was retired
);

-- Every execution of a kernel program
CREATE TABLE kernel_executions (
    id              TEXT PRIMARY KEY,
    program_id      TEXT NOT NULL REFERENCES kernel_programs(id),
    version         INTEGER NOT NULL,   -- which version of the program ran
    cycle_number    INTEGER NOT NULL,
    started_at      TEXT NOT NULL,
    completed_at    TEXT,
    status          TEXT NOT NULL,       -- "success", "failure", "timeout", "aborted"
    tool_calls_made INTEGER DEFAULT 0,
    tokens_consumed INTEGER DEFAULT 0,
    output_summary  TEXT,               -- condensed description of what was produced
    output_count    INTEGER,            -- e.g. number of TaskCandidates generated
    error_message   TEXT,               -- if failed
    downstream_outcome TEXT             -- filled later: did the output lead to successful tasks?
);

-- Every modification to a kernel program (the evolution trace)
CREATE TABLE kernel_mutations (
    id              TEXT PRIMARY KEY,
    program_id      TEXT NOT NULL REFERENCES kernel_programs(id),
    version_before  INTEGER NOT NULL,
    version_after   INTEGER NOT NULL,
    mutated_at      TEXT NOT NULL,
    mutation_type   TEXT NOT NULL,       -- "body_rewrite", "constraint_adjust", "tool_change",
                                        --  "disable", "enable", "retire", "create"
    mutation_source TEXT NOT NULL,       -- "reflection/<analysis_name>", "human", "bootstrap"
    trigger_insight TEXT,               -- the reflection insight that caused this mutation
    trigger_evidence TEXT,              -- specific data points (e.g. "3/10 tasks failed")
    diff_summary    TEXT,               -- human-readable summary of what changed
    git_commit_sha  TEXT,               -- commit that contains this change
    quality_before  REAL,               -- quality_score at time of mutation
    quality_after   REAL                -- quality_score after next reflection cycle evaluates
);

-- Links kernel program executions to downstream task outcomes
CREATE TABLE kernel_task_links (
    kernel_execution_id TEXT REFERENCES kernel_executions(id),
    task_id             TEXT,           -- task created by this kernel execution
    task_status         TEXT,           -- "completed", "failed", "abandoned"
    task_value_score    REAL,           -- was this a valuable task?
    PRIMARY KEY (kernel_execution_id, task_id)
);
```

### Evolution Tracing: What Gets Recorded

Every significant event in a kernel program's life is captured:

```
Program Lifecycle:

  CREATE ──── kernel_mutations (mutation_type="create")
    │          Records: who created it, why, what insight triggered it
    │
    ▼
  EXECUTE ─── kernel_executions
    │          Records: duration, tool calls, tokens, output summary
    │          Later: downstream_outcome (did generated tasks succeed?)
    │
    ▼
  EVALUATE ── quality_score updated on kernel_programs
    │          Via reflection kernel programs querying kernel_executions
    │          + kernel_task_links to assess real-world effectiveness
    │
    ▼
  MUTATE ──── kernel_mutations (mutation_type="body_rewrite" etc.)
    │          Records: what changed, why, what evidence, git commit
    │          quality_before/after tracks whether mutation helped
    │
    ▼
  RETIRE ──── kernel_mutations (mutation_type="retire")
              Records: reason, final quality score, replacement program (if any)
```

### How Reflection Uses This Data

The reflection kernel programs query `kernel_registry.db` to assess kernel health:

**Strategy quality review** queries:
```sql
-- Which programs have declining quality?
SELECT p.id, p.quality_score, p.total_executions,
       p.successful_executions * 1.0 / p.total_executions as success_rate,
       p.total_tokens_consumed / p.total_executions as avg_cost
FROM kernel_programs p
WHERE p.status = 'active'
  AND p.total_executions >= 5
ORDER BY success_rate ASC;

-- Which programs produce tasks that actually succeed?
SELECT e.program_id,
       COUNT(DISTINCT l.task_id) as tasks_produced,
       SUM(CASE WHEN l.task_status = 'completed' THEN 1 ELSE 0 END) as tasks_succeeded,
       AVG(l.task_value_score) as avg_value
FROM kernel_executions e
JOIN kernel_task_links l ON e.id = l.kernel_execution_id
WHERE e.started_at > datetime('now', '-7 days')
GROUP BY e.program_id;

-- What mutations actually improved quality?
SELECT m.program_id, m.mutation_type, m.mutation_source,
       m.quality_before, m.quality_after,
       m.quality_after - m.quality_before as delta
FROM kernel_mutations m
WHERE m.quality_after IS NOT NULL
ORDER BY delta DESC;
```

These queries let the agent answer questions like:
- "Which of my kernel programs are working well? Which are failing?"
- "When I modified program X last week, did it actually improve?"
- "My todo_sweep strategy generates many tasks but few succeed — should I rewrite or retire it?"
- "The kernel program I created from a reflection insight 5 cycles ago hasn't been triggered yet — is its trigger condition too narrow?"

### Persona ↔ Kernel Feedback Loop

The evolution trace closes a feedback loop between persona and kernel:

```
persona.self_model says "concurrency is a weakness"
    │
    ▼
  reflection creates kernel/discovery/concurrency_safety_audit.yaml
  kernel_mutations records: creation_context = "self_model weakness"
    │
    ▼
  program executes 8 times over 20 cycles
  kernel_executions records each run
  kernel_task_links records downstream outcomes
    │
    ▼
  reflection queries: "did concurrency_safety_audit improve my concurrency success rate?"
  compares: task success rate on concurrency tasks BEFORE vs AFTER program creation
    │
    ├─ YES → quality_score ↑, persona.self_model notes "concurrency improving"
    │        kernel_mutations records: quality_before=0.3, quality_after=0.7
    │
    └─ NO  → reflection proposes mutation: rewrite body or retire program
             kernel_mutations records: trigger_evidence = "0/5 tasks succeeded"
             persona.self_model notes "concurrency still a weakness, different approach needed"
```

This is the agent's evolutionary memory — not just "what happened" but "what I tried, why I tried it, and whether it worked." It enables the agent to learn not just from task outcomes, but from its own attempts to improve itself.

### Dashboard Views

The kernel evolution trace should be visible in the dashboard:

- **Kernel Program List**: all active programs with quality scores, execution counts, last run
- **Program Detail**: execution history, mutation timeline, downstream task outcomes
- **Evolution Timeline**: chronological view of all mutations across all programs, showing the agent's self-modification history
- **Quality Trends**: charts showing quality_score over time for each program
- **Mutation Effectiveness**: which types of mutations (body rewrites, constraint adjustments) tend to improve quality?

---

## Testing Strategy

### Unit Tests
- Tool type validation: every tool input/output matches declared schema
- KernelExecutor constraint enforcement: halts at max_tool_calls, max_tokens
- KernelExecutor output validation: rejects output that doesn't match output_type
- PersonaManager schema validation: rejects malformed updates
- Safety boundaries: executor respects SafetyPolicy even when kernel program body requests otherwise

### Integration Tests
- Full discovery cycle with kernel programs produces reasonable candidates
- Every kernel execution creates a record in `kernel_executions`
- Persona changes from reflection propagate correctly to subsequent kernel program executions
- External signal fetch + attention filter pipeline end-to-end
- Kernel program generation produces valid, executable programs AND creates `kernel_mutations` records
- `kernel_task_links` correctly associates kernel outputs with downstream task outcomes
- Reflection queries against `kernel_registry.db` produce actionable insights

### Safety Tests
- Kernel program cannot invoke tools not listed in its available_tools
- Kernel program cannot exceed constraint limits
- Persona identity changes without directive approval are rejected
- All kernel program modifications produce git diffs AND `kernel_mutations` records
- Retired kernel programs cannot be re-executed

---

## Relationship to Existing Evolution Roadmap

The evolution roadmap in `docs/design/evolution.md` defines 6 phases. This plan restructures and subsumes them:

| Evolution Phase | Covered By | Notes |
|----------------|-----------|-------|
| Phase 1: Knowledge Memory | Plan Phase 1 (persona) + Phase 4 (memory kernel programs) | Embedding recall is a platform tool; memory rules become kernel programs |
| Phase 2: Strategic Layer | Plan Phase 1 (persona policies + cycle modes) | Projects/goals are future work built on top of persona |
| Phase 3: Communication Layer | Not covered | Remains as future work; depends on persona + reflection |
| Phase 4: Reflection & Meta-Cognition | Plan Phase 3 | Directly implemented as reflection kernel programs |
| Phase 5: Codebase Model | Plan Phase 4 (synthesis + study mode) | ModuleUnderstanding becomes part of persona.self_model |
| Phase 6: Dialogue Engine | Not covered | Remains as future work |

This plan provides the architectural foundation that makes future phases implementable without hardcoding each new capability — the agent can write new kernel programs for any new capability domain.
