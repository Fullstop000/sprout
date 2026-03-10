# Proposal: Persona-Driven Kernel Architecture

> Status: Draft
> Created: 2026-03-10
> Decision: Should Sprout adopt a four-layer architecture (Constitution / Persona / Kernel / Platform) where the agent writes its own behavioral programs in a natural-language kernel layer?
> Scope: Fundamental restructuring of how agent behavior is defined — affects discovery, planning, evaluation, reflection, and memory across the entire V2 runtime
> Next Step: Review motivation and architecture; if approved, proceed to implementation plan
> Related: [../design/architecture.md](../design/architecture.md), [../design/evolution.md](../design/evolution.md), [../design/discovery.md](../design/discovery.md), [../design/core.md](../design/core.md)

## Summary

Sprout's behavioral modules (discovery strategies, planning prompts, evaluation criteria, reflection patterns, memory rules) are currently hardcoded as Python functions and fixed prompt templates. The agent's "individuality" is limited to parameter tuning within a human-designed menu. This proposal introduces a four-layer architecture — **Constitution / Persona / Kernel / Platform** — where the persona layer is the agent's identity seed, and the kernel layer contains behavioral programs that the agent itself writes, maintains, and evolves. Kernel programs are expressed in structured natural language (the agent's native medium), executed by the platform's LLM runtime against a set of tools. The result: an agent whose behavior is a living expression of its identity, not a configuration of pre-built parts.

## Problem

### 1. The individuality ceiling

Sprout's `InterestProfile` and `directive.json` let humans tune which of 12 hardcoded discovery strategies the agent prefers. But the strategies themselves — what they scan, how they interpret results, what they consider valuable — are fixed Python functions. Two agents with radically different personas would still execute the same `todo_sweep`, the same `complexity_scan`, the same `test_coverage` logic. The persona influences *selection* but not *generation* of behavior.

This applies to every behavioral module:

| Module | What persona can influence today | What persona cannot influence |
|--------|--------------------------------|------------------------------|
| Discovery | Strategy weights via InterestProfile | What strategies exist, how they work |
| Planning | Nothing (fixed prompt template) | Planning style, depth, decomposition approach |
| Evaluation | Nothing (hardcoded heuristics in value.py) | What counts as "valuable", tradeoff weights |
| Reflection | Nothing (not implemented) | What to reflect on, how to attribute failures |
| Memory | Nothing (fixed extraction prompt) | What to remember, when to forget, how to compress |

The persona is consulted at the edges but has no generative power over the core behavior.

### 2. The outward exploration gap

Three design documents (`__loop_design.md`, `__meta_cong.md`, `__persona_design.md`) describe an agent that explores the external world — monitors GitHub Trending, reads arXiv papers, scans HackerNews, discovers emerging technologies, reproduces experiments, builds new projects. Sprout's current discovery module is almost entirely inward-facing: it scans its own codebase for problems to fix. Only `web_search` and `dep_audit` touch external sources, and only to find issues relevant to the existing stack.

This isn't a missing feature — it's a consequence of hardcoded modules. If discovery strategies are Python functions, adding external exploration means a human must write each new strategy. If strategies are agent-generated kernel programs, an agent curious about AI research would naturally write a program that scans arXiv for papers related to its domain interests.

### 3. The meta-cognition gap

`__meta_cong.md` describes a self-evolution loop: periodically review past work, analyze failure patterns, adjust exploration weights. `__persona_design.md` identifies the Adaptation Layer (self-evaluation, error attribution, strategy updates, meta-learning) as having the highest individuality determination.

Sprout extracts learnings from individual tasks but cannot:
- Identify patterns across tasks ("my refactoring plans are consistently too aggressive")
- Attribute failures to specific causes (bad search? bad reasoning? bad execution?)
- Adjust its own strategies based on what it learns about itself
- Modify the way it plans, evaluates, or reflects

These capabilities require that planning logic, evaluation criteria, and reflection patterns are **writable by the agent**, not frozen in code.

### 4. The cognitive loop mismatch

