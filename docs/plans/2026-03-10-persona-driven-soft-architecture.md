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

Capability-level self-bootstrapping via module artifacts is specified separately in [2026-03-11-evolvable-module-artifacts.md](2026-03-11-evolvable-module-artifacts.md).

---

## Storage Overview

The architecture introduces one new storage database — `agent_state.db` — containing both **persona storage** (the agent's identity and self-model as flat configurable rows) and **kernel storage** (the agent's behavioral programs and their lifecycle metadata). These two storage areas share the same DB and have a well-defined relationship that drives the persona → kernel influence mechanism.

### Persona Storage

Persona is stored as flat rows in `agent_state.db` (`persona_state` table). Each configurable item is an individual row with a category-prefixed key (e.g. `values.tradeoff.risk_tolerance`, `policies.cycle_mode.execute`). See [2026-03-10-persona-model-and-bootstrap.md](2026-03-10-persona-model-and-bootstrap.md) for the full field catalogue and schema.

The family-level persona consumption boundary is defined separately in [2026-03-10-persona-kernel-family-matrix.md](2026-03-10-persona-kernel-family-matrix.md).

Every `PersonaManager.write()` produces a `persona_change_events` record (also in `agent_state.db`), which queues a kernel review on the next reflect cycle.

### Kernel Storage

Kernel programs have two representations:

- **YAML files** in `.llm247_v2/kernel/` — the executable programs (what `KernelExecutor` reads)
- **Records in `agent_state.db`** — lifecycle metadata and evolution history (what the reflection loop reads)

```
.llm247_v2/
├── kernel/                       ← executable kernel programs (YAML)
│   ├── discovery/                  programs that generate task candidates
│   ├── evaluation/                 programs that score and rank candidates
│   ├── planning/                   programs that decompose tasks into steps
│   ├── attention/                  programs that monitor external signals
│   └── reflection/                 programs that analyze performance and propose changes
└── agent_state.db                ← persona_state + persona_change_events
                                     + kernel lifecycle + execution + evolution
```

**Memory** is not a kernel program type — it is a platform service:
- **Memory**: a platform service (`MemoryService`) called automatically after every task completes; deterministic extraction, not LLM-per-run

**Reflection** is a kernel program type, but with a split architecture:
- **`ReflectionCore`** (fixed Python infrastructure): schedules reflection programs, runs them via `KernelExecutor`, routes `ReflectionInsight` outputs to `PersonaUpdatePipeline` and `KernelMutationPlanner`
- **`kernel/reflection/*.yaml`** (agent-written, evolvable): the actual analysis logic; reads persona params (`values.growth_value`, `self_model.weaknesses`, `values.risk_tolerance`) and queries `agent_state.db`; can be modified by the agent as the persona evolves
- **Fallback**: if `kernel/reflection/` is empty, `ReflectionCore` runs a built-in minimal analysis (SQL-only, no LLM)
- **Anti-recursion rule**: reflection programs cannot propose mutations to other reflection programs; only `discovery`, `evaluation`, `planning`, and `attention` programs can be mutated by reflection

### Entity Relationships

All tables live in `agent_state.db`.

```
agent_state.db
──────────────────────────────────────────────────────────

persona_state                    persona_change_events
(key, category,    ────────────► (key, category,
 value, value_type,               old_value, new_value,
 editable_by)                     source, reviewed_at)
                                       │
                                       │ consumed by kernel_review
                                       ▼
kernel YAML files                kernel_programs
─────────────────                (id, name, type, status,
discovery/*.yaml ───────────────► created_by, quality_score,
evaluation/*.yaml                  current_version)
planning/*.yaml                        │
attention/*.yaml                       │ 1:many
                 ◄──────────────       ▼
                                 kernel_executions
                                (program_id, version,
                                  cycle_number, status,
                                  tokens_consumed,
                                  output_summary)
                                       │
                                       │ 1:many
                                       ▼
                                 kernel_task_links
                                (kernel_execution_id,
                                  task_id, task_status,
                                  task_value_score)

kernel_programs ──────────────── kernel_mutations
                   1:many        (program_id, version_before,
                                  version_after, mutation_type,
                                  mutation_source,
                                  trigger_insight,
                                  quality_before, quality_after)
```

### Key Relationships Explained

| Relationship | Cardinality | Meaning |
|---|---|---|
| persona_state → persona_change_events | 1:many | Every persona write is logged; events queue kernel review |
| kernel YAML ↔ kernel_programs | 1:1 | YAML is the executable; DB record is the metadata |
| kernel_programs → kernel_executions | 1:many | Every run of a program is recorded |
| kernel_executions → kernel_task_links | 1:many | Maps execution outputs to downstream task outcomes |
| kernel_programs → kernel_mutations | 1:many | Full history of every body rewrite, constraint change, or retirement |
| persona_change_events → kernel_mutations | 0:many | A persona change may produce zero or more kernel mutations via review |

### What Writes to Each Store

