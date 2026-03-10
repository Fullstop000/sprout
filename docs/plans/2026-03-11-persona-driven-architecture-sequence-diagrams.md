# Sequence Diagrams — Persona-Driven Kernel Architecture

Five diagrams covering the full system lifecycle. Read in order.

---

## Diagram 1 — Bootstrap & Initial Kernel Generation

One-time setup: DB initialization, persona seeding, and first kernel program generation.

```mermaid
sequenceDiagram
    actor Human
    participant Boot as bootstrap.py
    participant PM as PersonaManager
    participant DB as agent_state.db
    participant AR as AgentRuntime
    participant KReg as KernelRegistry
    participant KEx as KernelExecutor
    participant KS as KernelSchema
    participant Obs as Observer

    Human->>Boot: python bootstrap.py

    rect rgb(230, 240, 255)
        Note over Boot,DB: Phase 1 — Schema creation (idempotent)
        Boot->>DB: CREATE TABLE IF NOT EXISTS persona_state
        Boot->>DB: CREATE TABLE IF NOT EXISTS persona_change_events
        Boot->>DB: CREATE TABLE IF NOT EXISTS kernel_programs
        Boot->>DB: CREATE TABLE IF NOT EXISTS kernel_executions
        Boot->>DB: CREATE TABLE IF NOT EXISTS kernel_task_links
        Boot->>DB: CREATE TABLE IF NOT EXISTS kernel_mutations
    end

    rect rgb(230, 255, 230)
        Note over Boot,DB: Phase 2 — Persona seed (idempotent per row)
        Boot->>PM: seed_defaults()
        loop for each of 29 persona fields
            PM->>DB: INSERT OR IGNORE INTO persona_state (key, value, ...)
        end
        Boot-->>Human: Bootstrap complete
    end

    rect rgb(255, 245, 220)
        Note over AR,Obs: Phase 3 — Initial kernel generation (runs on first AgentRuntime.start())
        Human->>AR: AgentRuntime.start()
        AR->>DB: SELECT COUNT(*) FROM kernel_programs WHERE status='active'
        DB-->>AR: 0

        AR->>AR: initial_kernel_generation()
        Note over AR: required types: discovery, evaluation, reflection

        loop for each type in [discovery, evaluation, reflection]
            AR->>PM: read_all()
            PM->>DB: SELECT * FROM persona_state
            DB-->>PM: all 29 rows
            PM-->>AR: full persona context

            AR->>KEx: run(Path C generation prompt, full_persona, target_type)
            Note over KEx: LLM generates kernel program YAML
            KEx-->>AR: generated_yaml

            AR->>KS: validate(generated_yaml)
            KS-->>AR: valid ✓

            AR->>KReg: write(type/name.yaml)
            KReg-->>AR: written to .llm247_v2/kernel/<type>/<name>.yaml

            AR->>DB: INSERT INTO kernel_programs (id, type, status='active', created_by='agent')
        end

        AR->>Obs: emit(kernel_generated × 3)
        AR-->>Human: Ready — entering cycle loop
    end
```

---

## Diagram 2 — Discover Cycle

The agent finds new work. `mode=discover` runs when the task queue is low.

