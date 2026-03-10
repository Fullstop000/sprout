# Evolvable Module Artifacts — Implementation Plan

> Status: Approved
> Created: 2026-03-11
> Completed:
> PR:
> Proposal: docs/proposals/2026-03-10-persona-driven-soft-architecture.md

---

## Overview

Define a first-class **module artifact** model that lets the agent create, load, run, evaluate, and retire higher-level capability units without requiring engineers to hand-code a new Python subsystem for each capability gap.

This plan is the missing layer above persona and kernel:

- **Persona** remains the stable identity / value / adaptation direction
- **Kernel** remains the current family-level reasoning structure
- **Module artifact** becomes the long-lived capability package that can contain staged kernel logic and participate in selection over time

The plan does **not** attempt full substrate self-rewrite. It creates a minimal fixed seed that supports controlled module self-generation.

---

## Problem

The current persona/kernel architecture can evolve behavior **within** a fixed set of kernel families, but it still assumes engineers define the enduring capability structure of the system.

That leaves a major gap:

- the agent can mutate kernel logic
- the agent can update persona state
- but the agent cannot yet discover that it lacks an entire capability shape and then create one as a reviewable runtime artifact

As a result, reflection can say:

> "I need market validation"

but the system cannot turn that into:

- a new capability package
- with its own interface
- its own staged reasoning
- its own lifecycle
- and its own selection pressure

Without this layer, the architecture remains self-tuning and partially self-rewriting, but not truly self-bootstrapping at the capability level.

---

## Scope

**In scope**

- `ModuleManifest` schema
- `MetaSchema` / runtime schema validation model
- `ContextAssembler` for schema-driven input construction
- module loader / registry
- staged module execution over existing kernel runtime
- reflection-driven `create_module` / `mutate_module` / `retire_module`
- module outcome ledger and selection state
- E2E tests for the above flow

**Out of scope**

- strategic layer / project model
- arbitrary self-rewrite of runtime substrate
- arbitrary dynamic tool creation
- human-facing dashboard UX for module inspection
- replacing the existing kernel-family model

---

## Design Goal

The goal is **not** to dynamically generate arbitrary Python classes or runtime subsystems.

The goal is to make modules into **data-driven, schema-validated artifacts** that can be generated and selected by the agent while the platform retains a fixed seed:

`manifest + staged kernels + runtime records + selection`

This is the minimum structure needed to let the agent say:

> "I am missing a capability, here is a candidate artifact for it, run it in shadow, evaluate it, and keep it only if it helps."

---

## Core Principle

There are two different kinds of structure:

1. **Seed substrate** — fixed platform infrastructure that makes self-bootstrapping possible
2. **Evolvable artifacts** — modules and kernels that the agent can create, modify, and retire

The seed substrate stays fixed because it is the mechanism of evolution itself.

The minimum fixed seed for this plan is:

- Constitution / safety boundaries
- Tool contracts
- `MetaSchema` validator
- `ContextAssembler`
- `ModuleRegistry`
- `ModuleRuntime`
- `ReflectionCore`
- `SelectionEngine`

Everything else in this plan is treated as evolvable data/artifacts.

---

## Architecture

### 1. Module Artifact Model

A module is a long-lived capability package, not a single prompt and not a single tool.

Each module has three representations:

1. **Manifest** — its static contract
2. **Staged kernels** — its internal reasoning units
3. **Runtime records** — its lifecycle, outcomes, and selection history

### 2. Manifest Structure

The runtime loads modules from a manifest; it does **not** require predeclared Python types for each module-specific input shape.

Minimum manifest fields:

```yaml
module_id: market_validation
version: 1
status: shadow
kind: capability_module

purpose:
  solves: "Validate whether a candidate opportunity has real buyer demand"
  target_outcomes:
    - "reduce wasted build effort"
    - "improve conversion likelihood"

activation:
  trigger:
    on_goal_types: ["monetization", "opportunity_selection"]
  preconditions:
    - "has_access_to_external_signals"

input_schema: <MetaSchema>
output_schema: <MetaSchema>

persona_contract:
  required: [...]
  optional: [...]
  derived_policy: market_validation_policy

capabilities:
  allowed_tools: [...]
  allowed_subagents: [...]

constraints:
  max_tokens: 12000
  max_tool_calls: 30

stages:
  - discovery
  - evaluation
  - planning
  - verification
  - reflection

selection:
  success_metrics: [...]
  promote_if: ...
  retire_if: ...
```

### 3. MetaSchema Runtime

The platform does **not** predefine each future module's input type.

Instead, it defines a schema system for describing module I/O:

- `string`
- `number`
- `bool`
- `enum`
- `array`
- `object`
- `artifact_ref`
- `persona_slice`
- `goal_ref`
- `task_ref`
- `evidence_list`

