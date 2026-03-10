# Kernel Runtime Design

> Status: Approved
> Created: 2026-03-11
> Completed:
> PR:
> Proposal: docs/proposals/2026-03-10-persona-driven-soft-architecture.md

---

## Overview

The **Kernel Runtime** is the orchestration layer between `AgentCycleLoop` and individual kernel programs. It owns four responsibilities:

1. **Scheduling** — which programs trigger this cycle?
2. **Sequencing** — in what order do triggered programs run?
3. **Error isolation** — one failing program does not abort the cycle
4. **Output routing** — typed outputs go to the correct downstream consumers

```
AgentCycleLoop
      │
      ▼
 KernelRuntime.run_cycle(cycle_number)
      │
      ├─ [1] resolve_triggered_programs()    ← check trigger conditions
      ├─ [2] sequence(triggered)             ← order by type dependency
      ├─ [3] execute_each(sequenced)         ← KernelExecutor per program
      └─ [4] OutputRouter.route(all_outputs) ← dispatch to consumers
```

---

## Component Map

```
src/llm247_v2/runtime/
├── kernel_runtime.py      ← KernelRuntime (this document)
├── kernel_executor.py     ← KernelExecutor (ReAct loop, see main plan §1.1)
├── output_router.py       ← OutputRouter
├── trigger_evaluator.py   ← TriggerEvaluator
└── cycle_scheduler.py     ← CycleScheduler (mode selection)
```

---

## 1. KernelRuntime

```python
class KernelRuntime:
    def run_cycle(self, cycle_number: int) -> CycleReport:
        # 1. Determine cycle mode (discover / explore / execute / reflect)
        mode = CycleScheduler.select_mode(cycle_number, persona, system_state)

        # 2. Collect programs to run this cycle
        triggered = TriggerEvaluator.resolve(cycle_number, mode, persona)

        # 3. Run in dependency order; isolate failures
        all_outputs = []
        for program in self._sequence(triggered):
            try:
                result = KernelExecutor.run(program, context={
                    "cycle_number": cycle_number,
                    "persona": PersonaManager.read_all(),
                    "mode": mode,
                })
                all_outputs.append(result)
            except KernelExecutionError as e:
                Observer.emit(kernel_failure_event(program, e))
                # continue — do not abort the cycle

        # 4. Route outputs to consumers
        OutputRouter.route(all_outputs, cycle_number)

        return CycleReport(cycle_number=cycle_number, mode=mode,
                           triggered=triggered, outputs=all_outputs)
```

### Execution Sequence

Programs run in this fixed type order within a cycle:

```
attention → discovery → evaluation → [task execution] → reflection
```

Rationale:
- `attention` first: ingest fresh external signals before generating candidates
- `discovery` second: use fresh signals to find tasks
- `evaluation` third: score and rank discovered candidates immediately
- task execution: the actual work (not a kernel program, managed by AgentCycleLoop)
- `reflection` last: analyze what happened this cycle before the next begins

`planning` is on-demand only — called during task execution, not by the runtime cycle.

### Error Isolation

Each program runs in a try/except. Failures are logged to `kernel_executions` with `status="failed"` and emitted to Observer. The cycle continues with remaining programs.

If ALL programs in a type fail, the runtime logs a `type_failure_event` and skips that type's output routing step (no partial outputs are routed).

---

## 2. TriggerEvaluator

Determines which programs fire on a given cycle.

### Trigger Types

| Trigger | Config in YAML | Fires when |
|---------|---------------|-----------|
| `interval_cycles` | `trigger: interval_cycles: N` | `cycle_number % N == 0` |
| `on_demand` | `trigger: on_demand` | Only when explicitly called (e.g. planning during task exec) |
| `every_reflect` | `trigger: every_n_cycles: 1` (in reflection programs) | Every time `ReflectionCore` fires |
| `conditional` | `trigger: condition: "pending_persona_changes > 0"` | Condition evaluates true against system state |
| `mode_match` | `trigger: mode: discover` | Current cycle mode matches |

### Resolution Algorithm

```python
def resolve(cycle_number, mode, persona) -> List[KernelProgram]:
    active = KernelRegistry.list(status="active")
    triggered = []
    for program in active:
        t = program.trigger
        if t.type == "interval_cycles" and cycle_number % t.n == 0:
            triggered.append(program)
        elif t.type == "mode_match" and t.mode == mode:
            triggered.append(program)
        elif t.type == "conditional" and eval_condition(t.condition):
            triggered.append(program)
        # "on_demand" programs are never added here — they are called explicitly
    return triggered
```