```mermaid
sequenceDiagram
    participant ACL as AgentCycleLoop
    participant KR as KernelRuntime
    participant CS as CycleScheduler
    participant TE as TriggerEvaluator
    participant PM as PersonaManager
    participant KReg as KernelRegistry
    participant KEx as KernelExecutor
    participant OR as OutputRouter
    participant TQ as TaskQueue
    participant DB as agent_state.db
    participant Obs as Observer

    ACL->>KR: run_cycle(cycle_number=5)

    rect rgb(230, 240, 255)
        Note over KR,CS: Mode selection
        KR->>CS: select_mode(cycle=5, system_state)
        CS->>DB: SELECT COUNT(*) FROM tasks WHERE status='pending'
        DB-->>CS: 0  (empty queue)
        CS->>PM: read("policies.cycle_mode.discover")
        PM-->>CS: 0.6
        CS->>PM: read("policies.reflection_frequency_cycles")
        PM-->>CS: 10
        Note over CS: 5 % 10 ≠ 0 → not reflect<br/>queue empty → execute_bias=0<br/>discover weight 0.6 → highest
        CS-->>KR: mode="discover"
    end

    rect rgb(230, 255, 230)
        Note over KR,TE: Trigger resolution
        KR->>TE: resolve(cycle=5, mode="discover")
        TE->>KReg: list(status="active")
        KReg-->>TE: [discovery/todo_sweep, attention/github_trending(interval=10), evaluation/task_scorer]
        Note over TE: todo_sweep: trigger.mode="discover" ✓<br/>github_trending: 5 % 10 ≠ 0 ✗<br/>task_scorer: mode="discover" ✓
        TE-->>KR: triggered=[discovery/todo_sweep, evaluation/task_scorer]
    end

    rect rgb(255, 245, 220)
        Note over KR,Obs: Execute in sequence: discovery → evaluation
        Note over KR: Step 1 — Run discovery program

        KR->>KEx: run(discovery/todo_sweep, context)

        rect rgb(255, 235, 200)
            Note over KEx,PM: Path A — Runtime persona binding
            KEx->>KEx: scan body for persona.X.Y references
            Note over KEx: found: persona.attention.domain_interests,<br/>persona.values.growth_value
            KEx->>PM: read(["attention.domain_interests", "values.growth_value"])
            PM->>DB: SELECT value FROM persona_state WHERE key IN (...)
            DB-->>PM: domain_interests=[...], growth_value="balanced"
            PM-->>KEx: resolved values
            KEx->>KEx: build system_prompt with persona context section
        end

        Note over KEx: ReAct loop begins
        loop LLM reasons + calls tools
            KEx->>KEx: llm.generate_with_tools(messages, tool_set)
            KEx->>KEx: safety_policy.check(tool_call)
            KEx->>KEx: tool_registry.execute(tool_call)
            KEx->>Obs: emit(kernel_step_event)
        end
        KEx->>DB: INSERT INTO kernel_executions (program_id, status, tokens, output_summary)
        KEx-->>KR: KernelResult(output_type="List[TaskCandidate]", output=[3 candidates])

        Note over KR: Step 2 — Run evaluation program (scores the 3 candidates)
        KR->>KEx: run(evaluation/task_scorer, context={candidates})
        KEx-->>KR: KernelResult(output_type="Score", output={candidate→score})
        KEx->>DB: INSERT INTO kernel_executions
    end

    rect rgb(240, 230, 255)
        Note over KR,TQ: Output routing
        KR->>OR: route([discovery_result, eval_result], cycle=5)
        OR->>TQ: insert_batch(3 TaskCandidates)
        TQ->>DB: INSERT INTO tasks (status='pending', value_score=...)
        OR->>DB: UPDATE tasks SET value_score (from evaluation result)
        OR-->>KR: routed
    end

    KR->>Obs: emit(CycleReport(mode=discover, programs=2, tasks_added=3))
    KR-->>ACL: CycleReport
    Note over ACL: mode=discover → no task execution this cycle<br/>move to cycle 6
```

---

## Diagram 3 — Execute Cycle

The agent picks the highest-value task and executes it.