`__loop_design.md` describes a cognitive loop: Goal Discovery → Information Exploration → Knowledge Synthesis → Experiment/Build → Evaluation → New Hypothesis → Repeat. Sprout's loop is: scan codebase → plan fix → execute → verify → ship PR → sleep. The Synthesis step (combining information from multiple sources into structured understanding before acting) and the Hypothesis step (generating new questions from completed work) are entirely absent.

These steps cannot be added as fixed modules because their content depends entirely on what the agent knows, what it cares about, and what it's trying to understand — all persona-driven concerns.

## Motivation: Three Design Documents

This proposal is motivated by the convergence of three design documents that collectively describe a vision far beyond Sprout's current architecture.

### `__loop_design.md` — The Cognitive Loop

Defines an Autonomous Research & Builder Agent with a six-phase cognitive loop (Research → Synthesis → Build → Evaluate → Expand) and six exploration directions (Knowledge Discovery, Signal Mining, Technical Reproduction, Idea Generation, Build, Opportunity Discovery). The key insight: the agent's exploration space should span the entire internet, not just its own codebase. The agent needs tools for web search, social media scanning, paper reading, trend detection, topic clustering — and the judgment to know which tools to deploy when.

The document also identifies three core difficulties:
1. **Exploration Policy** — deciding what to explore (requires a value system, i.e. persona)
2. **Long-horizon Planning** — tasks spanning hours or days (requires strategic identity)
3. **Knowledge Integration** — turning fragments into structured understanding (requires a world model)

All three are persona-dependent problems.

### `__meta_cong.md` — Curiosity and Self-Evolution

Defines two meta-cognitive modules:
1. **Curiosity-driven question generation** — scan emerging trends, compare against knowledge gaps, generate questions like "why don't I know this?" and "what happens if I combine this with what I already know?" Requires: trend monitoring APIs, a vector database for novelty detection, and an attention structure that determines what counts as "novel."
2. **Self-evolution and reflection** — periodically review past projects, classify failure causes, adjust future exploration weights. Requires: log analysis, critical self-assessment via LLM, and the ability to modify one's own workflow.

The critical implication: curiosity and reflection are not features to be bolted on — they require the agent to have a sense of what it knows, what it doesn't know, and what it values. These are persona properties.

### `__persona_design.md` — The Digital Life Dimensions

Provides a comprehensive taxonomy of 100+ dimensions across 11 layers that collectively define what makes a digital entity an individual:

| Layer | Core Question | Sprout Coverage |
|-------|--------------|-----------------|
| Identity | Who am I? | Partial (constitution + directive) |
| Memory | What do I remember and how? | Structure exists, rules are fixed |
| Attention | What do I notice? | Primitive (InterestProfile) |
| World Model | How do I understand things? | Missing |
| Value | What am I optimizing for? | Implicit in prompts, not explicit |
| Policy | How do I decide to act? | Hardcoded Python |
| Adaptation | How do I evolve? | Missing |
| Capability | What can I do? | Fixed tool set |
| Environment | What shapes me? | Only own codebase |
| Agency | How autonomous am I? | Rigid cycle, no goal generation |
| Self Model | How do I understand myself? | Missing |

The document's most important insight: **the dimensions with highest individuality determination are almost all "learnable"** — meaning they should emerge from experience, not be preconfigured. This requires that the agent can modify the structures that implement these dimensions. If evaluation criteria are hardcoded, the agent's values cannot evolve. If discovery strategies are fixed, the agent's attention patterns cannot grow. If memory rules are frozen, the agent's identity cannot form through experience.

The document identifies 10 dimensions that must be "first-class citizens" for true individuality:

1. Core objective function
2. Value ordering / tradeoffs
3. Attention structure
4. Problem decomposition style
5. Memory write rules
6. Memory compression / forgetting rules
7. Feedback absorption mechanism
8. Strategy update mechanism
9. Autonomy / goal generation capability
10. Self-model and continuity

None of these can be implemented as static configuration. They must be living, evolvable structures that the agent maintains.

## Proposal: Four-Layer Architecture

### Layer 1: Constitution (immutable, human-maintained)

