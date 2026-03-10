# Persona Model and Bootstrap — Implementation Plan

> Status: Approved
> Created: 2026-03-10
> Completed:
> PR:
> Proposal: docs/proposals/2026-03-10-persona-driven-soft-architecture.md

---

## Overview

Define the persona data model, implement `PersonaManager`, and write the bootstrap initialization script.

This plan covers the **persona layer only** — `persona_state` table, `persona_change_events` table, `PersonaManager`, and `bootstrap.py`. It does **not** cover `initial_kernel_generation()`, which depends on `KernelSchema` and Path C infrastructure defined in the main plan.

**Dependencies**: None. This plan has no code dependencies — `agent_state.db` schema creation and `PersonaManager` require only SQLite and standard Python.

**Blocked by this plan**: [2026-03-10-persona-driven-soft-architecture.md](2026-03-10-persona-driven-soft-architecture.md) — `KernelExecutor`, kernel registry, and all three influence paths require `PersonaManager` and `agent_state.db` to exist first.

**Not covered here** (covered in main plan, Phase 1):
- `initial_kernel_generation()` — requires `KernelSchema.validate()` and Path C generation, which depend on kernel infrastructure
- `AgentRuntime.start()` empty-kernel detection
- `DiscoveryPipeline`

---

## Persona Storage

All persona state lives in `agent_state.db` as individual rows in the `persona_state` table. Each configurable item is a flat row — not a JSON blob per file. The category grouping is part of the key name, not the file system.

**Why flat rows over JSON blobs:**
- Dashboard settings panel can render each field independently (sliders for numbers, toggles for booleans, tag editors for arrays)
- `persona_change_events` references a specific `key`, not a whole document
- New persona fields can be added without schema migration
- Each field has its own `editable_by` policy — human-readable fields surface in the settings panel; agent-only fields do not

---

## `persona_state` Table Schema

```sql
CREATE TABLE persona_state (
    key            TEXT PRIMARY KEY, -- dotted path, category-prefixed: "values.tradeoff.risk_tolerance"
    category       TEXT NOT NULL,    -- "identity" | "values" | "attention" | "policies" | "self_model"
    value_type     TEXT NOT NULL,    -- "string" | "number" | "bool" | "array" | "object" | "enum"
    value          TEXT NOT NULL,    -- JSON-serialized; numbers as "0.5", strings as '"text"', arrays as '[...]'
    allowed_values TEXT,             -- JSON array of valid strings, only set when value_type="enum"; NULL otherwise
                                     -- e.g. '["narrow","medium","wide"]'
                                     -- used by PersonaManager.write() validation and dashboard dropdown rendering
    editable_by    TEXT NOT NULL,    -- "human" | "agent" | "both"
    label          TEXT NOT NULL,    -- human-readable name for dashboard: "Risk Tolerance"
    description    TEXT,             -- tooltip/help text for dashboard settings panel
    updated_at     TEXT NOT NULL,
    updated_by     TEXT NOT NULL     -- "bootstrap" | "reflection/<name>" | "human" | "directive"
);
```

---

## Full Field Catalogue

All fields at bootstrap. Fields marked `agent` in `editable_by` do not appear in the human settings panel.

The catalogue now also records how each field is expected to land in runtime:

- **Realization class** — whether the field is consumed by kernel context, derived kernel policy, runtime/platform policy, or is deferred
- **Primary consumer** — the main subsystem or kernel family that should consume the field
- **V1 realizable?** — whether the field has a credible V1 implementation path

The field catalogue describes persona **storage and per-field runtime landing**.
The family-level persona consumption boundary is defined separately in [2026-03-10-persona-kernel-family-matrix.md](2026-03-10-persona-kernel-family-matrix.md).

### category: `identity`