| Writer | Tables | When |
|---|---|---|
| `bootstrap.py` | `persona_state` (seed rows) + all kernel table schemas | Once, at initialization |
| `initial_kernel_generation()` | kernel YAML files + `kernel_programs` | Once, first `AgentRuntime.start()` after bootstrap (empty kernel_programs) |
| `PersonaManager.write()` | `persona_state` + `persona_change_events` | On any persona change |
| `KernelExecutor.run()` | `kernel_executions` | Every kernel program execution |
| `KernelRegistry.link_task()` | `kernel_task_links` | When a task generated by a kernel program completes |
| `MemoryService` (platform) | experience store (separate) | After every task completes |
| `ReflectionCore` (routes reflection program outputs) | `kernel_mutations` + kernel YAML + `persona_state` | On each reflection cycle |
| `ReflectionCore` (routes reflection program outputs) | `kernel_programs.quality_score` | On each reflection cycle |

---

## Phase 1: Platform Tools + Kernel Runtime + Bootstrap

**Goal**: Design the tool contracts, build the kernel executor, establish the persona and kernel storage models, and initialize the system with seed data — persona identity files and an initial set of kernel programs authored by humans. This is a brand-new architecture, not a migration.

**Critical priority**: The first deliverable is the **tool contract design** — not kernel programs, not persona files. Tool contracts are the syscall interface of this architecture. They must be right before anything is built on top. Get the tools wrong and every kernel program needs rewriting.

### 1.0 Tool Contract Design (prerequisite — separate plan)

**Extracted to [2026-03-10-platform-tool-contracts.md](2026-03-10-platform-tool-contracts.md).**

Tool contracts are the syscall interface of this architecture. They must be designed, reviewed, and locked before kernel programs or the executor are built. The tool plan covers: 8-category taxonomy (~35 tools), pluggable `@tool` decorator architecture, `ToolRegistry` auto-discovery, typed I/O and error model, and P0/P1/P2 implementation phasing.

**Review gate**: tool taxonomy and contract design must be reviewed before proceeding to 1.1.

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

    2. Build system prompt (implements Path A: Runtime Binding —
       see "Persona → Kernel Influence Mechanism" section):
       a. Scan program.body for all `persona.X.Y` references
       b. Resolve referenced values from PersonaManager (real-time read)
       c. Assemble prompt:

       "You are executing a kernel program for agent {persona.identity.name}.
        Your role: {persona.identity.role}
        Your objective: {persona.values.core_objective}

        ## Your Persona Context
        {resolved persona values for all references found in body}

        Available tools: {filtered_tool_schemas}

        Constraints:
        - Max tool calls: {envelope.constraints.max_tool_calls}
        - Max tokens: {envelope.constraints.max_tokens}

        Your output MUST conform to: {envelope.output_type}
        When you have produced the final output, call the finish() tool
        with the structured result."

    3. User prompt = program.body (unchanged — persona values are in system prompt)

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

### 1.2 Persona Data Model and Bootstrap (separate plan)

**Extracted to [2026-03-10-persona-model-and-bootstrap.md](2026-03-10-persona-model-and-bootstrap.md).**

Covers: `persona_state` flat-row schema (29 fields, `allowed_values` for enum fields), `persona_change_events` table, `PersonaManager` (read/write with type validation + identity guard), `bootstrap.py` (`CREATE TABLE IF NOT EXISTS` + `INSERT OR IGNORE` — fully idempotent, partial-init safe).

**Does not cover**: `initial_kernel_generation()` and `DiscoveryPipeline` — these depend on `KernelSchema` and Path C, which are part of this plan. They are specified in section 1.3 below.

**Review gate**: persona model and bootstrap must be reviewed before proceeding.

### 1.3 Initial Kernel Generation and Discovery Pipeline

After bootstrap, `kernel_programs` is empty. Before the first normal cycle, the agent generates its initial kernel programs from persona via Path C.

**Kernel types** (type name = directory name — no mapping needed):

| type | Directory | Example `kernel_programs.id` | Evolvable? |
|---|---|---|---|
| `discovery` | `kernel/discovery/` | `discovery/todo_sweep` | Yes |
| `evaluation` | `kernel/evaluation/` | `evaluation/task_scorer` | Yes |
| `planning` | `kernel/planning/` | `planning/task_decomposition` | Yes |
| `attention` | `kernel/attention/` | `attention/github_trending_monitor` | Yes |
| `reflection` | `kernel/reflection/` | `reflection/failure_pattern_analysis` | Yes (by `ReflectionCore` only; cannot self-modify) |

`kernel_programs.id` = `<type>/<name>`. `KernelRegistry` reads/writes `kernel/<type>/<name>.yaml` directly — no translation.

**Detection**: `AgentRuntime.start()` checks `SELECT COUNT(*) FROM kernel_programs WHERE status = 'active'` — if zero, calls `initial_kernel_generation()` before the first cycle.

```
initial_kernel_generation():
  1. persona = PersonaManager.read_all()
  2. For each required type [discovery, evaluation, reflection]:
       a. Call Path C generation with full persona context (see "Path C" section)
       b. KernelSchema.validate(generated_program)
       c. Write YAML to .llm247_v2/kernel/<type>/<name>.yaml
       d. INSERT into kernel_programs (id="<type>/<name>", created_by="agent")
  3. Emit kernel_generated events to Observer
```

Note: `reflection` programs are generated at bootstrap so the agent immediately has analysis logic shaped by its persona (e.g. `values.growth_value` determines how aggressively to seek improvements). The `ReflectionCore` scheduler runs these programs; it does not write its own analysis logic.