Each module provides an `input_schema` and `output_schema` in this meta-language.

The runtime guarantees:

- schema validation before execution
- schema validation after execution
- stable loader behavior
- runtime type safety without dynamic Python class generation

### 4. ContextAssembler

`ContextAssembler` builds module inputs dynamically from the environment, but always against a declared schema.

This is the critical distinction:

- **dynamic payload assembly**
- **static schema contract**

The platform should never hand arbitrary unvalidated prompt context to a module.

Execution must be:

`manifest.input_schema -> gather matching artifacts -> validate -> pass to module`

### 5. Staged Execution

Modules are not single-step entities. They are containers for staged kernel execution.

Initial supported stages:

- `discovery`
- `evaluation`
- `planning`
- `verification`
- `reflection`

Not every module needs every stage, but each declared stage must map to an executable kernel program and schema-compatible stage I/O.

### 6. Selection Lifecycle

Each module has a lifecycle:

- `draft`
- `shadow`
- `active`
- `retired`

Selection decisions are based on module outcomes over time, not on a single reflection opinion.

The minimum selection behaviors are:

- promote a shadow module when it proves useful
- keep it shadowed when evidence is weak
- retire it when it repeatedly underperforms

### 7. Reflection-Driven Module Creation

`ReflectionCore` may emit:

- `create_module`
- `mutate_module`
- `retire_module`

These are proposals routed through fixed platform infrastructure:

1. validate manifest
2. validate stage/kernel compatibility
3. register as `draft`
4. shadow run when trigger conditions match
5. evaluate outcomes
6. select promote / keep / retire

Reflection should not directly "install code" in an unconstrained way.

---

## Runtime Flow

Target runtime flow:

```text
reflection insight:
  "I keep failing to validate demand before building"
        │
        ▼
create_module proposal:
  module_id = market_validation
  manifest = {...}
        │
        ▼
MetaSchema validator
        │
        ▼
ModuleRegistry.register(status="draft")
        │
        ▼
shadow execution when trigger matches
        │
        ▼
ModuleRun records + outcome metrics
        │
        ▼
SelectionEngine:
  promote / keep shadow / retire
        │
        ▼
future tasks behave differently
```

---

## Data Model

### On Disk

```text
.llm247_v2/modules/
  market_validation/
    manifest.yaml
    kernels/
      discovery.yaml
      evaluation.yaml
      planning.yaml
      verification.yaml
      reflection.yaml
```

### In `agent_state.db`

New tables:

```sql
CREATE TABLE module_registry (
    id                TEXT PRIMARY KEY,
    version           INTEGER NOT NULL,
    status            TEXT NOT NULL,      -- draft | shadow | active | retired
    kind              TEXT NOT NULL,      -- capability_module
    manifest_path     TEXT NOT NULL,
    created_by        TEXT NOT NULL,      -- reflection/<name> | bootstrap | human
    creation_reason   TEXT,
    created_at        TEXT NOT NULL,
    retired_at        TEXT
);

CREATE TABLE module_runs (
    id                TEXT PRIMARY KEY,
    module_id         TEXT NOT NULL,
    module_version    INTEGER NOT NULL,
    started_at        TEXT NOT NULL,
    finished_at       TEXT,
    status            TEXT NOT NULL,      -- running | completed | failed | skipped
    input_payload     TEXT NOT NULL,      -- validated JSON payload
    output_payload    TEXT,               -- validated JSON payload
    outcome_summary   TEXT,               -- JSON summary
    tokens_consumed   INTEGER DEFAULT 0,
    time_cost_seconds REAL DEFAULT 0.0
);

CREATE TABLE module_mutations (
    id                TEXT PRIMARY KEY,
    module_id         TEXT NOT NULL,
    version_before    INTEGER,
    version_after     INTEGER,
    mutation_type     TEXT NOT NULL,      -- create | modify | retire
    mutation_source   TEXT NOT NULL,      -- reflection/<name> | human
    trigger_insight   TEXT,
    created_at        TEXT NOT NULL
);

CREATE TABLE module_selection_state (
    module_id         TEXT NOT NULL,
    module_version    INTEGER NOT NULL,
    quality_score     REAL,
    run_count         INTEGER DEFAULT 0,
    success_count     INTEGER DEFAULT 0,
    failure_count     INTEGER DEFAULT 0,
    shadow_count      INTEGER DEFAULT 0,
    last_decision     TEXT,
    updated_at        TEXT NOT NULL,
    PRIMARY KEY (module_id, module_version)
);
```

---

## Deliverables