| key | value_type | allowed_values | editable_by | label | description | bootstrap value | realization class | primary consumer | V1 realizable? |
|-----|-----------|----------------|-------------|-------|-------------|-----------------|-------------------|------------------|----------------|
| `identity.name` | string | — | human | Agent Name | The agent's name | `"Sprout"` | Kernel-context | `discovery`, `planning`, `reflection` | Yes |
| `identity.role` | string | — | human | Role | One-line role description | `"autonomous engineering agent"` | Kernel-context | `discovery`, `planning`, `reflection` | Yes |
| `identity.mission` | string | — | human | Mission | The agent's long-term purpose | `"Build deep understanding of its world, pursue goals across time, and deliberately improve its own capabilities"` | Kernel-context | `discovery`, `planning`, `reflection` | Yes |
| `identity.self_narrative` | string | — | agent | Self Narrative | Agent's own description of itself, filled through experience | `""` | Kernel-context | `planning`, `reflection` | Yes |
| `identity.boundaries` | array | — | human | Hard Boundaries | Rules the agent must never violate | `["never modify constitution.md or safety.py"]` | Runtime-policy | Constitution / platform | Yes, with caveat |

### category: `values`

| key | value_type | allowed_values | editable_by | label | description | bootstrap value | realization class | primary consumer | V1 realizable? |
|-----|-----------|----------------|-------------|-------|-------------|-----------------|-------------------|------------------|----------------|
| `values.core_objective` | string | — | human | Core Objective | What the agent is fundamentally trying to achieve | `"Compound usefulness through learning, reflection, and self-modification"` | Kernel-policy | `evaluation`, `reflection`, `planning` | Yes |
| `values.tradeoff.thoroughness_vs_speed` | enum | `["ship_now","lean","balanced","careful","meticulous"]` | both | Thoroughness vs Speed | Preference over how aggressively to optimize for speed versus thoroughness: `ship_now` (`speed_strong`) → `lean` (`speed`) → `balanced` → `careful` (`thorough`) → `meticulous` (`thorough_strong`) | `"careful"` | Kernel-policy | `planning`, `evaluation`, `verification` | Yes |
| `values.tradeoff.exploration_vs_exploitation` | enum | `["stay_focused","mostly_exploit","balanced","mostly_explore","wander_widely"]` | both | Exploration vs Exploitation | Preference over exploiting known approaches versus exploring new ones: `stay_focused` (`exploit_strong`) → `mostly_exploit` (`exploit`) → `balanced` → `mostly_explore` (`explore`) → `wander_widely` (`explore_strong`) | `"balanced"` | Kernel-policy | `discovery`, `evaluation` | Yes |
| `values.tradeoff.novelty_vs_proven` | enum | `["stick_to_proven","prefer_proven","balanced","prefer_novel","seek_novelty"]` | both | Novelty vs Proven | Preference over established approaches versus novel ones: `stick_to_proven` (`proven_strong`) → `prefer_proven` (`proven`) → `balanced` → `prefer_novel` (`novel`) → `seek_novelty` (`novel_strong`) | `"prefer_proven"` | Kernel-policy | `discovery`, `evaluation` | Yes |
| `values.tradeoff.depth_vs_breadth` | enum | `["scan_widely","browse","balanced","dig_deeper","deep_dive"]` | both | Depth vs Breadth | Preference over scanning broadly versus digging deeply: `scan_widely` (`breadth_strong`) → `browse` (`breadth`) → `balanced` → `dig_deeper` (`depth`) → `deep_dive` (`depth_strong`) | `"balanced"` | Kernel-policy | `discovery`, `evaluation` | Yes |
| `values.risk_tolerance` | enum | `["risk_averse","cautious","balanced","bold","adventurous"]` | both | Risk Tolerance | Overall appetite for risky changes and uncertain approaches: `risk_averse` (`risk_low_strong`) → `cautious` (`risk_low`) → `balanced` → `bold` (`risk_high`) → `adventurous` (`risk_high_strong`) | `"cautious"` | Kernel-policy | `planning`, `evaluation`, `verification` | Yes |
| `values.long_term_weight` | enum | `["now_first","near_term","balanced","far_sighted","long_horizon"]` | both | Long-term Weight | How much to weight long-term value over immediate returns: `now_first` (`immediate_strong`) → `near_term` (`immediate`) → `balanced` → `far_sighted` (`long_term`) → `long_horizon` (`long_term_strong`) | `"far_sighted"` | Kernel-policy | `planning`, `evaluation`, `reflection` | Yes |
| `values.growth_value` | enum | `["ship_work","improve_when_needed","balanced","invest_in_growth","growth_first"]` | both | Growth Value | How much the agent prioritizes its own capability improvement: `ship_work` (`delivery_strong`) → `improve_when_needed` (`delivery`) → `balanced` → `invest_in_growth` (`growth`) → `growth_first` (`growth_strong`) | `"balanced"` | Kernel-policy | `evaluation`, `reflection` | Yes |