The safety floor. Defines what the agent cannot do regardless of how its persona evolves or what kernel programs it writes.

```
constitution.md          Safety red lines, ethical boundaries
safety.py                Command allowlist, path protection, immutable file list
tool contracts           Each platform tool's input/output types and safety constraints
audit system             All behavior logged through Observer — no exceptions
PR workflow              All kernel program changes go through commit → PR → human review
```

**Design principle**: constraints, not implementations. The constitution says "a discovery strategy must output `List[Task]` and every task must pass constitution check" — it does not say what strategies should exist or how they should work.

### Layer 2: Persona (the identity seed)

The agent's self-understanding. Defines who it is, what it values, how it pays attention, and how it makes decisions. Stored as structured data that the agent can read, reason about, and — through the reflection loop — modify.

```
.llm247_v2/persona/
├── identity.json        Role, mission, self-narrative
├── values.json          Objective function, tradeoff weights, risk tolerance,
│                        exploration-exploitation balance
├── attention.json       Novelty sensitivity, domain interests, source preferences,
│                        anomaly sensitivity, exploration radius
├── world_model.json     Problem decomposition style, causal reasoning preferences,
│                        abstraction level preferences
├── policies.json        Reflection frequency, planning style, stop rules,
│                        tool selection heuristics, verification depth
└── self_model.json      Capability profile (strengths, weaknesses),
                         known failure patterns, growth targets
```

**Design principle**: the persona is not a configuration file that modules read — it is the seed from which kernel programs are generated. When the agent creates a new discovery strategy, it does so by reasoning about its persona. When it modifies a planning program, it does so because its self-model identified a weakness.

**Persona modification rules**:
- The agent can propose persona changes through the reflection loop
- Changes are committed to git and visible in the audit trail
- Humans can override any persona parameter via directive
- `identity.json` changes require explicit human approval (directive override)
- `values.json` changes are flagged for human review but not blocked

### Layer 3: Kernel (agent-written behavioral programs)

The kernel is the agent's operating system — the behavioral programs that translate persona (who I am) into action (what I do). **The agent writes these programs itself**, in its native medium: structured natural language.

This is the critical architectural distinction. The kernel is not a set of YAML pipelines that chain tool calls — that would be assembly language, limiting the agent to the expressiveness of predefined step types. Instead, each kernel program has:

- A **structured envelope** (schema): type, triggers, available tools, output contract, constraints — the interface that plugs the program into the system
- A **natural language body**: the actual behavioral logic, written by the agent, expressing judgment, priorities, contextual reasoning, and domain knowledge

The body is executed by the platform's LLM runtime, which interprets the agent's instructions and invokes platform tools as needed. This gives the agent the full expressiveness of natural language — conditionals, nuanced judgment, domain-specific reasoning, references to its own persona and history — while the envelope ensures the program integrates safely with the system.

**Example — a kernel program for discovery:**

```yaml
schema_version: 1
type: discovery_strategy
name: concurrency_safety_audit
description: Find concurrent code lacking safety guarantees

interface:
  trigger:
    interval_cycles: 8
    condition: "concurrency in persona.attention.domain_interests"
  available_tools: [grep_files, read_file, find_files, llm_analyze]
  output_type: List[TaskCandidate]
  constraints:
    max_tool_calls: 50
    max_tokens: 10000
    forbidden_tools: [run_command]

body: |
  Scan the codebase for concurrency risks that lack test coverage.

  First, find all Python files that use threading, asyncio, or
  concurrent.futures primitives. For each file found, read it and
  assess the complexity of concurrent patterns:

  - Shared mutable state across threads → high severity
  - Lock/Semaphore usage without corresponding unlock paths → high
  - Simple async/await without shared state → low severity

  For each file with medium-or-higher severity patterns, check whether
  a corresponding test file exists AND contains concurrency-specific
  tests (race condition tests, deadlock tests, async timing tests).

  Generate one task candidate per unprotected concurrency risk area.
  Prioritize by:
  1. Severity of the concurrent pattern
  2. Whether the code was recently modified (git blame recency)
  3. Whether this module is in persona.attention.domain_interests

  Because my self_model identifies concurrency as a weakness area,
  each generated task should include the note: "use test-first
  approach — write concurrency tests before modifying concurrent code."

metadata:
  created_by: agent
  created_at: "2026-03-10"
  source_insight: "reflection cycle 42: 2/3 concurrency fixes failed"
  quality_score: null
```