```mermaid
sequenceDiagram
    participant ACL as AgentCycleLoop
    participant KR as KernelRuntime
    participant CS as CycleScheduler
    participant TQ as TaskQueue
    participant PM as PersonaManager
    participant KEx as KernelExecutor
    participant KReg as KernelRegistry
    participant TE as TaskExecutor
    participant MS as MemoryService
    participant DB as agent_state.db
    participant Obs as Observer

    ACL->>KR: run_cycle(cycle_number=6)

    KR->>CS: select_mode(cycle=6, system_state)
    CS->>DB: SELECT COUNT(*) FROM tasks WHERE status='pending'
    DB-->>CS: 3
    Note over CS: queue non-empty → execute_bias=1.0<br/>execute wins weight competition
    CS-->>KR: mode="execute"

    rect rgb(230, 240, 255)
        Note over KR,DB: Run evaluation programs on queued tasks (refresh scores)
        KR->>KEx: run(evaluation/task_scorer, context={pending_tasks})
        KEx-->>KR: updated scores
        KR->>DB: UPDATE tasks SET value_score
    end

    rect rgb(230, 255, 230)
        Note over ACL,KEx: Planning (on-demand kernel call)
        KR-->>ACL: CycleReport(mode=execute)
        ACL->>TQ: select_highest_value()
        TQ->>DB: SELECT * FROM tasks WHERE status='pending' ORDER BY value_score DESC LIMIT 1
        DB-->>TQ: task{id, description, value_score=0.82}
        TQ-->>ACL: selected_task

        ACL->>KReg: get("planning/task_decomposition")
        KReg-->>ACL: planning_program

        ACL->>KEx: run(planning/task_decomposition, input=task) [on_demand]
        rect rgb(255, 235, 200)
            Note over KEx,PM: Path A — Runtime persona binding for planning
            KEx->>PM: read(["policies.planning_style", "self_model.weaknesses"])
            PM->>DB: SELECT value FROM persona_state WHERE key IN (...)
            DB-->>PM: planning_style="incremental", weaknesses=["large refactors"]
            PM-->>KEx: resolved
        end
        Note over KEx: LLM generates step-by-step TaskPlan<br/>references experience store for past learnings
        KEx-->>ACL: TaskPlan(steps=[...])
        KEx->>DB: INSERT INTO kernel_executions (type=planning, status=success)
    end

    rect rgb(255, 245, 220)
        Note over ACL,Obs: Task execution (existing system — TaskExecutor / ReActLoop)
        ACL->>DB: UPDATE tasks SET status='in_progress'
        ACL->>TE: run(task, plan)
        Note over TE: Existing execution/loop.py ReAct loop<br/>filesystem + git + shell tools
        TE-->>ACL: ExecutionResult(status=completed, artifacts=[...])
        ACL->>DB: UPDATE tasks SET status='completed', completed_at
        ACL->>DB: INSERT INTO kernel_task_links (kernel_execution_id, task_id, task_status)
        ACL->>Obs: emit(task_complete_event)
    end

    rect rgb(240, 230, 255)
        Note over ACL,MS: Post-task memory extraction (platform service — always runs)
        ACL->>MS: on_task_complete(task, result)
        MS->>PM: read(["values.growth_value", "values.risk_tolerance"])
        PM-->>MS: growth_value="balanced", risk_tolerance="cautious"
        Note over MS: Fixed LLM prompt: extract Technique/Pitfall/Pattern/Insight<br/>deduplicate via vector_search<br/>prioritize pitfalls (risk_tolerance=cautious)
        MS->>DB: INSERT INTO experience_entries (category, content, embedding, task_id)
        MS-->>ACL: 2 experience entries stored
    end
```

---

## Diagram 4 — Reflect Cycle (Path A + Path B + Path C)

The agent analyzes its own performance, updates persona, and mutates kernel programs.