### category: `attention`

| key | value_type | allowed_values | editable_by | label | description | bootstrap value | realization class | primary consumer | V1 realizable? |
|-----|-----------|----------------|-------------|-------|-------------|-----------------|-------------------|------------------|----------------|
| `attention.domain_interests` | array | — | both | Domain Interests | Topics the agent actively monitors; each item: `{"topic": string, "weight": 0-1, "source": "initial\|learned\|directive"}` | `[]` | Kernel-policy | `discovery` | Yes |
| `attention.source_preferences` | array | — | both | Source Preferences | Preferred information source types | `["code analysis", "security advisories"]` | Kernel-policy / Deferred | `discovery`, later `synthesis` | Partially |
| `attention.novelty_sensitivity` | enum | `["low","medium","high"]` | both | Novelty Sensitivity | How aggressively discovery should admit novel signals | `"medium"` | Kernel-policy | `discovery` | Yes |
| `attention.anomaly_sensitivity` | enum | `["low","medium","high"]` | both | Anomaly Sensitivity | How strongly anomalous signals attract attention | `"medium"` | Kernel-policy | `discovery` | Yes |
| `attention.exploration_radius` | enum | `["narrow","medium","wide"]` | both | Exploration Radius | How far from current domains the agent scans | `"medium"` | Kernel-policy / Deferred | `discovery`, later `synthesis` | Partially |

### category: `policies`

| key | value_type | allowed_values | editable_by | label | description | bootstrap value | realization class | primary consumer | V1 realizable? |
|-----|-----------|----------------|-------------|-------|-------------|-----------------|-------------------|------------------|----------------|
| `policies.reflection_frequency_cycles` | number | — | both | Reflection Frequency | Run a reflect cycle every N normal cycles | `10` | Runtime-policy | Scheduler | Yes |
| `policies.planning_style` | enum | `["incremental","comprehensive"]` | both | Planning Style | `incremental`: small verifiable steps; `comprehensive`: full upfront plan | `"incremental"` | Kernel-policy | `planning` | Yes |
| `policies.verification_depth` | enum | `["minimal","standard","thorough"]` | both | Verification Depth | How thoroughly to verify each step | `"standard"` | Kernel-policy | `verification` | Yes |
| `policies.stop.max_retries_per_step` | number | — | both | Max Retries Per Step | Abandon a step after this many failures | `3` | Runtime-policy | Executor / platform | Yes |
| `policies.stop.max_tokens_per_task` | number | — | both | Max Tokens Per Task | Hard budget per task execution | `50000` | Runtime-policy | Executor / platform | Yes |
| `policies.stop.abandon_after_failures` | number | — | both | Abandon After Failures | Abandon a task after this many consecutive step failures | `2` | Runtime-policy | Executor / platform | Yes |
| `policies.cycle_mode.execute` | number | — | both | Execute Weight | Relative weight for execute cycle mode | `0.4` | Runtime-policy | Scheduler | Yes |
| `policies.cycle_mode.discover` | number | — | both | Discover Weight | Relative weight for discover cycle mode | `0.25` | Runtime-policy | Scheduler | Yes |
| `policies.cycle_mode.explore` | number | — | both | Explore Weight | Relative weight for explore cycle mode | `0.15` | Runtime-policy | Scheduler | Yes |
| `policies.cycle_mode.reflect` | number | — | both | Reflect Weight | Relative weight for reflect cycle mode | `0.1` | Runtime-policy | Scheduler | Yes |
| `policies.cycle_mode.study` | number | — | both | Study Weight | Relative weight for study cycle mode | `0.1` | Runtime-policy | Scheduler | Yes |