Compare this to a YAML pipeline version of the same logic — the natural language body can express:
- **Graduated judgment** ("assess complexity", "medium-or-higher severity") instead of binary filters
- **Persona-aware reasoning** ("because my self_model identifies concurrency as a weakness")
- **Domain knowledge** ("Lock without corresponding unlock paths") that would be impossible to express in a predefined action vocabulary
- **Nuanced prioritization** with multiple factors and implicit weighting
- **Contextual notes** on generated output ("use test-first approach") that carry forward into later execution

This is the difference between assembly and a high-level language. The envelope is the ABI; the body is the program.

**Kernel program directory:**

```
.llm247_v2/kernel/
├── discovery/
│   ├── codebase_todo_scan.yaml
│   ├── security_advisory_monitor.yaml
│   ├── concurrency_safety_audit.yaml     # agent-generated
│   └── arxiv_domain_scan.yaml            # agent-generated
├── evaluation/
│   └── task_value_assessment.yaml
├── planning/
│   ├── task_decomposition.yaml
│   └── context_assembly.yaml
├── execution/
│   └── verification.yaml
├── reflection/
│   ├── failure_pattern_analysis.yaml
│   ├── strategy_quality_review.yaml
│   └── persona_update.yaml
├── memory/
│   ├── experience_extraction.yaml
│   ├── compression.yaml
│   └── forgetting.yaml
├── attention/
│   ├── github_trending_monitor.yaml
│   ├── hackernews_scanner.yaml
│   └── novelty_filter.yaml
└── synthesis/
    ├── multi_source_integration.yaml
    └── hypothesis_generation.yaml
```

### Layer 4: Platform (human-maintained infrastructure)

The platform provides two things: **tools** (atomic capabilities the kernel can invoke) and **infrastructure** (the runtime that executes kernel programs).

**Critical design constraint: LLM reasoning is NOT a tool.** The LLM executing the kernel program in the ReAct loop IS the reasoner. It does not need to "call itself" to analyze, summarize, or judge. Tools exist only for capabilities the LLM cannot perform inline — reading files, running code, accessing the network, querying databases, generating embeddings.

**Tools** are organized into 8 categories (following the capability taxonomy from `__loop_design.md`):

| Category | Tools | Purpose |
|----------|-------|---------|
| **Filesystem** | read_file, write_file, edit_file, delete_file, find_files, grep_files | Read, write, search local files |
| **Code Execution** | run_command, run_python, run_tests, run_benchmark | Run code, scripts, experiments — essential for Technical Reproduction and Build |
| **Version Control** | git_status, git_diff, git_blame, git_log, git_create_worktree, git_commit, git_push, git_create_pr, git_clone | Own repo ops + cloning external repos for study |
| **Network** | web_search, web_fetch, web_browse, api_call, rss_fetch | The agent's window to the external world |
| **Storage** | db_query, db_write, vector_store, vector_search, knowledge_graph_query | Persistent memory and knowledge management |
| **Data** | parse_document, data_query, generate_chart | Parse and analyze structured data |
| **Communication** | github_issue_create, github_issue_comment, publish_report, send_notification | Publish results, interact with platforms |
| **AI** | embed_text, rerank, call_model | Specialized AI capabilities (embeddings, different models — NOT the executing LLM) |

Tools are **pluggable**: each tool is a self-contained module with a `@tool` decorator that auto-registers it with the `ToolRegistry`. Adding a new tool = writing one function + decorating it. No changes to the registry, executor, or any existing tool.