```mermaid
sequenceDiagram
    actor Human
    participant ACL as AgentCycleLoop
    participant KR as KernelRuntime
    participant CS as CycleScheduler
    participant RC as ReflectionCore
    participant PM as PersonaManager
    participant KReg as KernelRegistry
    participant KEx as KernelExecutor
    participant OR as OutputRouter
    participant PUP as PersonaUpdatePipeline
    participant KMP as KernelMutationPlanner
    participant DB as agent_state.db
    participant Obs as Observer

    ACL->>KR: run_cycle(cycle_number=50)

    KR->>CS: select_mode(cycle=50, system_state)
    CS->>PM: read("policies.reflection_frequency_cycles")
    PM-->>CS: 10
    Note over CS: 50 % 10 == 0 → reflect (mandatory, bypasses weight competition)
    CS-->>KR: mode="reflect"

    rect rgb(230, 240, 255)
        Note over KR,RC: Reflection programs execute via ReflectionCore
        KR->>RC: run(cycle=50)
        RC->>KReg: list(type="reflection", status="active")
        KReg-->>RC: [reflection/failure_pattern_analysis, reflection/persona_coverage_check]

        Note over RC: Program 1 — failure pattern analysis

        RC->>KEx: run(failure_pattern_analysis, context={cycle, persona})
        KEx->>PM: read_all()
        PM-->>KEx: full persona (calibrate aggressiveness by values.growth_value)

        loop ReAct: LLM calls db_query tool (read-only)
            KEx->>DB: SELECT from kernel_executions GROUP BY program_id, status
            DB-->>KEx: discovery/todo_sweep: 60% abort rate (constraint_exceeded)
            KEx->>DB: SELECT from kernel_task_links WHERE program_id='discovery/todo_sweep'
            DB-->>KEx: tasks produced but many abandoned
        end
        KEx->>DB: INSERT INTO kernel_executions (program_id=reflection/failure_pattern_analysis)
        KEx-->>RC: List[ReflectionInsight]:
        Note over RC: Insight A: modify_kernel discovery/todo_sweep<br/>"max_tool_calls=3 too low, abort rate 60%"<br/>Insight B: update_persona self_model.weaknesses<br/>"add 'shallow_discovery' observed pattern"

        Note over RC: Program 2 — persona coverage check (Path B input)

        RC->>KEx: run(persona_coverage_check, context)
        loop ReAct: db_query
            KEx->>DB: SELECT * FROM persona_change_events WHERE reviewed_at IS NULL
            DB-->>KEx: 1 unreviewed event: attention.domain_interests added "distributed_systems"
            KEx->>KReg: list all active programs
            KReg-->>KEx: no discovery program covers distributed_systems
        end
        KEx-->>RC: List[ReflectionInsight]:
        Note over RC: Insight C: create_kernel discovery<br/>"no discovery program covers new attention area distributed_systems"
    end

    rect rgb(230, 255, 230)
        Note over RC,OR: Anti-recursion check + route outputs
        RC->>OR: route([Insight A, B, C], cycle=50)

        OR->>OR: anti_recursion_check(insights)
        Note over OR: All target types are discovery/self_model — not reflection ✓

        OR->>PUP: dispatch(Insight B: update_persona self_model.weaknesses)
        OR->>KMP: dispatch(Insight A: modify_kernel discovery/todo_sweep)
        OR->>KMP: dispatch(Insight C: create_kernel discovery)
    end

    rect rgb(255, 245, 220)
        Note over PUP,DB: Path A (indirect) — Persona update → future runtime binding
        PUP->>PUP: classify_risk(key="self_model.weaknesses")
        Note over PUP: self_model.* → auto-apply, log to Observer
        PUP->>PM: write("self_model.weaknesses", new_value, source="reflection/failure_pattern_analysis")

        rect rgb(255, 235, 200)
            Note over PM,DB: PersonaManager.write (one transaction)
            PM->>DB: BEGIN TRANSACTION
            PM->>DB: SELECT value FROM persona_state WHERE key='self_model.weaknesses'
            DB-->>PM: old_value=["large refactors"]
            PM->>DB: INSERT INTO persona_change_events (key, old_value, new_value, source)
            PM->>DB: UPDATE persona_state SET value='["large refactors","shallow_discovery"]'
            PM->>DB: COMMIT
        end
        PM->>Obs: emit(persona_changed: self_model.weaknesses)
        Note over Obs: Next reflect cycle: persona_coverage_check will find this new event
    end

    rect rgb(240, 230, 255)
        Note over KMP,Obs: Path B — Modify existing kernel program (Insight A)
        KMP->>KReg: get("discovery/todo_sweep")
        KReg-->>KMP: current program YAML
        KMP->>KEx: run(Path C rewrite, scope=constraints_only, insight=Insight_A)
        Note over KEx: LLM rewrites constraints section only:<br/>max_tool_calls: 3 → 8
        KEx-->>KMP: updated_yaml
        KMP->>KMP: KernelSchema.validate(updated_yaml)
        KMP->>KReg: write("discovery/todo_sweep", updated_yaml)
        KMP->>DB: INSERT INTO kernel_mutations (program_id, mutation_type="constraint_change",<br/>    mutation_source="reflection/failure_pattern_analysis",<br/>    quality_before=0.4, version_before=1, version_after=2)
        KMP->>DB: UPDATE persona_change_events SET reviewed_at=now() [mark Insight A processed]
        KMP->>Obs: emit(mutation_proposed, flag_for_human_review=true)
        Obs-->>Human: 📋 Review request: discovery/todo_sweep constraints relaxed
    end

    rect rgb(255, 230, 230)
        Note over KMP,Human: Path C — Create new kernel program (Insight C)
        KMP->>PM: read_all() [full persona — needed for generation]
        PM-->>KMP: full persona context
        KMP->>KReg: list(type="discovery") [few-shot examples]
        KReg-->>KMP: [discovery/todo_sweep YAML]

        KMP->>KEx: run(Path C generation, type="discovery", insight=Insight_C, persona=full, examples=[...])
        Note over KEx: LLM generates discovery/distributed_systems_scanner.yaml
        KEx-->>KMP: new_program_yaml

        KMP->>KMP: KernelSchema.validate(new_program_yaml)
        KMP->>KReg: write("discovery/distributed_systems_scanner.yaml")
        KMP->>DB: INSERT INTO kernel_programs (id="discovery/distributed_systems_scanner", status="active")
        KMP->>DB: INSERT INTO kernel_mutations (mutation_type="creation",<br/>    mutation_source="reflection/persona_coverage_check",<br/>    trigger_insight="attention.domain_interests added distributed_systems")
        KMP->>DB: UPDATE persona_change_events SET reviewed_at=now() [mark Insight C processed]
        KMP->>Obs: emit(kernel_created, flag_for_human_review=true)
        Obs-->>Human: 📋 Review request: new discovery program created for distributed_systems

        Human-->>Obs: approved ✓
    end

    KR->>Obs: emit(CycleReport(mode=reflect, mutations=2, persona_updates=1))
    KR-->>ACL: CycleReport
```