### category: `self_model`

All `self_model` fields are `editable_by: "agent"` — they are filled by the agent through experience and do not appear in the human settings panel.

| key | value_type | label | bootstrap value | realization class | primary consumer | V1 realizable? |
|-----|-----------|-------|-----------------|-------------------|------------------|----------------|
| `self_model.strengths` | array | Strengths | `[]` | Kernel-context / Kernel-policy | `planning`, `reflection`, `evaluation` | Yes |
| `self_model.weaknesses` | array | Weaknesses | `[]` | Kernel-context / Kernel-policy | `planning`, `reflection`, `evaluation` | Yes |
| `self_model.known_failure_patterns` | array | Known Failure Patterns | `[]` | Kernel-context / Kernel-policy | `planning`, `reflection`, `evaluation` | Yes |
| `self_model.growth_targets` | array | Growth Targets | `[]` | Kernel-context / Kernel-policy | `planning`, `reflection`, `evaluation` | Yes |
| `self_model.capability_stats` | object | Capability Stats | `{}` | Kernel-policy / Deferred | `evaluation`, `reflection`, later routing | Partially |
| `self_model.understanding_map` | object | Understanding Map | `{}` | Deferred | later `synthesis`, `study`, `planning` context assembly | Partially |

---

## `persona_change_events` Table

Every `PersonaManager.write()` produces a row here — before the value is applied. This is the audit trail and the trigger for kernel review (Path B).

```sql
CREATE TABLE persona_change_events (
    id           TEXT PRIMARY KEY,
    key          TEXT NOT NULL,    -- references persona_state.key
    category     TEXT NOT NULL,    -- denormalized from persona_state.category for fast filtering
    old_value    TEXT,             -- JSON-serialized previous value
    new_value    TEXT NOT NULL,    -- JSON-serialized new value
    created_at   TEXT NOT NULL,
    source       TEXT NOT NULL,    -- "bootstrap" | "reflection/<name>" | "human" | "directive"
    reviewed_at  TEXT,             -- filled when kernel_review.yaml processes this event
    review_outcome TEXT,           -- "no_action" | "mutation_proposed" | "creation_proposed" | "retirement_proposed"
    review_detail  TEXT            -- what the review decided and why
);
```

---

## `PersonaManager`

New file: `src/llm247_v2/core/persona.py`

```python
class PersonaManager:
    def read(self, key: str) -> Any:
        """Return the current value for a persona key."""

    def read_category(self, category: str) -> dict[str, Any]:
        """Return all keys in a category as {key: value}."""

    def read_all(self) -> dict[str, Any]:
        """Return all persona_state rows as {key: value}."""

    def write(self, key: str, new_value: Any, source: str) -> None:
        """
        Validate, record change event, apply new value — in one transaction:
          1. Load current row from persona_state (gets value_type, allowed_values, editable_by)
          2. Validate new_value:
             - value_type="number": must be float/int
             - value_type="string": must be str
             - value_type="bool": must be bool
             - value_type="array"/"object": must parse as JSON array/object
             - value_type="enum": new_value must be in allowed_values (JSON array in DB)
          3. Check editable_by — reject "agent"-only keys when source="human"
          4. INSERT persona_change_events (key, category, old_value, new_value, source)
          5. UPDATE persona_state SET value=new_value, updated_at, updated_by
          6. Emit persona_changed event to Observer
        """

    def validate_all(self) -> None:
        """Check all rows exist and values parse as their declared value_type."""
```

**Identity guard**: keys in `identity.*` with `editable_by: "human"` require `source == "directive"` for agent-initiated writes. Reflection cannot change `identity.role` or `identity.boundaries` without a human directive.