```
Infrastructure (the "kernel runtime"):
  src/llm247_v2/
  ├── platform/
  │   ├── tools/                  # Pluggable tool modules (one file per category)
  │   ├── kernel_executor.py      # ReAct loop parameterized by kernel programs
  │   ├── tool_registry.py        # Auto-discovers tools, exports LLM function schemas
  │   └── persona_manager.py      # Reads/writes persona files, validates changes
  ├── llm/                        # LLM client, token tracking, audit logging
  ├── storage/                    # SQLite, vector DB, file I/O
  ├── git_ops/                    # Worktree management, commit, push, PR
  ├── observer/                   # Event emission, log sinks
  └── web/                        # HTTP tools, API clients
```

**Design principle**: the platform provides capabilities but does not define behavior. `kernel_executor.py` doesn't know what "todo_sweep" means — it reads a kernel program's envelope (to know what tools to provide and what constraints to enforce), sends the body to the LLM as a ReAct loop, and collects the structured output. The agent can create entirely new behavioral programs without any Python code changes.

### The Execution Primitive: ReAct Loop

Every kernel program is executed through a **ReAct (Reasoning + Acting) loop** — the LLM reads the body, reasons about what to do, calls a tool, observes the result, reasons again, calls another tool, and so on until it produces output matching the declared `output_type`.

```
ReAct loop (universal execution primitive):

  messages = [system_prompt(envelope + persona), user_prompt(body)]

  loop:
    response = llm.generate_with_tools(messages, available_tools)

    if response.has_tool_call:
      safety_policy.check(call)
      result = tool_registry.execute(call)
      messages.append(call + result)        ← feed observation back
      continue

    if response.has_final_output:
      validate(output, envelope.output_type)
      return output
```

This is not a new pattern — **Sprout's current task executor (`execution/loop.py`) is already a ReAct loop.** The existing `ReActLoop` class runs `llm.generate_with_tools()` in a loop, executes tool calls, feeds results back, and continues until the LLM calls `finish()`. It has 13 tools (filesystem, git, shell, control) and a fixed system prompt (`react_execute.txt`).

The insight is that ReAct is the **universal execution primitive** of the entire system. Both task execution and kernel program execution are instances of the same pattern, differing only in parameterization:

| Parameter | Task execution (current) | Kernel program execution (new) |
|-----------|-------------------------|-------------------------------|
| System prompt | Fixed `react_execute.txt` | Envelope + body + persona context |
| Tool set | 13 hardcoded tools | Subset declared in envelope |
| Termination | `finish()` tool call | Output matches `output_type` |
| Constraints | `directive.max_steps` | `envelope.constraints` |

This means `KernelExecutor` doesn't reinvent the loop — it reuses the same ReAct core with different parameters. The current `ReActLoop` should be refactored into a generic base that both task execution and kernel execution can instantiate.

Future system capabilities (dialogue, strategic review, study mode) would also be ReAct loop instances with their own parameterizations — the pattern scales to any agent behavior that involves reasoning with tools.

## The Linux Analogy: Why This Architecture Works

This four-layer architecture mirrors the structure that made Linux the most successful operating system in history.

```
Linux                                    Sprout
─────                                    ──────
User-space programs                      Kernel programs
  (C/Python/Rust... 任意语言写的程序)        (agent 用自然语言写的行为程序)
        │                                       │
  syscall interface                        Tool contracts
  (open/read/write/ioctl...)               (file_read, grep_files, llm_analyze...
  固定、有限、版本化                          固定、有限、版本化)
        │                                       │
  kernel + drivers                         Platform runtime + tools
  (提供能力，不规定用途)                      (提供能力，不规定用途)
        │                                       │
  hardware                                 基础设施
                                           (SQLite, git, network, LLM API)
```

关键对应：