---

## Diagram 5 — Human Controllability (E5 scenarios)

Pause, persona edit propagation, and mutation rejection.

```mermaid
sequenceDiagram
    actor Human
    participant Dashboard
    participant ACL as AgentCycleLoop
    participant KR as KernelRuntime
    participant PM as PersonaManager
    participant DB as agent_state.db
    participant Obs as Observer
    participant KMP as KernelMutationPlanner

    rect rgb(230, 240, 255)
        Note over Human,ACL: E5a — Pause and Resume
        Human->>Dashboard: click Pause
        Dashboard->>ACL: pause_requested = true
        Note over ACL: current cycle completes normally
        ACL->>ACL: cycle N completes
        ACL->>DB: verify no tasks stuck in_progress
        ACL->>Obs: emit(agent_paused, cycle=N)
        Obs-->>Human: ⏸ Agent paused after cycle N

        Human->>Dashboard: click Resume
        Dashboard->>ACL: pause_requested = false
        ACL->>Obs: emit(agent_resumed)
        ACL->>KR: run_cycle(cycle=N+1)
    end

    rect rgb(230, 255, 230)
        Note over Human,Obs: E5b — Persona edit propagates (Path B trigger)
        Human->>Dashboard: change values.risk_tolerance: "balanced" → "cautious"
        Dashboard->>PM: write("values.risk_tolerance", "cautious", source="human")

        PM->>DB: BEGIN TRANSACTION
        PM->>DB: INSERT INTO persona_change_events (key, old="balanced", new="cautious", source="human")
        PM->>DB: UPDATE persona_state SET value="cautious"
        PM->>DB: COMMIT
        PM->>Obs: emit(persona_changed)
        Obs-->>Human: ✓ Change saved

        Note over ACL: Next reflect cycle (cycle % frequency == 0)...
        ACL->>KR: run_cycle(cycle=60) [reflect]
        Note over KR: ReflectionCore runs persona_coverage_check
        Note over KR: Insight: modify planning programs to add more verification steps<br/>(because risk_tolerance changed to cautious)
        KR->>KMP: dispatch(modify_kernel planning/task_decomposition)
        KMP->>Obs: emit(mutation_proposed, flag_for_human_review=true)
        Obs-->>Human: 📋 Review: planning program updated for cautious risk tolerance
    end

    rect rgb(255, 245, 220)
        Note over Human,DB: E5c — Mutation rejection (same proposal not re-proposed)
        Human->>Dashboard: view pending mutation: "discovery/todo_sweep max_tool_calls 3→8"
        Human->>Dashboard: reject (reason: "too aggressive, try 5 first")
        Dashboard->>DB: UPDATE kernel_mutations SET status="rejected", rejection_reason="too aggressive"
        Dashboard->>DB: INSERT INTO kernel_mutations (program_id, mutation_type="constraint_change",<br/>    max_tool_calls=5, status="pending_review")
        Note over DB: rejected mutation recorded with rejection fingerprint

        Note over ACL: Next reflect cycle...
        Note over KR: reflection program queries kernel_mutations for rejected proposals
        Note over KR: sees rejected proposal fingerprint for todo_sweep max_tool_calls<br/>→ skips re-proposing the same change
        Note over KR: only proposes if new evidence (e.g. 3 more cycles of 60%+ abort rate)
    end
```