Reflection programs are **not** resolved by `TriggerEvaluator` — they are managed by `ReflectionCore` separately (see main plan §3.1). `ReflectionCore` itself is triggered by `CycleScheduler` when mode == "reflect".

---

## 3. CycleScheduler — Mode Selection

Each cycle has one primary mode. The mode determines:
- Which type of kernel programs are prioritized
- What `AgentCycleLoop` does after kernel programs run (execute a task, explore, or skip)

### Modes

| Mode | What happens | When to enter |
|------|-------------|---------------|
| `discover` | Run discovery + evaluation programs; add candidates to task queue | Task queue is low OR discover_weight is high |
| `explore` | Run attention programs; ingest external signals | Regular cadence OR attention weight high |
| `execute` | Select highest-value task and execute it | Task queue has candidates |
| `reflect` | Run `ReflectionCore` + reflection programs | Every `policies.reflection_frequency_cycles` cycles |

### Selection Algorithm

```python
def select_mode(cycle_number, persona, system_state) -> CycleMode:
    # Reflect is mandatory — checked first regardless of weights
    freq = persona["policies.reflection_frequency_cycles"]
    if cycle_number % freq == 0:
        return "reflect"

    # Execute is mandatory if tasks are queued and ready
    if system_state.task_queue_depth > 0:
        execute_bias = 1.0
    else:
        execute_bias = 0.0

    # Score remaining modes by persona weights
    weights = {
        "discover": persona["policies.cycle_mode.discover"] + (
            0.3 if system_state.task_queue_depth < 2 else 0.0   # urgency boost
        ),
        "explore":  persona["policies.cycle_mode.explore"],
        "execute":  persona["policies.cycle_mode.execute"] * execute_bias,
    }
    return max(weights, key=weights.get)
```

**Key property**: mode selection is deterministic given cycle_number + persona + system_state. No hidden randomness. This makes it testable and explainable ("I chose discover because queue was empty and discover_weight=0.6").

### What Flows into `system_state`

```python
@dataclass
class SystemState:
    task_queue_depth: int           # pending tasks with status="pending"
    pending_persona_changes: int    # persona_change_events WHERE reviewed_at IS NULL
    last_reflect_cycle: int         # last cycle where reflect mode ran
    last_discover_cycle: int        # last cycle where discover mode ran
```

---

## 4. OutputRouter

Routes typed kernel program outputs to the correct downstream consumers. Output types are defined in each program's `envelope.output_type`.

### Output Type → Consumer Map

| Output Type | Consumer | Action |
|-------------|----------|--------|
| `List[TaskCandidate]` | `TaskQueue` | Insert candidates into `tasks` table with status="pending" |
| `List[Signal]` | `AttentionProcessor` | Deduplicate + store in signal log; high-relevance signals may trigger `discover` mode boost |
| `Score` | `EvaluationStore` | Update `tasks.value_score` for scored tasks |
| `List[ReflectionInsight]` | `ReflectionCore` | Route to `PersonaUpdatePipeline` or `KernelMutationPlanner` based on `suggested_action` |
| `TaskPlan` | `TaskExecutor` | Used immediately during task execution (on-demand only) |

### Routing Implementation

```python
class OutputRouter:
    _routes: Dict[str, Callable] = {
        "List[TaskCandidate]": TaskQueue.insert_batch,
        "List[Signal]":        AttentionProcessor.ingest,
        "Score":               EvaluationStore.update,
        "List[ReflectionInsight]": ReflectionCore.dispatch_insights,
        "TaskPlan":            TaskExecutor.set_plan,
    }

    @classmethod
    def route(cls, results: List[KernelResult], cycle_number: int):
        for result in results:
            handler = cls._routes.get(result.output_type)
            if handler is None:
                Observer.emit(unknown_output_type_event(result))
                continue
            try:
                handler(result.output, cycle_number=cycle_number)
            except Exception as e:
                Observer.emit(routing_failure_event(result, e))
                # Do not re-raise — routing failure is not a cycle failure
```

### Anti-Recursion Enforcement (Reflection)

Before routing any `List[ReflectionInsight]`, `OutputRouter` checks:

```python
if result.program.type == "reflection":
    for insight in result.output:
        if insight.suggested_action in ("modify_kernel", "create_kernel"):
            target_type = get_target_type(insight)
            if target_type == "reflection":
                Observer.emit(anti_recursion_violation(insight))
                continue  # drop this insight; do not route
```

---

## 5. CycleReport and Observability