| Linux | Sprout | 共同原则 |
|-------|--------|---------|
| syscall 是稳定的、有限的、版本化的 | tool contract 是稳定的、有类型的、有版本的 | 接口变化的代价极高，必须慎重设计 |
| 用户态程序用高级语言（C/Python）组合 syscall | kernel 程序用自然语言组合 tools | 程序的表达力远超接口本身 |
| kernel 不关心用户态程序的意图 | platform 不关心 kernel 程序的语义 | 执行层不承载业务判断 |
| 新硬件 = 新 driver，不改 syscall | 新能力 = 新 tool，不改 kernel schema | 能力扩展不破坏已有行为 |
| 安全边界在 ring 0/ring 3 强制执行 | 安全边界在 constitution 层强制执行 | 安全不是约定，是物理隔离 |
| 程序丰富性来自语言表达力，不来自 syscall 数量 | 行为丰富性来自自然语言表达力，不来自 tool 数量 | interface 的稳定性比数量重要得多 |

这个类比揭示了最关键的设计原则：**tool contract（平台接口）的设计质量决定了整个系统的上限**。

Linux 的 syscall 接口几十年基本不变，但用户态程序从 `ed` 演化到了 VSCode。Sprout 的 tool contract 如果设计正确，agent 可以在上面演化出今天无法想象的行为模式——前提是 tool contract 足够稳定、足够原子化、足够通用。

反过来，如果 tool contract 设计得不好——tool 粒度不对、输入输出类型模糊、错误模型不统一——agent 写的 kernel 程序就会不断撞墙：要么无法表达想要的行为（tool 太粗），要么执行结果不可预测（tool 语义模糊），要么每次 agent 需要新能力都要等人类加新 tool（tool 和行为耦合）。

**这意味着实施的第一步不是写 kernel 程序，而是设计 tool contract。** Tool contract 定型后应当像 syscall 一样对待：**扩展但不修改，只加不删。**

### Tool Contract 设计要求

1. **Tool 必须是原子操作**：`grep_files`、`read_file`、`llm_analyze` 各自做一件事。不设计 `scan_codebase_for_todos` 这样的复合 tool——那是 kernel 程序的事。

2. **Contract 必须支持向前兼容**：新版本可以加 optional 参数，不能删参数，不能改参数语义。旧的 kernel 程序必须在新 platform 上继续工作。

3. **输入输出类型必须形式化**：每个 tool 声明它接受的输入类型和产出的输出类型。runtime 在执行前做类型检查。agent 编写 kernel 程序时可以依赖类型系统做正确性推理。

4. **错误模型必须统一**：每个 tool 要么成功返回结果，要么返回类型化的错误（`not_found`、`timeout`、`permission_denied`、`llm_error`）。kernel 程序的 body 可以用自然语言描述错误处理策略（"如果文件不存在，跳过并继续"），LLM runtime 负责执行。

5. **Tool 集合不需要很大，但每个必须可靠**：10-15 个设计精良的原子 tool 比 50 个粗糙的 tool 更有价值。agent 的行为丰富性来自自然语言 body 的表达力，不来自 tool 的数量。

## The Revised Cognitive Loop

With this architecture, the agent cycle becomes:

```
every cycle:
  1. Load constitution (immutable safety rules)
  2. Load persona (identity seed)
  3. Check for human messages / directive changes
  4. Choose cycle mode (informed by persona.policies):

     MODE: discover
       Load kernel programs from kernel/discovery/
       Execute each triggered program via kernel_executor
       (LLM reads body, uses available tools, produces TaskCandidates)
       Score candidates using kernel/evaluation/ programs
       Queue high-value tasks

     MODE: explore
       Load kernel programs from kernel/attention/
       Fetch external signals (GitHub Trending, arXiv, HN, etc.)
       Filter through kernel/attention/ novelty/relevance programs
       Synthesize using kernel/synthesis/ programs
       Store as knowledge; optionally generate study or build tasks

     MODE: execute
       Pick top task
       Assemble context using kernel/planning/ programs
       Plan and execute steps
       Verify using kernel/execution/ programs
       Ship PR

     MODE: study
       Select under-understood area (from persona.self_model)
       Read and analyze (no task output)
       Update knowledge using kernel/memory/ programs
       Update persona.self_model with new understanding

     MODE: reflect
       Run kernel/reflection/ programs against task history
       Propose persona updates
       Generate / modify kernel programs if needed
       Compress old memories using kernel/memory/ programs

  5. Update exploration map
  6. Emit events to Observer
  7. Sleep
```