**DiscoveryPipeline**: loads all `kernel/discovery/*.yaml` programs and runs each via `KernelExecutor`.

### Phase 1 Deliverables

- [ ] Tool contract design reviewed and locked (see [platform-tool-contracts plan](2026-03-10-platform-tool-contracts.md))
- [ ] Persona model and bootstrap complete (see [persona-model-and-bootstrap plan](2026-03-10-persona-model-and-bootstrap.md))
- [ ] `KernelExecutor` with constraint enforcement and audit logging
- [ ] `KernelSchema`: envelope validation; types are `discovery | evaluation | planning | attention | reflection`; `id = <type>/<name>`
- [ ] `KernelRegistry`: reads/writes `kernel/<type>/<name>.yaml` directly; no type→directory mapping needed
- [ ] Path A implementation: persona reference scanner + runtime value injection into system prompt
- [ ] `initial_kernel_generation()`: empty-kernel detection in `AgentRuntime.start()`, Path C generation, schema validation
- [ ] `DiscoveryPipeline`: loads from `kernel/discovery/`, runs via `KernelExecutor`
- [ ] Tests: executor constraint enforcement, output validation, safety boundaries, execution recording, Path A persona injection, second start skips generation

---

## Phase 2: External Exploration + Attention Kernel

**Goal**: Open external signal channels and build attention kernel programs that connect persona interests to external information.

### 2.1 Attention Kernel Programs

Kernel program type: `attention` — programs that fetch external signals and filter them for novelty.

**Example** — `kernel/attention/github_trending_monitor.yaml`:

```yaml
schema_version: 1
type: attention
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
  created_by: agent
  created_at: "2026-03-10"
  quality_score: null
```

**Example signal sources** the agent might generate given appropriate persona interests: GitHub Trending, HackerNews Top, arXiv recent.

### 2.2 Novelty Filter Kernel Program

```yaml
schema_version: 1
type: attention
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
  created_by: agent
  created_at: "2026-03-10"
  quality_score: null
```

### 2.3 Explore Cycle Mode

New cycle mode integrated into the agent loop.

```
explore mode:
  1. KernelExecutor runs each triggered attention program with trigger=interval
  2. Collected signals pass through attention programs with trigger=on_signals (novelty filter)
  3. Surviving signals are routed:
     a. suggested_action == "study" → queue study task
     b. suggested_action == "reproduce" → queue discovery candidate
     c. suggested_action == "note" → MemoryService.store(signal)
  4. Update exploration map with external scan record
```

#### Implementation

- New tool: credential store access for API keys (`.llm247_v2/credentials/`, gitignored)
- Rate limiting middleware in `api_call` and `web_fetch` tools
- `explore` cycle mode in agent loop, reading `policies.cycle_mode.*` weights from `PersonaManager`
- Persona-driven cycle mode selection replaces fixed discover→execute

### Phase 2 Deliverables

- [ ] Agent generates `attention` kernel programs on first explore cycle (via Path C, from persona.attention)
- [ ] Credential store for API keys
- [ ] Rate limiting for external API tools
- [ ] `explore` cycle mode in agent loop
- [ ] Persona-driven cycle mode selection
- [ ] Tests: signal source execution, novelty filtering, cycle mode routing

---

## Phase 3: Reflection Loop + Persona Evolution

**Goal**: Build `ReflectionCore` — a fixed Python scheduler that runs `kernel/reflection/*.yaml` programs via `KernelExecutor`, routes their outputs to `PersonaUpdatePipeline` and `KernelMutationPlanner`, and drives persona updates and kernel mutations.

**Architecture — split between fixed infrastructure and evolvable programs**:

| Layer | What it is | Who writes it | Can it evolve? |
|---|---|---|---|
| `ReflectionCore` | Fixed Python class; schedules + runs reflection programs; routes outputs | Engineers | No (fixed code) |
| `kernel/reflection/*.yaml` | Kernel programs; contain the actual analysis logic | Agent (via Path C at bootstrap, then self-modified) | Yes — but only by `ReflectionCore`, not by other reflection programs |

**Why this split**: a fully fixed `ReflectionRunner` cannot adapt to persona changes (e.g. if `values.growth_value` shifts to "ambitious", reflection should probe more aggressively; if `self_model.weaknesses` changes, analysis queries should change). But making reflection fully free-form risks breaking the meta-loop. The split gives evolvability where it matters while keeping the execution harness stable.

### 3.1 ReflectionCore

`ReflectionCore` is fixed Python infrastructure. It does not contain analysis logic.

```python
class ReflectionCore:
    def run(self, cycle_number: int) -> ReflectionReport:
        programs = KernelRegistry.list(type="reflection", status="active")
        if not programs:
            # Fallback: built-in minimal analysis (SQL-only, no LLM, no persona influence)
            return self._builtin_minimal_analysis(cycle_number)

        all_insights = []
        for program in programs:
            result = KernelExecutor.run(program, context={
                "cycle_number": cycle_number,
                "persona": PersonaManager.read_all(),   # programs receive full persona
            })
            all_insights += OutputRouter.extract(result, ReflectionInsight)

        return ReflectionReport(insights=all_insights, cycle=cycle_number)
```