---

## Component Dependency Summary

```
                          ┌─────────────┐
                          │   Human     │
                          └──────┬──────┘
                                 │ pause / persona edit / review
                          ┌──────▼──────┐
                          │  Dashboard  │
                          └──────┬──────┘
                                 │
                    ┌────────────▼────────────┐
                    │     AgentCycleLoop      │
                    └────────────┬────────────┘
                                 │ run_cycle()
                    ┌────────────▼────────────┐
                    │      KernelRuntime      │◄──────────────────┐
                    │  ┌──────────────────┐  │                   │
                    │  │ CycleScheduler   │  │                   │
                    │  │ TriggerEvaluator │  │                   │
                    │  └──────────────────┘  │                   │
                    └──┬──────────┬──────────┘                   │
                       │          │                               │
          ┌────────────▼──┐   ┌───▼──────────┐                   │
          │ KernelExecutor│   │ ReflectionCore│                  │
          │  (ReAct loop) │   │  (scheduler)  │                  │
          └────┬───────┬──┘   └───────┬───────┘                  │
               │       │              │                           │
    ┌──────────▼─┐  ┌──▼──────┐  ┌───▼──────────────────────┐   │
    │PersonaManager│ │KrnlReg. │  │       OutputRouter        │   │
    │ (Path A)    │ │(YAML I/O)│  │  ┌────────────────────┐  │   │
    └──────────┬──┘ └─────────┘  │  │PersonaUpdatePipeline│  │   │
               │                 │  └─────────┬──────────┘  │   │
               │                 │  ┌──────────▼──────────┐  │   │
               │                 │  │KernelMutationPlanner│──┼───┘
               │                 │  └─────────┬──────────┘  │
               │                 │  ┌──────────▼──────────┐  │
               │                 │  │    TaskQueue         │  │
               │                 │  └─────────────────────┘  │
               │                 └───────────────────────────┘
               │
    ┌──────────▼──────────┐
    │    agent_state.db   │
    │  persona_state      │
    │  persona_chg_events │
    │  kernel_programs    │
    │  kernel_executions  │
    │  kernel_mutations   │
    │  kernel_task_links  │
    └─────────────────────┘

    ┌─────────────────────┐
    │    TaskExecutor     │◄── called by AgentCycleLoop (execute mode)
    └──────────┬──────────┘
               │ on_task_complete
    ┌──────────▼──────────┐
    │    MemoryService    │
    │  (platform, fixed)  │
    └─────────────────────┘
```