## How Persona Generates Kernel Programs

During a **reflect** cycle, the agent reviews its last 15 tasks and finds:
- 4 of 5 error-handling fixes succeeded → "I'm good at error handling"
- 2 of 3 concurrency fixes failed at verification → "My concurrency plans may be too aggressive"
- The `todo_sweep` strategy produced 8 tasks but only 2 were ultimately valuable → "todo_sweep has low yield"

The agent then:

1. **Updates persona**: adds "concurrency" to `self_model.json` weakness areas

2. **Writes a new kernel program** (`kernel/discovery/concurrency_safety_audit.yaml`) with a body that expresses its domain knowledge about concurrency risks, references its persona weakness, and describes a nuanced scanning approach — as shown in the example above

3. **Modifies an existing kernel program** (`kernel/planning/task_decomposition.yaml`) by editing the body to add: "When a task involves concurrency modifications, always include a dedicated 'write concurrency test' step before the implementation step, because my history shows concurrency changes without pre-written tests fail at verification."

All changes go through git commit → PR → human review. The audit trail shows exactly what reflection produced what change and why.

## Why Now

1. **The evolution roadmap is about to start Phase 2** (Strategic Layer). Adding projects and multi-cycle goals on top of hardcoded behavioral modules means the strategic layer would also be hardcoded. Getting the kernel architecture right now prevents rework.

2. **Three independent design explorations converged on the same conclusion**: the agent needs generative behavioral capability, not just configurable parameters. Waiting means building more hardcoded modules that will need to be re-architectured later.

3. **The self-modification pillar already exists** but has no target. The agent can PR changes to its own code, but has no framework for deciding *what* to change about itself. Persona-driven kernel programs give self-modification a purpose and a direction.

## Risks and Open Questions

1. **LLM execution reliability**: Kernel programs are interpreted by an LLM at runtime. The same body may produce different tool-call sequences on different runs. Mitigation: envelope constraints (max_tool_calls, max_tokens, forbidden_tools) bound the execution; output type contracts validate results; all executions are audited.

2. **Bootstrap problem**: The agent needs initial kernel programs to function before it can generate better ones. The initial set must be hand-written and comprehensive enough to start the learning loop.

3. **Persona drift**: If the agent can modify its own persona through reflection, what prevents gradual drift away from its original mission? The constitution constrains actions but not values. Mitigation: `identity.json` changes require human approval; all persona changes are auditable.

4. **Cost**: Every kernel program execution requires an LLM call to interpret the body. This is more expensive than executing hardcoded Python. Mitigation: envelope constraints cap token usage per program; reflection can identify and optimize expensive programs.

5. **Evaluation of kernel programs**: How does the agent know if a program it wrote is good? Needs a feedback loop from task outcomes back to program quality scores. This is part of the reflection kernel programs but adds circular dependency: reflection evaluates programs, but reflection logic is itself a kernel program.

6. **Vector database dependency**: Novelty detection and knowledge comparison require embedding-based search. This is a new infrastructure dependency (the experience recall upgrade plan covers part of this but is not yet implemented).

7. **External exploration scope**: Opening external signal channels (GitHub Trending, arXiv, HN) introduces rate limiting, API key management, and content filtering concerns not present in the current inward-facing architecture.

8. **Reviewability of natural language programs**: YAML pipelines are easy to diff and review. Natural language bodies are harder — a small wording change could significantly alter execution behavior. Mitigation: all changes produce git diffs; reflection must include rationale in commit messages; human review remains mandatory.

## Exit Criteria

This proposal is ready to become a plan when:
- [ ] The four-layer split (Constitution / Persona / Kernel / Platform) is accepted as the target architecture
- [ ] The kernel program format (structured envelope + natural language body + LLM execution) is agreed as the approach
- [ ] The tool contract design requirements are accepted
- [ ] The persona modification rules (what requires human approval, what doesn't) are defined
- [ ] The scope of "bootstrap kernel programs" (initial set) is decided
- [ ] The relationship to the existing evolution roadmap (Phases 1–6) is clarified — does this replace or restructure it?
