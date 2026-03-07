# Proposal: Benchmark Sprout Memory Architecture Against OpenClaw

> Status: Draft
> Created: 2026-03-07
> Decision: Decide whether Sprout should adopt any structural patterns from OpenClaw's memory architecture
> Scope: Compare Sprout's current experience and memory design with OpenClaw's memory subsystem and identify candidate changes worth planning
> Next Step: Review the comparison and decide whether to create a focused implementation plan for one narrow memory change
> Related: [../design/experience.md](../design/experience.md), [../design/architecture.md](../design/architecture.md), [../design/project.md](../design/project.md)

## Summary

OpenClaw treats memory as a first-class subsystem with several distinct layers: product-level positioning, runtime managers, provider backends, and session-memory capture hooks.
Sprout currently has a strong `experience` concept, but its memory-related responsibilities are still concentrated in a smaller set of modules and docs.
This proposal suggests using OpenClaw as a reference architecture to evaluate whether Sprout should separate long-term experience, retrieval infrastructure, and session-scoped memory more explicitly.
The goal is not to copy OpenClaw wholesale, but to extract patterns that improve clarity, extensibility, and observability.

## Problem

Sprout already documents long-term memory in `docs/design/experience.md`, but several architectural questions remain open:

- Where should session-scoped memory live relative to long-term experience?
- Should retrieval, storage, ranking, and ingestion remain part of one subsystem or split into narrower modules?
- How should runtime-configurable memory providers be represented if Sprout adds more retrieval backends?
- How should memory behavior be exposed in docs so the distinction between "what the agent remembers", "how it retrieves", and "how it persists" stays clear?

Without an explicit comparison target, it is easy to grow the memory stack incrementally without a coherent boundary model.

## Proposal

Use OpenClaw as a reference point for a structured design review of Sprout memory architecture.

### High-Level Architecture Sketch

Current Sprout memory shape is still centered on `experience` as the dominant abstraction:

```text
                   Sprout Today

 task execution
      │
      ▼
 learning extraction
      │
      ▼
 ExperienceStore
      │
      ├── store structured learnings
      ├── recall for planning
      ├── consolidate / dedupe / decay
      └── expose to dashboard
```

OpenClaw separates memory concerns more explicitly:

```text
                  OpenClaw Memory Shape

                 product positioning
                        │
                        ▼
                 memory plugin slot
                        │
        ┌───────────────┼────────────────┐
        ▼               ▼                ▼
 session-memory    memory managers   provider/backends
 hook              and search        embeddings / storage
        │               │                │
        ▼               ▼                ▼
 workspace/memory   retrieval/index   backend-specific ops
 files              orchestration     and config
```

The architectural question is whether Sprout should remain intentionally centered on one `experience` module, or whether it now needs a broader memory stack with clearer internal seams.

### Direct Comparison: Sprout Experience vs OpenClaw Memory

| Dimension | Sprout today | OpenClaw |
|-----------|--------------|----------|
| Primary abstraction | `experience` as long-term learned knowledge | `memory` as a broader subsystem |
| Scope | Learnings extracted from completed or failed tasks | Retrieval, indexing, providers, session files, and search management |
| Session-scoped memory | Not a first-class documented concept | Explicit session-memory hook writing session context into workspace memory files |
| Retrieval backend design | Currently centered in one experience store flow | Provider-oriented and backend-aware |
| Doc framing | Memory mostly described through the experience module | Memory positioned at product level and implemented as a subsystem |
| Boundary clarity | Strong for long-term learning, weaker for other memory concerns | Stronger separation between capture, storage, search, and provider layers |

### Key Difference

Sprout currently answers the question:

> What lessons does the agent retain from prior work?

OpenClaw also answers broader questions:

> Where does session context go?
> How is memory indexed and searched?
> Which provider powers embeddings?
> Which runtime layer owns memory capture versus memory retrieval?

That does not automatically make OpenClaw better for Sprout, but it does reveal that Sprout's current design is narrower in scope and more concentrated in one module.

The comparison should focus on these patterns observed in OpenClaw:

1. **Memory as a subsystem, not a single feature**
   OpenClaw has a dedicated `src/memory/` area with clear internal responsibilities such as manager, search, embeddings, session files, and backend configuration.