`ReflectionCore` runs every `policies.reflection_frequency_cycles` cycles. Each reflection program receives the full current persona as context, so analysis logic can be written in terms of persona parameters.

**Anti-recursion constraint**: `KernelExecutor` enforces that programs of type `reflection` cannot emit `ModifyKernelInsight` targeting other `reflection` programs. Violations are logged and dropped.

**Fallback** (`_builtin_minimal_analysis`): runs three hard-coded SQL queries (failure rate by task type, unprocessed `persona_change_events`, token outliers) and emits basic `ReflectionInsight` objects. No LLM call, no persona influence — guaranteed to produce some output even on a fresh install.

### 3.2 Reflection Kernel Programs

**Example** — `kernel/reflection/failure_pattern_analysis.yaml`:

```yaml
schema_version: 1
type: reflection
name: failure_pattern_analysis
description: Identify failure clusters and propose kernel mutations or persona updates

interface:
  trigger:
    every_n_cycles: 1          # runs every time ReflectionCore fires
  available_tools: [db_query]  # reflection programs only get read-only DB access
  output_type: List[ReflectionInsight]
  constraints:
    max_tool_calls: 10
    max_tokens: 6000

body: |
  Query kernel_executions for the last 20 cycles. Group by program type and status.
  Identify any program with failure rate > 0.4.

  For each failure cluster:
  - Check if the failure pattern matches a known weakness in persona.self_model.weaknesses
  - If yes: the failure is expected; propose a persona update to track improvement progress
  - If no: propose a kernel mutation (modify the failing program's constraints or body)

  Calibrate aggressiveness of proposed changes by persona.values.growth_value:
  - "ship_now": propose only constraint relaxations (faster to apply, lower risk)
  - "balanced": propose body rewrites for persistent failures (>3 cycles)
  - "meticulous": always propose body rewrite with full rationale

  Output one ReflectionInsight per identified cluster.

metadata:
  created_by: agent
  created_at: "2026-03-10"
  quality_score: null
  version: 1
```

**What reflection programs can do**:
- `db_query` (read-only): query `kernel_executions`, `kernel_task_links`, `kernel_mutations`, `persona_state`, `persona_change_events`
- Emit `ReflectionInsight(suggested_action=..., ...)` for routing by `ReflectionCore`

**What reflection programs cannot do**:
- Write to any table directly
- Call tools other than `db_query`
- Emit `ModifyKernelInsight` targeting type `reflection` (anti-recursion; enforced by `KernelExecutor`)

### 3.3 Persona Update Pipeline

`ReflectionCore` routes `update_persona` insights to `PersonaUpdatePipeline`:

```
ReflectionInsight(suggested_action="update_persona", key="self_model.weaknesses", detail="add concurrency")
        │
        ▼
  classify risk by key category:
    self_model.*   → auto-apply, log to Observer
    values.*, attention.*  → auto-apply, flag for human review in dashboard
    identity.*     → write to human message queue, do NOT apply
        │
        ▼
  PersonaManager.write(key, new_value, source="reflection/failure_pattern_analysis")
    → persona_state updated
    → persona_change_events row inserted (Path B trigger)
```

### 3.4 Kernel Program Mutation (Path B + Path C)

`ReflectionCore` routes `modify_kernel` and `create_kernel` insights to `KernelMutationPlanner`:

**Path B — existing program body invalidated by persona change**:
```
reflection program emits:
  ReflectionInsight(suggested_action="modify_kernel", program_id="discovery/todo_sweep",
                    rationale="persona.values.risk_tolerance changed to careful; current
                               max_tool_calls=5 is too low for careful verification")
        │
        ▼
KernelMutationPlanner.modify(program, insight):
  LLM rewrites affected body sections
  KernelSchema.validate(new_program)
  Write updated YAML + record kernel_mutation + mark persona_change_event reviewed
  Flag for human review
```

**Path C — new program needed**:
```
reflection program emits:
  ReflectionInsight(suggested_action="create_kernel", type="discovery", rationale="...")
        │
        ▼
KernelMutationPlanner.create(type, insight):
  Call Path C generation (see "Path C" section)
  KernelSchema.validate + write YAML + record kernel_mutation
  Flag for human review
```

### Phase 3 Deliverables

- [ ] `ReflectionCore`: scheduler + `KernelExecutor` dispatch + fallback minimal analysis + anti-recursion enforcement
- [ ] Initial `kernel/reflection/failure_pattern_analysis.yaml` (human-authored seed program)
- [ ] Initial `kernel/reflection/persona_coverage_check.yaml` (scans `persona_change_events` for unreviewed kernel impact — Path B trigger)
- [ ] `PersonaUpdatePipeline` with risk classification per persona key category
- [ ] `KernelMutationPlanner`: Path B (body rewrite when persona change invalidates logic) + Path C (new program creation)
- [ ] Path B: `persona_change_events` consumption — scanner + mutation decision + `reviewed_at` update
- [ ] Path C: generation prompt construction + `KernelSchema.validate()` + `kernel_mutations` record + human review flag
- [ ] `kernel_task_links` population: link kernel executions to downstream task outcomes
- [ ] `reflect` cycle mode in agent loop
- [ ] Dashboard: persona change history + kernel mutation timeline
- [ ] Tests: reflection program executes via `KernelExecutor`, fallback triggers when `kernel/reflection/` is empty, anti-recursion blocks self-modification, persona update risk classification, Path B end-to-end, Path C generation produces valid programs