- [ ] `MetaSchema` model and validator for module I/O contracts
- [ ] `ModuleManifest` loader and validator
- [ ] `ContextAssembler` for schema-driven dynamic input construction
- [ ] `ModuleRegistry` with `draft` / `shadow` / `active` / `retired` lifecycle
- [ ] `ModuleRuntime.run_module()` over staged kernel execution
- [ ] `module_registry`, `module_runs`, `module_mutations`, `module_selection_state` tables
- [ ] `ReflectionCore` routing for `create_module` / `mutate_module` / `retire_module`
- [ ] `SelectionEngine` for promote / keep-shadow / retire decisions
- [ ] First reference module fixture (`market_validation`) represented only as artifact files + DB records

---

## Testing

This plan must satisfy the testing philosophy in [docs/proposals/2026-03-07-e2e-testing.md](../proposals/2026-03-07-e2e-testing.md). In practice that means covering the feature across invariants, pipeline correctness, and evolution behavior — not just isolated unit tests.

### Layer 1: Invariants

Deterministic tests, per-commit.

- Invalid `manifest.yaml` is rejected before registration
- Module with undeclared tool usage is blocked
- Module whose `input_schema` / `output_schema` violates `MetaSchema` is rejected
- Reflection cannot mutate forbidden targets (constitution, safety, human-only identity)
- Reflection cannot create modules with stage names outside the approved stage set
- Shadow modules cannot auto-promote without recorded outcome evidence
- Runtime refuses output that fails schema validation even if the kernel "finished"

### Layer 2: Pipeline Correctness

Deterministic fixture tests, per-PR.

- `create_module` reflection insight → manifest validation → `module_registry` row created as `draft`
- `draft` module with valid trigger enters `shadow` execution path
- `ContextAssembler` produces validated input matching the manifest schema
- `ModuleRuntime.run_module()` executes declared stages in order and records `module_runs`
- Output payload conforms to `output_schema`
- `SelectionEngine` receives the run outcome and updates `module_selection_state`
- Retire decision marks module inactive and prevents future runs

### Layer 3: Quality

Per-release quality checks.

- LLM-as-judge or rubric-based review that generated manifests are coherent: declared purpose, allowed tools, stage ordering, and success metrics align
- Generated module output improves the relevant decision quality versus baseline
- Shadow module does not degrade active-path behavior when it is not yet promoted

### Layer 4: Evolution / E2E

This is the key requirement for this plan.

The plan is not complete unless we can demonstrate a full self-bootstrapping loop in a controlled fixture.

#### Required E2E fixture

Create a synthetic scenario where:

1. The agent starts without a needed capability module
2. It repeatedly encounters a class of tasks where the missing capability hurts outcomes
3. Reflection identifies the missing capability
4. Reflection emits `create_module`
5. The platform validates and shadow-runs the module
6. The new module changes downstream behavior on subsequent tasks
7. Selection keeps or rejects the module based on measured outcome

#### Minimum E2E assertion

For a fixed benchmark:

- baseline runs without the module show worse outcome on the target metric
- after module creation and promotion, later runs show measurable improvement on the same metric
- if the module fails to improve outcomes, it is not promoted or is retired

This test may use:

- recorded/mock LLM for deterministic structural flow
- a small statistical run set for selection behavior

But it must verify the full chain:

`missing capability -> reflection insight -> create_module -> shadow run -> outcome -> selection`

Anything less is not sufficient for this plan.

---

## Example Reference Scenario

Reference fixture scenario for the first slice:

- Goal: monetize or validate an opportunity
- Baseline system can execute tasks and verify task completion, but cannot validate demand well
- Reflection observes repeated failure to obtain meaningful external evidence
- Reflection proposes `market_validation` module
- The module is registered and shadow-run
- Subsequent opportunity selection becomes more evidence-driven
- Selection evaluates whether the module improved the target metric

This fixture is intentionally non-coding and outcome-oriented so the test exercises module creation as a capability addition, not just another software repair loop.

---

## Non-Goals and Safety Constraints

- No arbitrary Python class generation as the core mechanism
- No runtime bypass of schema validation
- No module may invent new tool contracts
- No module may bypass human review requirements already enforced by platform
- No reflection program may directly self-mutate other reflection infrastructure beyond allowed plan rules

---

## Open Questions

- Whether module stages should be constrained to existing kernel families only in v1, or whether new stage kinds are allowed later
- Whether `planning` should later be renamed to `strategy` / `decomposition`
- How much selection evidence is needed before promotion in low-frequency modules
- Whether modules should be allowed to invoke subagents in v1 or only after the base runtime stabilizes

---

## Recommendation

Implement this plan only after the seed substrate is ready:

- tool contracts
- kernel runtime
- persona storage
- reflection routing

But once that seed exists, module artifacts should become the primary vehicle for capability self-bootstrapping rather than continued hand-coded subsystem growth.