Every cycle produces a `CycleReport` stored in `agent_state.db` and emitted to Observer:

```python
@dataclass
class CycleReport:
    cycle_number: int
    mode: str                         # "discover" | "explore" | "execute" | "reflect"
    triggered_programs: List[str]     # program ids that were triggered
    execution_results: List[ExecutionSummary]  # per-program: status, tokens, duration
    outputs_routed: Dict[str, int]    # output_type → count routed
    errors: List[str]                 # any isolated failures this cycle
    total_tokens: int
    duration_ms: int
```

Dashboard shows per-cycle breakdown: mode timeline, program trigger frequency, error rate, token consumption by type.

---

## 6. Full Cycle Walkthrough

**Cycle 42, mode=discover:**

```
CycleScheduler:
  cycle 42 % reflection_frequency(10) != 0 → not reflect
  task_queue_depth=1 → execute_bias=1.0
  weights: discover=0.4, explore=0.3, execute=0.5
  → mode = "execute"   ← highest weight

  [Actually, queue depth=0 in this example → execute_bias=0]
  weights: discover=0.7 (0.4 + 0.3 urgency boost), explore=0.3, execute=0.0
  → mode = "discover"

TriggerEvaluator:
  active programs: [discovery/todo_sweep, attention/github_trending (interval=10)]
  42 % 10 != 0 → github_trending NOT triggered
  todo_sweep has trigger.mode="discover" → triggered
  → triggered = [discovery/todo_sweep]

KernelExecutor:
  runs todo_sweep with persona context
  produces: List[TaskCandidate] with 3 items

OutputRouter:
  routes List[TaskCandidate] → TaskQueue.insert_batch(3 candidates)

AgentCycleLoop:
  mode=discover → no task execution this cycle
  moves to cycle 43
```

**Cycle 50, mode=reflect:**

```
CycleScheduler:
  50 % 10 == 0 → mode = "reflect"

KernelRuntime:
  ReflectionCore.run(cycle=50)
    → loads kernel/reflection/failure_pattern_analysis.yaml
    → KernelExecutor.run(failure_pattern_analysis, context)
    → produces List[ReflectionInsight]:
        [ReflectionInsight(action="modify_kernel", program="discovery/todo_sweep",
                           rationale="abort rate 60%, max_tool_calls too low")]

OutputRouter:
  routes to ReflectionCore.dispatch_insights()
    → anti-recursion check: target="discovery" ✓ (not reflection)
    → KernelMutationPlanner.modify(todo_sweep, insight)
      → LLM rewrites constraints: max_tool_calls: 3 → 8
      → KernelSchema.validate() ✓
      → writes updated YAML
      → INSERT kernel_mutations (source="reflection/failure_pattern_analysis")
      → flags for human review
```

---

## Implementation Files

| File | Class | Depends on |
|------|-------|------------|
| `runtime/kernel_runtime.py` | `KernelRuntime` | `KernelExecutor`, `TriggerEvaluator`, `CycleScheduler`, `OutputRouter` |
| `runtime/trigger_evaluator.py` | `TriggerEvaluator` | `KernelRegistry`, `agent_state.db` |
| `runtime/cycle_scheduler.py` | `CycleScheduler` | `PersonaManager`, `SystemState` |
| `runtime/output_router.py` | `OutputRouter` | `TaskQueue`, `AttentionProcessor`, `EvaluationStore`, `ReflectionCore` |

## Deliverables

- [ ] `KernelRuntime.run_cycle()`: trigger resolution + sequencing + error isolation + routing
- [ ] `TriggerEvaluator`: all trigger types (interval, mode_match, conditional)
- [ ] `CycleScheduler`: deterministic mode selection from persona weights + system state
- [ ] `OutputRouter`: typed routing + anti-recursion enforcement + failure isolation
- [ ] `CycleReport`: per-cycle record in `agent_state.db` + Observer emission
- [ ] `SystemState`: computed from `agent_state.db` at cycle start
- [ ] Tests:
  - [ ] Mode selection: reflect wins at correct frequency; discover wins on empty queue; execute wins with queued tasks
  - [ ] Trigger resolution: interval triggers fire at correct cycles; mode_match triggers respect mode
  - [ ] Error isolation: one program failure does not abort cycle; other programs still run
  - [ ] Output routing: each output type reaches correct consumer; unknown types are logged not crashed
  - [ ] Anti-recursion: reflection insights targeting reflection type are dropped and logged
  - [ ] CycleReport: captured correctly for both success and partial-failure cycles