**Path A support**: `read(key)` and `read_all()` are used by `KernelExecutor` to resolve `persona.X.Y` references at runtime.

---

## Bootstrap

Bootstrap initializes `agent_state.db` with the full schema and seed persona rows.

```
bootstrap.py
  │
  ├── phase 1: ensure schema
  │     Open (or create) agent_state.db
  │     For every table: CREATE TABLE IF NOT EXISTS (...)
  │       - persona_state
  │       - persona_change_events
  │       - kernel_programs
  │       - kernel_executions
  │       - kernel_mutations
  │       - kernel_task_links
  │     Safe to run on an existing DB — missing tables are created, existing ones untouched.
  │
  ├── phase 2: seed persona_state
  │     For each row in the field catalogue:
  │       INSERT OR IGNORE INTO persona_state (key, category, value_type, value,
  │           allowed_values, editable_by, label, description, updated_at, updated_by)
  │     INSERT OR IGNORE means existing rows are never overwritten.
  │     Safe to run repeatedly — already-bootstrapped fields remain unchanged.
  │
  └── phase 3: verify
        PersonaManager.validate_all()
        Print: "N persona fields ready, M kernel tables ready"
```

**Why `CREATE TABLE IF NOT EXISTS` + `INSERT OR IGNORE`**: these are the correct idempotency primitives. A check like "if persona_state has rows, skip everything" is wrong — it would silently skip creating missing kernel tables if persona was already seeded (e.g. after a partial bootstrap). Each operation is independently safe to repeat.

**Human-configured fields before first start**: edit persona values via the dashboard settings panel or CLI:
```
sprout persona set values.risk_tolerance low --source human
```

---

## Deliverables

- [ ] `agent_state.db` schema: `persona_state` + `persona_change_events` + all kernel table schemas (via `CREATE TABLE IF NOT EXISTS`)
- [ ] `PersonaManager`: `read()`, `read_category()`, `read_all()`, `write()` with transactional change event, type validation (including enum `allowed_values` check), and identity guard
- [ ] `bootstrap.py`: `CREATE TABLE IF NOT EXISTS` for all tables + `INSERT OR IGNORE` for all persona seed rows
- [ ] `sprout persona set <key> <value>` CLI command for pre-start configuration
- [ ] Dashboard settings panel: renders all `editable_by: "human"` or `"both"` fields, grouped by category; renders enum fields as dropdowns using `allowed_values`, number fields as sliders, array fields as tag editors

---

## Testing

### Unit Tests
- `PersonaManager.validate_all()` catches missing rows and wrong value types
- `PersonaManager.write()` inserts change event and updates persona_state in one transaction
- `PersonaManager.write()` with `source="reflection/..."` on an `identity.*` key is rejected without directive
- `PersonaManager.write()` for `editable_by: "agent"` key with `source="human"` is rejected
- `PersonaManager.write()` with invalid enum value (not in `allowed_values`) is rejected
- Bootstrap run 1: creates all tables, inserts all seed rows
- Bootstrap run 2 (on same DB): no rows changed, no errors — all `INSERT OR IGNORE`, all `CREATE TABLE IF NOT EXISTS`
- Bootstrap on DB with persona rows but missing `kernel_mutations` table: missing table is created, persona rows untouched

### Integration Tests
- Full bootstrap → `PersonaManager.read_all()` returns all 29 fields with correct values
- `write()` → `persona_change_events` row has correct `key`, `category`, `old_value`, `new_value`, `source`
- Dashboard settings panel reads `editable_by: "human"` or `"both"` fields; submitting a change calls `PersonaManager.write()`
- Dashboard renders `attention.exploration_radius` as a dropdown with options `["narrow","medium","wide"]`
- Change event with `reviewed_at IS NULL` is visible to kernel review query

---

## Appendix: Persona Field Realizability in Kernel