2. **Session memory separated from long-term memory**
   OpenClaw's session-memory hook captures session context on `/new` and `/reset` into a dedicated workspace `memory/` area rather than mixing this concern into the broader search/index manager.

3. **Provider-oriented backend design**
   OpenClaw isolates backend/provider concerns for embeddings and retrieval instead of treating memory as one monolithic implementation.

4. **Top-level product positioning**
   OpenClaw's `VISION.md` explains memory as a special plugin slot, which gives maintainers a crisp conceptual model before they enter implementation details.

For Sprout, the review should ask whether we want to introduce any of the following:

- A clearer split between `experience` and other memory concerns such as retrieval or session context
- A dedicated session-memory concept in the architecture
- More explicit provider/binding abstractions for memory and embeddings
- Stronger project-level documentation for how memory fits into the agent's overall cognition model

### Candidate Borrowed Patterns

The point of comparison is not "copy OpenClaw memory". The point is to evaluate whether any of these narrower patterns are worth adopting:

1. **Documented split between long-term experience and session memory**
2. **A dedicated retrieval/index manager abstraction separate from learned content**
3. **Cleaner provider boundaries for embedding and recall backends**
4. **A project-level explanation of memory as a subsystem, not only as a storage module**

### Preliminary Judgment

Not every difference matters equally.

**Mostly stylistic or ecosystem-driven differences:**

- OpenClaw's plugin-slot framing for memory is heavily shaped by its plugin-oriented product architecture
- OpenClaw's broader memory package surface partly reflects a larger provider and integration matrix than Sprout currently has
- OpenClaw's session file conventions are tightly coupled to its terminal and session workflow, which Sprout does not currently mirror

These are useful reference points, but they are not strong reasons by themselves to restructure Sprout.

**Differences that likely matter for Sprout:**

1. **Session memory is under-modeled in Sprout**
   Sprout has strong long-term experience design, but no equally explicit concept for short-lived or session-scoped memory. If that need emerges, it should probably not be bolted onto `experience`.

2. **Retrieval infrastructure and learned content may deserve separate abstractions**
   `experience` currently mixes the idea of remembered knowledge with the machinery that stores, searches, reranks, and consolidates it. That is acceptable today, but may become a scaling constraint as retrieval paths multiply.

3. **Provider boundaries should be decided before they become accidental**
   OpenClaw makes backend/provider concerns explicit. Sprout should at least decide whether embeddings and recall backends belong behind a stable abstraction before more memory features land.

4. **Sprout may need a broader memory narrative than `experience` alone**
   If future work adds session context, world modeling, module understanding, or other cognitive stores, then `experience` is no longer the whole memory story. The docs and architecture should anticipate that shift deliberately.

### Current Recommendation

The strongest takeaway is not "adopt OpenClaw memory architecture."

It is:

- keep `experience` as Sprout's current long-term learning abstraction
- avoid broad memory rewrites
- evaluate one narrow architectural improvement at a time

The most promising next-step candidates appear to be:

1. Document an explicit distinction between long-term experience and any future session memory
2. Decide whether retrieval/index logic should remain inside `experience` or become a separate memory service boundary
3. Clarify memory terminology in docs before adding more cognitive storage concepts

## Expected Value

- Reduces the chance that Sprout's memory stack grows by accretion without clean boundaries
- Makes future refactors easier by identifying separable concerns before they are entangled in code
- Helps decide whether `experience` should remain the primary abstraction or become one part of a broader memory architecture
- Gives future proposals a concrete external reference instead of designing from scratch every time

## Risks and Open Questions

- OpenClaw and Sprout do not have identical goals; copying its structure directly could import complexity without matching value
- OpenClaw is plugin-oriented, while Sprout currently has a tighter integrated runtime, so the same separation lines may not fit
- It is not yet clear whether Sprout's missing abstraction is "session memory", "retrieval infrastructure", or simply better documentation of the current design
- A broad memory redesign would be too large; any approved next step should be intentionally narrow

## Exit Criteria

- Approved for Plan: one narrow architectural change is selected and moved into `docs/plans/`
- Rejected: the team decides Sprout's current memory architecture is sufficient and only minor doc updates are needed
- Superseded: a more precise memory proposal replaces this benchmark-oriented comparison
