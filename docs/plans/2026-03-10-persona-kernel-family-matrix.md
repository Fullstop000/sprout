# Persona-Kernel Family Consumption Matrix

> Status: Approved
> Created: 2026-03-10
> Completed:
> PR:
> Proposal: docs/proposals/2026-03-10-persona-driven-soft-architecture.md

---

## Overview

This document defines the **persona consumption boundary** for each kernel family.

The existing persona field catalogue answers:

- what persona state exists
- how it is stored
- who can edit it

This matrix answers a different question:

- when generating or executing a kernel for family `X`, **which persona fields is it allowed and expected to consume?**

This boundary is critical. Without it, every kernel family will tend to read the full persona table, causing prompt sprawl, weak reviewability, and unstable behavior coupling.

---

## Design Goal

The goal is **not** to let every kernel consume all persona.

The goal is:

`persona_state -> family-specific persona slice -> derived policy -> kernel generation/execution`

This keeps the persona expressive while preserving:

- bounded prompt inputs
- reviewable family interfaces
- stable behavior under self-modification
- clear separation between persona, kernel, and runtime/platform controls

---

## Shared Rules

### 1. Kernel families consume slices, not the full persona table

Each family receives only the persona subset relevant to its job.

Examples:

- discovery needs attention and exploration preferences
- planning needs execution style, risk posture, and known weaknesses
- verification needs completion strictness and failure-pattern context

### 2. Prefer derived policy over raw field-by-field reads

Kernel generation and execution should prefer a compiled family policy:

```text
persona_state
  -> derive_discovery_policy()
  -> derive_planning_policy()
  -> derive_evaluation_policy()
  -> derive_verification_policy()
  -> derive_reflection_policy()
```

The raw persona slice remains available for context, but the policy is the primary control input.

### 3. Runtime/platform controls are not free kernel inputs

The following classes of fields should not be freely interpreted by kernel bodies:

- `identity.boundaries`
- `policies.stop.*`
- `policies.cycle_mode.*`

These exist primarily for enforcement by constitution, scheduler, executor, or platform code.

### 4. Reflection is a special case

`reflection` is a fixed runtime capability, but its **style and focus** are persona-sensitive.

That means:

- the system must always be able to run a reflect cycle
- reflection kernels are still valid kernel programs
- reflection may read a broader persona slice than other families
- reflection may propose persona updates, but not bypass identity and human-review guards

### 5. Planning is retained, but interpreted narrowly

For now, `planning` remains a kernel family.

It should be interpreted as:

- task decomposition
- local strategy shaping
- scope control
- verification-aware next-step planning

It should **not** be interpreted as a requirement that every task must begin with a large up-front static plan.

---

## Shared Baseline Context

All kernel families may receive a low-weight identity context:

- `identity.name`
- `identity.role`
- `identity.mission`

This is shared narrative context, not primary control logic.

`identity.boundaries` is excluded from this shared baseline as a behavioral control input. It may be surfaced as read-only context where necessary, but enforcement belongs to the constitution/platform layer.

---

## Persona-Kernel Family Matrix

| kernel family | core question | required persona inputs | optional persona inputs | derived policy | must not directly consume | reason |
|---|---|---|---|---|---|---|
| `discovery` | What should I notice and turn into candidate work? | `attention.domain_interests`, `attention.source_preferences`, `attention.novelty_sensitivity`, `attention.anomaly_sensitivity`, `attention.exploration_radius`, `values.tradeoff.exploration_vs_exploitation`, `values.tradeoff.novelty_vs_proven`, `values.tradeoff.depth_vs_breadth` | `values.growth_value`, `self_model.growth_targets`, `self_model.weaknesses` | `discovery_policy` | `identity.boundaries`, `policies.stop.*`, `policies.cycle_mode.*` | Discovery should be shaped by attention and exploration preferences, not by scheduler or hard-stop controls |
| `planning` | How should I decompose and sequence work from here? | `values.tradeoff.thoroughness_vs_speed`, `values.risk_tolerance`, `values.long_term_weight`, `policies.planning_style`, `self_model.weaknesses`, `self_model.known_failure_patterns` | `values.growth_value`, `self_model.strengths`, `attention.domain_interests` | `planning_policy` | `identity.boundaries`, `policies.stop.*`, `policies.cycle_mode.*` | Planning should shape strategy and scope, but runtime limits remain outside the kernel body |
| `evaluation` | Is this worth doing or worth continuing? | `values.core_objective`, `values.long_term_weight`, `values.growth_value`, `self_model.growth_targets` | `attention.domain_interests`, `self_model.capability_stats`, `self_model.strengths` | `evaluation_policy` | `identity.boundaries`, `policies.stop.*`, `policies.cycle_mode.*` | Evaluation is about value judgment, not runtime budgeting or scheduling |
| `verification` | Did this actually succeed, and what evidence is required? | `policies.verification_depth`, `values.tradeoff.thoroughness_vs_speed`, `values.risk_tolerance`, `self_model.known_failure_patterns` | `self_model.weaknesses`, `values.long_term_weight` | `verification_policy` | `identity.boundaries`, `policies.cycle_mode.*` | Verification should define the done bar and required evidence without taking over scheduler concerns |
| `reflection` | Why did I succeed or fail, and what should change? | `identity.name`, `identity.role`, `identity.mission`, `identity.self_narrative`, `values.*`, `self_model.*` | `attention.*`, `policies.planning_style`, `policies.verification_depth` | `reflection_policy` | `identity.boundaries` as mutable target, `policies.stop.*` as free-form policy | Reflection needs the broadest self-model, but it must not bypass human-controlled identity and runtime guardrails |

---

## Read vs Write Boundary

The matrix above defines **read access for kernel generation/execution**.

It does not imply write access.

Write rules remain stricter:

- most kernel families should produce task candidates, plans, rankings, or verification outcomes
- only `reflection` may propose persona updates
- even `reflection` must not directly mutate human-controlled identity fields without directive/human review

---

## Why This Matrix Matters

Without this matrix, the architecture tends to collapse into one of two bad states:

1. **Everything reads everything**
   Persona becomes an unbounded prompt dump, and kernel behavior becomes hard to review or stabilize.

2. **Nothing has a real persona interface**
   Persona exists in storage but does not meaningfully shape behavior.

This matrix creates the middle path:

- persona remains behaviorally relevant
- kernel families remain bounded and reviewable
- reflection retains a special meta-cognitive role
- runtime/platform enforcement remains outside kernel improvisation

---

## Follow-On Work

This document implies two follow-up tasks:

1. Define the `derive_*_policy()` objects for each family
2. Decide whether `planning` remains named `planning` or is later renamed to `strategy` / `decomposition`

The current recommendation is to keep `planning` for now and narrow its meaning rather than renaming it immediately.