The current persona catalogue is **not** a 1:1 list of kernel knobs. A stable architecture should not let arbitrary kernel bodies read arbitrary persona fields and improvise behavior freely. Instead, persona fields should land in one of four realization classes:

1. **Kernel-context fields** — injected into kernel prompts as identity or self-knowledge context
2. **Kernel-policy fields** — compiled into derived planning/discovery/evaluation/verification/reflection policy
3. **Runtime-policy fields** — enforced by scheduler, executor, or platform guardrails rather than kernel bodies
4. **Deferred fields** — valid persona state now, but only become fully actionable once later kernel families or data pipelines exist

### Field-by-Field Mapping

The field-by-field realizability mapping is now folded into the `Full Field Catalogue` above so storage shape, runtime landing point, and V1 viability stay in one place.

### Design Implication

To keep runtime behavior stable, persona should first be compiled into a small set of derived policies rather than read raw by every kernel:

```text
persona_state
  -> derive_planning_policy()
  -> derive_discovery_policy()
  -> derive_evaluation_policy()
  -> derive_verification_policy()
  -> derive_reflection_policy()
  -> derive_runtime_policy()
```

This keeps the persona expressive while preserving fixed kernel interfaces. Kernel implementations then consume the derived policy, not the full unbounded persona table.

### Discretization Rule for Persona Fields

Not all numeric persona fields should survive into runtime as raw numbers.

**Rule:** if a field is meant to select or branch behavior, but the runtime cannot map a raw numeric value to a stable, testable action boundary, it should be stored as or compiled into an **enum** or bucketed profile before kernel execution.

Use this split:

- **Keep numeric** when the value is inherently quantitative and enforced outside kernel reasoning
  - counts, budgets, retry limits, frequencies, token caps
- **Discretize** when the value expresses a qualitative preference that kernels would otherwise have to interpret loosely
  - risk posture, completion strictness, novelty preference, depth preference
- **Replace weighted vectors with profiles** when multiple numeric weights only exist to imply a routing mode
  - cycle-mode weights are better represented as named operating profiles unless there is a concrete scheduler that truly consumes real-valued weights

### Recommended Conversion of Current Numeric Fields

The behavior-selecting value fields and attention sensitivity fields have now been converted directly to enums in the `Full Field Catalogue` above. The remaining numeric fields are quantitative runtime controls or unresolved scheduler weights.

### Consequence for the Current Plan

The current persona catalogue is now substantially safer for kernel realization: behavior-selecting preference fields are represented as enums, while genuinely quantitative controls remain numeric. The main unresolved area is `policies.cycle_mode.*`, which still behaves more like an operating profile than a mathematically meaningful set of weights.

### Answer to the Design Question

**Can all currently designed persona fields be implemented?**

- **Yes**, if "implemented" means realized somewhere in the combined `kernel + scheduler + executor + platform` architecture
- **No**, if the requirement is that every field must directly appear as a free-form kernel behavior knob in V1

Several fields should never be implemented purely inside kernel bodies because they are safety or runtime control concerns (`identity.boundaries`, `policies.stop.*`, `policies.cycle_mode.*`). Several others are valid now but only become fully effective after later kernel families or data infrastructure exist (`attention.source_preferences`, `attention.exploration_radius`, `self_model.capability_stats`, `self_model.understanding_map`)

### Gap Exposed by the "60% vs 100%" Example

The previous discussion introduced a behavior difference like:

- "60% done is good enough; switch to task B"
- "Do not stop until A is complete, then look for optimization headroom"

That distinction is **not yet a first-class persona field** in the current catalogue. Today it would have to be approximated by:

- `values.tradeoff.thoroughness_vs_speed`
- `policies.verification_depth`
- `policies.stop.*`

This approximation is serviceable, but it compresses multiple concepts into one bundle. If this distinction matters architecturally, a later plan should introduce an explicit field such as:

- `policies.completion_mode = "good_enough" | "complete" | "complete_and_improve"`

or

- `values.completion_threshold`

The enum form is likely more stable than a raw float because it maps directly to kernel stop rules and verification requirements.