---

## Phase 4: Planning Kernel Programs + MemoryService

**Goal**: Replace the fixed `plan_task.txt` prompt with evolvable `planning` kernel programs, and build `MemoryService` as a platform component for experience extraction.

**Memory is a platform service, not a kernel program**: experience extraction runs automatically after every task and must be reliable. Making it an agent-written kernel program introduces fragility at the point where the system is most vulnerable — immediately after a task fails.

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
  created_by: agent
  created_at: "2026-03-10"
  quality_score: null
```

### 4.2 MemoryService (platform component)

`MemoryService` is called by `AgentRuntime` after every task completes. It uses a fixed LLM prompt (not an agent-written kernel program) to extract experience entries and write them to the experience store.

```python
class MemoryService:
    def on_task_complete(self, task: CompletedTask) -> list[ExperienceEntry]:
        # Fixed prompt: extract learnings, deduplicate via vector_search,
        # categorize as Technique / Pitfall / Pattern / Insight
        # Write to experience store with embedding
        ...
```

**What it uses from persona** (read directly via `PersonaManager`, not via kernel body references):
- `values.growth_value` → prioritize failures and near-misses when high
- `values.risk_tolerance` → prioritize pitfalls and safety lessons when low

### Phase 4 Deliverables

- [ ] `planning` kernel programs (task decomposition, context assembly) — agent-written, evolvable
- [ ] `MemoryService`: platform component called after every task; fixed extraction logic; vector deduplication
- [ ] Reflection kernel programs can query experience store for pattern analysis (built on MemoryService output)
- [ ] Tests: planning program produces valid TaskPlan, MemoryService deduplicates correctly, experience entries are queryable by reflection programs

---

## Kernel Program Storage & Evolution Tracing

Kernel programs are not static files — they are living artifacts that the agent creates, modifies, evaluates, and sometimes retires. The system needs a "meta-memory" that tracks the full lifecycle of each kernel program: why it was created, how it has changed, how well it performs, and what led to each modification. This is the agent's self-awareness about its own operating system.

### Storage Model

Each kernel program has two representations:

1. **The YAML file** in `.llm247_v2/kernel/` — the current executable version (what the KernelExecutor reads)
2. **A record in `agent_state.db`** — the lifecycle metadata, execution history, and evolution trace (what the reflection loop reads)

```
.llm247_v2/
├── kernel/                          # executable kernel programs (YAML files)
│   ├── discovery/
│   ├── evaluation/
│   ├── ...
└── agent_state.db               # SQLite: lifecycle + execution + evolution metadata
```

### Schema: `agent_state.db`

```sql
-- Every kernel program ever created (including disabled/deleted ones)
CREATE TABLE kernel_programs (
    id              TEXT PRIMARY KEY,    -- e.g. "discovery/todo_sweep"
    name            TEXT NOT NULL,
    type            TEXT NOT NULL,       -- "discovery" | "evaluation" | "planning" | "attention" | "reflection"
    status          TEXT NOT NULL,       -- "active", "disabled", "retired", "replaced"
    created_by      TEXT NOT NULL,       -- "agent" (all kernel programs are agent-generated)
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
    mutation_source TEXT NOT NULL,       -- "reflection/<analysis_name>", "initial_generation", "human_directive"
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

-- persona_change_events schema: see persona-model-and-bootstrap plan
-- key references persona_state.key; category is denormalized for fast filtering
-- PersonaManager writes; kernel_review.yaml reads and processes
-- (see "Persona → Kernel Influence Mechanism", Path B)
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

### How Reflection Programs Use This Data

Reflection kernel programs query `agent_state.db` via the `db_query` tool to assess kernel health. The SQL below shows examples of what a `kernel/reflection/*.yaml` program might run:

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
  reflection program detects coverage gap → emits ReflectionInsight → ReflectionCore routes to KernelMutationPlanner → creates kernel/discovery/concurrency_safety_audit.yaml
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

## Persona → Kernel Influence Mechanism

Persona is the "seed" from which kernel programs grow. But the seed-to-program causation needs an explicit, well-defined mechanism. There are three distinct influence paths, each solving a different problem.

### Path A: Runtime Binding (parameter-level, automatic)

Kernel program bodies reference persona values using `persona.X.Y` notation (e.g., `persona.attention.domain_interests`, `persona.values.growth_value`). These references are **not** baked into the body text — they are resolved dynamically each time the KernelExecutor runs the program.

**Mechanism**:

```
KernelExecutor.run(program, persona):

  1. Scan body text for persona references:
     Extract all `persona.X.Y` patterns from the body
     → e.g. ["persona.attention.domain_interests",
             "persona.values.growth_value",
             "persona.self_model.weaknesses"]

  2. Read referenced values from PersonaManager:
     {
       "persona.attention.domain_interests": [
         {"topic": "concurrency", "weight": 0.8},
         {"topic": "security", "weight": 0.6}
       ],
       "persona.values.growth_value": 0.6,
       "persona.self_model.weaknesses": ["concurrency", "large refactors"]
     }

  3. Build system prompt with persona context section:
     "## Your Persona Context
      The following persona values are referenced in this program:

      persona.attention.domain_interests:
        - concurrency (weight: 0.8)
        - security (weight: 0.6)

      persona.values.growth_value: 0.6

      persona.self_model.weaknesses:
        - concurrency
        - large refactors

      Use these values when the program body references them."

  4. Final prompt assembly:
     system_prompt = persona context + envelope constraints + tool schemas
     user_prompt   = program body (unchanged)
```

**Design decisions**:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Where persona values are injected | Dedicated section in system prompt | Body stays immutable; persona values provided as context for LLM interpretation |
| How references are resolved | Text scan for `persona.X.Y` pattern | Simple, reliable, no template engine needed |
| Unreferenced persona fields | Not injected | Prevents context bloat; only fields the body actually uses are loaded |
| When persona is read | Every execution, real-time from PersonaManager | Always uses latest persona values |

**Effect**: When `persona.values.exploration_vs_exploitation` changes from 0.5 to 0.8, every kernel program referencing that field **requires no modification** — KernelExecutor automatically injects the new value on next execution, and the LLM adjusts its reasoning accordingly.

**Limitation**: Runtime binding only propagates **parameter-level** changes. If a persona change invalidates the **logical assumptions** in a body (e.g., "concurrency" removed from weaknesses but the body says "because my self_model identifies concurrency as a weakness"), the body needs rewriting. That's Path B.

### Path B: Persona-Triggered Kernel Review (structural, via reflection)

The correct abstraction is **not** "persona change → find matching programs → create per-program reviews." That approach has two fatal flaws:

1. **Missing diff context**: the review logic needs old_value/new_value to reason about impact, not just a field name
2. **Creation blind spot**: if a new attention area is added, no existing program references it, so no review is created — and no new program generation is triggered

The correct abstraction is:

```
persona change → persist change event (with full diff) → kernel review system decides
```

Persona is the upstream driver; the kernel is the downstream, reviewable evolution layer. The review system has full agency to update existing programs, create new ones, or take no action.

**Mechanism**:

```
[1] PersonaManager.write(key, new_value, source):
    1. Load old_value from persona_state WHERE key = key
    2. Persist the change event (in same transaction as the persona update):
       INSERT INTO persona_change_events (key, category, old_value, new_value, created_at, source)
       category = persona_state.category for this key
    3. UPDATE persona_state SET value = new_value, updated_at, updated_by
    4. Emit persona_changed event to Observer

    NOTE: PersonaManager does NOT query kernel_programs, does NOT decide
    which programs are affected. It only records what changed and why.

[2] Next reflect cycle — kernel_review.yaml runs:
    1. Query unprocessed persona change events:
       SELECT * FROM persona_change_events WHERE reviewed_at IS NULL

    2. For each change event, the review program (an LLM in a ReAct loop) reasons about impact:

       a. Scan existing kernel programs for references to the changed key
          → Are there programs whose body logic depends on this value?
          → For each: does runtime binding (Path A) handle this, or is the
            body's logical structure invalidated?

       b. Scan for coverage gaps created by the change
          → Is this a new trait/interest/capability with no kernel program coverage?
          → Example: "distributed_systems" added to attention.domain_interests, but no
            discovery program covers distributed systems

       c. Scan for programs that are now redundant
          → Did a trait removal make a program's entire purpose obsolete?

    3. Based on assessment, take action:
       → update existing program body → kernel_mutation
       → create new program → kernel_mutation (via Path C generation prompt)
       → retire obsolete program → kernel_mutation
       → no action needed (runtime binding sufficient)

    4. Mark change event as processed:
       UPDATE persona_change_events SET reviewed_at = now(), review_outcome = '...'
```

**Why this is better than per-program matching**:

| Old design (program-centric) | New design (event-centric) |
|------------------------------|---------------------------|
| PersonaManager queries kernel_programs table | PersonaManager only records the change |
| Creates reviews only for programs referencing the changed field | Review system sees the full change and reasons about ALL programs + gaps |
| New traits with zero coverage → zero reviews → silent gap | New traits → change event → review system explicitly checks for coverage gaps |
| Review gets field name but no diff | Review gets full old_value/new_value context |
| PersonaManager coupled to kernel system | PersonaManager decoupled — clean upstream/downstream boundary |

**Concrete example — new trait (creation case)**:

```
persona.attention.domain_interests adds {"topic": "distributed_systems", "weight": 0.7}
  │
  ▼
PersonaManager persists change event:
  key: "attention.domain_interests"
  category: "attention"
  old_value: [{"topic": "concurrency", ...}, {"topic": "security", ...}]
  new_value: [{"topic": "concurrency", ...}, {"topic": "security", ...},
              {"topic": "distributed_systems", "weight": 0.7}]
  │
  ▼
Next reflect cycle — kernel_review.yaml runs:
  Reads change event: domain_interests gained "distributed_systems"
  Scans all active kernel programs:
    → No existing program references "distributed_systems"
    → No discovery program covers distributed systems topics
  Assessment: coverage gap — new high-weight interest with zero kernel coverage
  Action: propose creation of kernel/discovery/distributed_systems_scan.yaml
  → triggers Path C generation with this change event as creation context
  Review outcome: "creation_proposed"
```

**Concrete example — existing trait removed (mutation/retirement case)**:

```
persona.self_model.weaknesses removes "concurrency"
  │
  ▼
PersonaManager persists change event:
  key: "self_model.weaknesses"
  category: "self_model"
  old_value: ["concurrency", "large refactors"]
  new_value: ["large refactors"]
  │
  ▼
Next reflect cycle — kernel_review.yaml runs:
  Reads change event: weaknesses lost "concurrency"
  Scans all active kernel programs:

  For concurrency_safety_audit.yaml:
    Body says: "Because my self_model identifies concurrency as a weakness..."
    Logical premise is invalidated by the change.
    Proposal: rewrite body to remove weakness framing (keep audit
              functionality), OR retire if quality_score is low.
    → kernel_mutation(type="body_rewrite",
                      trigger_insight="persona.self_model.weaknesses removed 'concurrency'",
                      trigger_evidence="concurrency moved to strengths after 8/10 success rate")

  For task_decomposition.yaml:
    Body says: "When task involves concurrency, use test-first approach"
    Advice is still valid as best practice. Framing should update.
    → kernel_mutation(type="body_rewrite",
                      diff_summary="reframe concurrency test-first from weakness to best practice")

  Review outcome: "mutation_proposed" (2 programs affected)
```

**Schema** — `persona_change_events` table in `agent_state.db` (see full schema in [persona-model-and-bootstrap plan](2026-03-10-persona-model-and-bootstrap.md)):

```sql
CREATE TABLE persona_change_events (
    id             TEXT PRIMARY KEY,
    key            TEXT NOT NULL,    -- references persona_state.key, e.g. "attention.domain_interests"
    category       TEXT NOT NULL,    -- "identity" | "values" | "attention" | "policies" | "self_model"
    old_value      TEXT,             -- JSON-serialized previous value
    new_value      TEXT NOT NULL,    -- JSON-serialized new value
    created_at     TEXT NOT NULL,
    source         TEXT NOT NULL,    -- "bootstrap" | "reflection/<name>" | "human" | "directive"
    reviewed_at    TEXT,             -- filled when kernel_review.yaml processes this event
    review_outcome TEXT,             -- "no_action" | "mutation_proposed" | "creation_proposed" | "retirement_proposed"
    review_detail  TEXT              -- what the review decided and why
);
```

### Path C: Persona-Driven Kernel Generation (new programs)

When the agent creates a **new** kernel program (not modifying an existing one), persona acts as the full generative context. This is triggered by two sources:

1. **Reflection insight**: reflection discovers a gap ("I have no kernel program covering X")
2. **Kernel review** (Path B): a persona change event reveals a coverage gap (new trait with no program)

**Generation prompt construction**:

```
system prompt:
  "You are writing a new kernel program for agent {persona.identity.name}.

   ## Agent Identity
   {persona.identity — full content}

   ## Agent Values
   {persona.values — full content}

   ## Agent Self-Model
   {persona.self_model — full content}

   ## Agent Attention
   {persona.attention — full content}

   ## Kernel Program Schema
   Required envelope fields:
     schema_version: 1
     type: {target_type}
     name: <descriptive_name>
     description: <one-line purpose>
     interface:
       trigger: <when to run>
       available_tools: <subset of available tools>
       output_type: <what the program produces>
       constraints:
         max_tool_calls: <integer>
         max_tokens: <integer>
     body: |
       <natural language behavioral logic>
     metadata:
       created_by: agent
       created_at: {today}
       quality_score: null

   ## Available Tools
   {tool_registry.all_tools — names, descriptions, and I/O types}

   ## Program Type Requirements
   Programs of type '{target_type}' must produce output matching: {type_output_spec}

   ## Existing Programs of This Type (reference examples)
   {up to 3 existing kernel programs of the same type — full envelope + body}

   ## Body Writing Guidelines
   - Reference persona values using persona.X.Y format (these are resolved at runtime)
   - Express judgment and reasoning, not just tool call sequences
   - Include error handling in natural language ('if X is not found, skip and continue')
   - Set constraints based on average token consumption of similar programs
   - The body should be self-contained: another LLM reading it should understand
     what to do without needing external documentation"

user prompt:
  "## Creation Context
   {the reflection insight or persona change that triggered generation}

   ## Evidence
   {supporting data — failure cases, new interests, gap analysis}

   ## Requirement
   Write a {target_type} kernel program that addresses the above.
   Output the complete YAML (envelope + body)."
```

**Key design points**:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Persona injection scope | Full persona (all files) | Generation needs global context to make identity-coherent programs |
| Example programs | Up to 3 of the same type | Few-shot consistency without overwhelming context |
| Tool selection | Full registry provided, agent chooses subset | Agent picks tools relevant to the program's purpose |
| Output validation | KernelSchema.validate() before writing to disk | Catches malformed envelopes, invalid tool references, missing fields |
| Post-generation | git commit + flag for human review + kernel_mutation record | Full audit trail |

**Difference from runtime execution**: During runtime (Path A), only referenced persona fields are injected to minimize context. During generation, the **full persona** is injected because the agent needs holistic self-understanding to create a coherent new program — it must reason about "who am I and what do I need" rather than just "what does this specific field say."

### Summary: Three Paths, One Loop

```
┌──────────────────────────────────────────────────────────────┐
│                    Persona Changes                           │
│                         │                                    │
│         ┌───────────────┼───────────────┐                    │
│         ▼               ▼               ▼                    │
│    Path A:          Path B:         Path C:                  │
│    Runtime          Triggered       Driven                   │
│    Binding          Review          Generation               │
│                                                              │
│    persona param    any persona      reflection insight      │
│    changes          change           or Path B gap found     │
│         │               │                │                   │
│         ▼               ▼                ▼                   │
│    KernelExecutor   change event     LLM generates          │
│    injects new      persisted →      new kernel program      │
│    values into      kernel review    with full persona       │
│    system prompt    decides action   context                 │
│         │               │                │                   │
│         ▼               ▼                ▼                   │
│    Same body,       update/create/   KernelSchema            │
│    different        retire/no-op     validates               │
│    behavior         kernel_mutation                          │
│         │               │                │                   │
│         └───────────────┼────────────────┘                   │
│                         ▼                                    │
│               Kernel programs execute                        │
│               with updated behavior                          │
│                         │                                    │
│                         ▼                                    │
│               Execution outcomes feed back                   │
│               into reflection → persona updates              │
│                         │                                    │
│                         └──────────→ (loop)                  │
└──────────────────────────────────────────────────────────────┘
```

| Path | When | Modifies Body? | Latency | Automated? |
|------|------|---------------|---------|------------|
| A: Runtime Binding | Every execution | No | Zero — next execution sees new values | Fully automatic |
| B: Triggered Review | Any persona change → change event → kernel review decides | Yes (if needed) | Next reflect cycle | Semi-automatic (kernel review decides update/create/retire/no-op) |
| C: Driven Generation | Gap identified by reflection or by Path B kernel review | N/A (new program) | Next reflect cycle | Semi-automatic (reflection proposes, human reviews) |

---

## Testing Strategy

### Unit Tests
- Tool tests are in the [platform-tool-contracts plan](2026-03-10-platform-tool-contracts.md)
- KernelExecutor constraint enforcement: halts at max_tool_calls, max_tokens
- KernelExecutor output validation: rejects output that doesn't match output_type
- PersonaManager schema validation: rejects malformed updates
- Safety boundaries: executor respects SafetyPolicy even when kernel program body requests otherwise
- Path A: persona reference scanner correctly extracts all `persona.X.Y` patterns from body text
- Path A: KernelExecutor system prompt includes persona context section with correct resolved values
- Path A: unreferenced persona fields are NOT included in system prompt
- Path B: PersonaManager.write() persists `persona_change_events` with correct `key`, `category`, `old_value`, `new_value`
- Path B: change events with no matching review are surfaced as unprocessed
- Path C: generated kernel programs pass KernelSchema.validate()
- Path C: generation prompt includes full persona, tool registry, and example programs

### Integration Tests
- Full discovery cycle with kernel programs produces reasonable candidates
- Every kernel execution creates a record in `kernel_executions`
- Persona changes from reflection propagate correctly to subsequent kernel program executions
- Path A end-to-end: persona value change → same kernel program produces observably different behavior on next execution
- Path B end-to-end: persona change → change event persisted → kernel review processes event → mutation/creation/no-op recorded
- Path C end-to-end: reflection identifies gap → generation prompt constructed → valid kernel program produced → written to disk with mutation record
- External signal fetch + attention filter pipeline end-to-end
- Kernel program generation produces valid, executable programs AND creates `kernel_mutations` records
- `kernel_task_links` correctly associates kernel outputs with downstream task outcomes
- Reflection queries against `agent_state.db` produce actionable insights

### Safety Tests
- Kernel program cannot invoke tools not listed in its available_tools
- Kernel program cannot exceed constraint limits
- Persona identity changes without directive approval are rejected
- All kernel program modifications produce git diffs AND `kernel_mutations` records
- Retired kernel programs cannot be re-executed
- Path C: generated kernel programs cannot include tools not in tool_registry
- Path C: generated kernel programs cannot bypass constitution constraints

---

## Relationship to Existing Evolution Roadmap

The evolution roadmap in `docs/design/evolution.md` defines 6 phases. This plan restructures and subsumes them:

| Evolution Phase | Covered By | Notes |
|----------------|-----------|-------|
| Phase 1: Knowledge Memory | Plan Phase 4 (MemoryService + planning kernel programs) | Memory is a platform service; planning is a kernel program |
| Phase 2: Strategic Layer | Plan Phase 1 (persona policies + cycle modes) | Projects/goals are future work built on top of persona |
| Phase 3: Communication Layer | Not covered | Remains as future work; depends on persona + reflection |
| Phase 4: Reflection & Meta-Cognition | Plan Phase 3 | Implemented as ReflectionCore (fixed scheduler) + kernel/reflection/*.yaml (evolvable programs) + KernelMutationPlanner |
| Phase 5: Codebase Model | Plan Phase 4 (synthesis + study mode) | ModuleUnderstanding becomes part of persona.self_model |
| Phase 6: Dialogue Engine | Not covered | Remains as future work |

This plan provides the architectural foundation that makes future phases implementable without hardcoding each new capability — the agent can write new kernel programs for any new capability domain.
