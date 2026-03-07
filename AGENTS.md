# Part I — Code Organization

## 1. Naming

**Names are the primary documentation.**
A well-named function or variable eliminates the need for a comment. If you need a comment to explain what a name means, rename it.

**Use domain language consistently.**
Pick one word per concept across the entire codebase. Don't alternate between `fetch`/`get`/`retrieve`/`load` for the same operation. Establish a shared vocabulary with your team.

**Booleans should read as questions.**
`isLoading`, `hasError`, `canSubmit` — not `loading`, `error`, `submit`. This also applies to boolean-returning functions: `isEmpty()`, `hasPermission()`.

**Avoid abbreviations and cryptic shortcuts.**
Code is read far more than it is written. Saving keystrokes now creates cognitive overhead forever. Exceptions: universally understood shorthands (`i`, `j`, `id`, `url`, `err`) are fine in narrow scopes.

---

## 2. Structure & Modularity

**Single Responsibility Principle (SRP).**
Every module, class, and function should have exactly one reason to change. If you describe it with "and", split it. A 500-line file almost certainly violates this.

**Organize by feature, not by type.**
Group code by what it does together, not by what kind of code it is.

```
# Avoid (for larger apps)
src/models/  src/controllers/  src/views/

# Prefer
src/auth/  src/billing/  src/dashboard/
```

**Keep files short and scannable.**
Files over ~300 lines are a signal to refactor. Files over 500 lines are almost always a problem. Short files are easier to review, test, and understand.

**Enforce clear layer boundaries.**
Define distinct layers (presentation, business logic, data access) and enforce that dependencies only flow in one direction. UI should not contain SQL. Business logic should not format display strings.

---

## 3. Functions & Methods

**Functions should do one thing.**
A function that does one thing is easy to name, easy to test, and easy to reuse. The ideal function is 5–15 lines. Nested conditionals deeper than 2 levels almost always need extraction.

**Limit function arguments to 3 or fewer.**
Functions with many parameters are hard to call, hard to test, and a sign the function does too much. Use an options object when you need more context.

```js
// Bad — hard to read at call site
createUser("Alice", 30, "admin", true, "UTC");

// Good — self-documenting
createUser({ name: "Alice", age: 30, role: "admin" });
```

**Prefer pure functions wherever possible.**
Pure functions (same input → same output, no side effects) are trivial to test, reason about, and reuse. Isolate side effects (I/O, mutations, randomness) at the edges of your system.

**Return early to reduce nesting.**
Guard clauses at the top of a function eliminate deep indentation and make the happy path obvious.

```js
// Deep nesting (avoid)
if (user) { if (user.active) { if (hasPermission) { ... } } }

// Guard clauses (prefer)
if (!user) return;
if (!user.active) return;
if (!hasPermission) return;
// happy path here
```

---

## 4. State & Data Flow

**Minimize mutable state.**
Every piece of mutable state is a potential bug. Prefer immutable data and derive values from a single source of truth. Prefer `const` over `let`; prefer derived values over stored copies.

**Colocate state with its consumers.**
State should live as close as possible to the code that uses it. Avoid hoisting state globally unless truly shared. Global state is a shared mutable dependency — the hardest kind to reason about.

**Make invalid states unrepresentable.**
Design data models so impossible situations can't exist in the type system. Prevent bugs structurally, not defensively.

```ts
// Bad: both can be true simultaneously
{ isLoading: true, hasError: true }

// Good: mutually exclusive states
type Status = 'idle' | 'loading' | 'error' | 'success';
```

---

## 5. Dependencies & Coupling

**Depend on abstractions, not concretions.**
Code should depend on interfaces and contracts, not on specific implementations (Dependency Inversion Principle). Inject dependencies; don't hardcode them.

**Keep coupling loose, cohesion high.**
Modules that change together should live together. Modules that don't depend on each other shouldn't know about each other.

**Treat third-party libraries as risks.**
Wrap external dependencies behind thin adapters. This decouples your code from library internals and makes migration painless. Don't scatter calls to a logging or HTTP library across 80 files — create a thin abstraction; change it in one place.

---

## 6. Error Handling

**Fail fast and fail loudly.**
An error that surfaces immediately is far easier to debug than one that propagates silently. Never swallow exceptions. Catch errors at the right boundary, handle them meaningfully.

**Make error paths as clear as happy paths.**
Every function that can fail should communicate that clearly. Avoid returning `null` for failures — it's impossible to tell if `null` means "not found" or "something broke." Use typed errors or Result types.

**Add context when re-throwing.**
Stack traces alone are rarely enough for production debugging. Always add context.

```js
// Bad
} catch (e) { throw e; }

// Good
} catch (e) {
  throw new Error(`Failed to load user ${userId}: ${e.message}`);
}
```

---

## 7. Testing

**Write code that is testable by design.**
If code is hard to test, it's hard to understand and hard to change. Testability is a proxy for good architecture. Hard-to-test code usually has hidden dependencies, global state, or does too many things.

**Follow the Arrange–Act–Assert (AAA) pattern.**
Every test has three phases: set up the scenario, execute the code under test, verify the outcome. Keep these phases visually distinct. Tests are documentation — they show how code is intended to be used.

**Test behavior, not implementation.**
Tests should verify what a unit does, not how it does it internally. Tests coupled to implementation break on every refactor. Assert on public outcomes: return values, side effects, state changes — not internal method calls.

**One assertion per test (ideally).**
Tests with multiple assertions obscure which behavior failed. One focused assertion makes failures unambiguous and fast to diagnose.

---

## 8. Comments & Documentation

**Comments explain _why_, not _what_.**
Code should explain itself through naming and structure. Comments are for business rules, historical context, non-obvious trade-offs, and warnings — not for restating what the code already says.

**Delete dead code; don't comment it out.**
Commented-out code is noise that erodes trust in the codebase. Version control exists precisely to recover old code. Delete it.

**Keep comments synchronized with code.**
A comment that contradicts the code is worse than no comment. Outdated comments actively mislead. If you change code, update its comments immediately.

---

## 9. Consistency & Style

**Automate style enforcement.**
Use linters, formatters, and pre-commit hooks. Style debates are a waste of engineering time. Let tools decide; let humans think.

**Follow the principle of least surprise.**
Code should do exactly what its name, signature, and context imply. Surprising behavior is a bug, even when it's intentional.

**Be consistent above all else.**
A codebase that consistently follows a mediocre convention is easier to work in than one that inconsistently follows great ones. Consistency reduces the cognitive load of context-switching across files.

---

## The Meta-Principle

> **Code is written once, read hundreds of times.**

Every decision — naming, structure, commenting, testing — should optimize for the next person who reads it. That person is often you, six months from now. Write accordingly.

---

# Part II — Git Workflow

## 1. Branch Workflow for New Features

**Always start from a clean, up-to-date `main`.**
Before beginning any new feature or refactor, ensure you are working from the latest state of the mainline. Branching from stale or mid-flight code introduces invisible merge debt.

```bash
git checkout main
git pull origin main
git checkout -b {agent}/<feature-name>
```

**Use the `{agent}/` prefix for all feature and refactor branches.**
`agent` is who you are, e.g. `codex`, `claudecode`.
This namespace makes automated tooling, CI rules, and branch hygiene filters easy to apply consistently. Examples: `{agent}/user-auth-flow`, `{agent}/settings-refactor`.

**Resolve local changes before branching — never silently carry them.**
If staged or unstaged changes are present when a new feature or refactor is requested, stop and explicitly confirm how to handle them before proceeding. Do not carry unrelated residual changes into a new feature branch.

**One branch, one purpose.**
A branch should represent a single coherent unit of work. If mid-implementation you discover an unrelated bug, fix it on a separate branch. Mixed-purpose branches produce mixed-purpose PRs that are hard to review and hard to revert.

**Keep branches short-lived.**
Long-lived branches accumulate merge conflicts and drift from reality. Aim to open a PR within a day or two of starting. If a feature is large, break it into sequential branches that each deliver a reviewable slice.

---

## 2. Commit Message Format

**Follow Conventional Commits with scope.**
Every commit message should communicate _what changed_ and _where_, structured so it is machine-readable (changelogs, CI) and human-readable (blame, bisect).

```
<type>(<scope>): <short imperative description>

[optional body: explain why, not what]
[optional footer: BREAKING CHANGE, closes #issue]
```

**Commit types:**

| Type       | When to use                                     |
| ---------- | ----------------------------------------------- |
| `feat`     | A new user-facing feature                       |
| `fix`      | A bug fix                                       |
| `refactor` | Code restructuring with no behavior change      |
| `test`     | Adding or updating tests                        |
| `docs`     | Documentation only                              |
| `ci`       | CI/CD pipeline changes                          |
| `chore`    | Tooling, deps, config with no production impact |
| `perf`     | Performance improvements                        |

**Examples:**

```
feat(settings): add dark mode toggle
fix(command): handle empty input without crashing
refactor(config): extract parser into separate module
ci: add lint check to PR workflow
docs(api): document pagination parameters
```

**Write in the imperative mood.**
"Add feature" not "Added feature" or "Adding feature." The subject line should complete the sentence: _"If applied, this commit will…"_

**Keep the subject line under 72 characters.**
Long subject lines are truncated in most Git UIs and logs. Put detail in the body, not the subject.

**One logical change per commit.**
Commits are the atomic unit of history. A commit that does two things is harder to review, harder to revert, and harder to understand months later. If you find yourself writing "and" in a commit message, consider splitting it.

---

# Part III — Architecture Design

> Architecture is the set of decisions that are hard to reverse. Make them deliberately, document them explicitly, and revisit them regularly.

## 1. Design for Change, Not for Perfection

**Defer irreversible decisions as long as possible.**
The cost of a wrong architectural decision compounds over time. Gather real requirements before committing to a structure. "We might need this later" is not a requirement.

**Prefer reversible over irreversible choices.**
All else equal, choose the option that is easier to undo. Monolith-first is easier to split later than microservices are to merge. SQL is easier to move off than a proprietary cloud-native store.

**Evolve architecture incrementally.**
Big-bang rewrites almost always fail. Introduce architectural changes through the strangler fig pattern — wrap, migrate, retire — so the system remains shippable at every step.

---

## 2. Separate Concerns at Every Level

**Domain logic must not leak into infrastructure.**
Business rules should be expressible and testable without a database, HTTP server, or message queue. If your domain model imports a framework, something is wrong.

**Define clear boundaries between bounded contexts.**
Each major domain area (e.g. billing, identity, notifications) should own its data and expose a deliberate interface to the outside world. Cross-context data access is the root of most large-scale coupling problems.

**Apply the Ports & Adapters (Hexagonal) pattern.**
Your application core defines ports (interfaces it needs). Adapters implement those ports for specific infrastructure (Postgres, S3, Stripe). This makes the core independently testable and infrastructure swappable.

```
[ UI / CLI / API ]       ← Adapter (driving)
        ↓
[ Application Core ]     ← Pure domain + use cases
        ↓
[ DB / Queue / Email ]   ← Adapter (driven)
```

---

## 3. Design Explicit Contracts

**Every public API is a promise.**
Once an interface is consumed externally, changing it has a cost. Version APIs from day one. Deprecate explicitly; don't silently break consumers.

**Specify behavior, not structure.**
Contracts should describe what a component guarantees — inputs, outputs, invariants, error conditions — not how it is implemented internally. This preserves the freedom to refactor.

**Use types and schemas as living contracts.**
Define data shapes at boundaries with types (TypeScript), schemas (JSON Schema, Zod, Pydantic), or protobufs. These are machine-checkable and serve as documentation that cannot go stale.

---

## 4. Design for Observability from Day One

**Treat logging, metrics, and tracing as first-class concerns.**
Observability is not a post-launch concern. A system you cannot observe in production is a system you cannot safely operate. Design structured logs, emit meaningful metrics, and propagate trace IDs across service boundaries from the start.

**Make the system's health visible.**
Every service should expose a health check. Every critical operation should emit a metric. Every failure should be distinguishable from a success in your logs.

**Design for debuggability, not just correctness.**
Code that works is not enough — you need to be able to understand _why_ it works and _why_ it fails. Instrument the decision points, not just the outcomes.

---

## 5. Manage Complexity Deliberately

**Complexity is the root cause of most software failures.**
There are two kinds: essential complexity (inherent to the problem) and accidental complexity (introduced by our solutions). Ruthlessly eliminate accidental complexity. Acknowledge and isolate essential complexity.

**Prefer simple over clever.**
A solution the entire team can understand and modify is more valuable than an elegant one only its author can maintain. Cleverness has a carry cost.

**Document architectural decisions with ADRs.**
For every significant architectural choice, write a short Architecture Decision Record (ADR): the context, the options considered, the decision made, and the trade-offs accepted. Future engineers — including yourself — will need this context.

```markdown
# ADR-001: Use PostgreSQL for primary data store

## Status: Accepted

## Context: Need a reliable relational store with strong consistency guarantees.

## Decision: PostgreSQL over MySQL due to superior JSON support and extension ecosystem.

## Consequences: Operationally familiar; requires managed hosting or DBA attention at scale.
```

---

## 6. Security and Resilience Are Not Features

**Design for failure at every layer.**
Every network call will eventually fail. Every disk will eventually fill. Every dependency will eventually be unavailable. Design with timeouts, retries, circuit breakers, and graceful degradation — not as afterthoughts, but as first-class requirements.

**Apply least privilege everywhere.**
Services, users, and processes should have access to exactly what they need — nothing more. Over-provisioned permissions are a security debt that compounds silently.

**Validate all input at trust boundaries.**
Never trust data crossing a boundary you don't control. Validate, sanitize, and type-check at every ingress point — APIs, file uploads, message queues, user input.

---

# Part IV — Testing & Acceptance

> "It compiles" is not "it works." "It works on my machine" is not "it is done." Done means a human — or a browser — tried it and it behaved correctly.

## 1. The Acceptance Standard

**Done means verified, not deployed.**
A feature is not complete when the code is written or when the build passes. It is complete when the expected user behavior has been confirmed end-to-end, in an environment that resembles production.

**Every user-facing change requires a corresponding verification.**
If a human would notice the change, an automated test (or an explicit manual verification step) must confirm it works. "I checked the logs" or "no build errors" does not count as verification of user-facing behavior.

**Verification must match the surface being changed.**

| Change type            | Minimum verification                                      |
| ---------------------- | --------------------------------------------------------- |
| Pure logic / algorithm | Unit test covering the behavior                           |
| API endpoint           | Integration test: real request → expected response        |
| CLI command            | Subprocess test: invoke → assert stdout/exit code         |
| Frontend UI            | Browser-based E2E test: load page → interact → assert DOM |
| Background agent cycle | Integration test through the full cycle, not just a unit  |

---

## 2. E2E Testing Is Non-Negotiable for Frontend

**Never accept "the dev server starts" as proof that the UI works.**
`npm run dev` exiting cleanly means the bundler is happy. It says nothing about whether the page renders, whether buttons respond, whether API calls succeed, or whether the layout is broken.

**Test frontend changes using a real browser — headed or headless.**
Use Playwright (preferred) or Puppeteer to drive a real browser against the running application. The browser must:

1. Navigate to the relevant URL
2. Assert that expected elements are present and visible
3. Interact with the UI (click, type, submit) as a user would
4. Assert that the resulting state is correct (DOM changes, API responses, error messages)

```ts
// Minimum viable E2E test for a new UI feature
test('task list renders and filters correctly', async ({ page }) => {
  await page.goto('http://localhost:5173/tasks');
  await expect(page.locator('[data-testid="task-list"]')).toBeVisible();
  await page.click('[data-testid="filter-pending"]');
  await expect(page.locator('[data-testid="task-item"]').first()).toContainText('pending');
});
```

**Use headless mode for CI; use headed mode to debug failures.**
Headless (`--headless`) is fast and CI-friendly. When a test fails and you can't tell why from the output, re-run it headed (without `--headless`) and watch the browser — it will show you exactly what went wrong.

```bash
# Headless (CI / standard run)
npx playwright test

# Headed (debugging — see the browser)
npx playwright test --headed
```

**Screenshot on failure is mandatory.**
Configure Playwright to capture a screenshot (and optionally a video) automatically when a test fails. A screenshot of a broken UI is worth a hundred lines of log output.

```ts
// playwright.config.ts
use: {
  screenshot: 'only-on-failure',
  video: 'retain-on-failure',
}
```

---

## 3. Test the Real Stack, Not a Mock of It

> General testing principles (AAA pattern, test behavior not implementation, one assertion per test) are in Part I §7. This section covers E2E-specific concerns only.

**E2E tests must run against the real application, not stubs.**
If the frontend calls an API, that API must be running during the E2E test. A test that mocks the entire backend proves nothing about the integrated system.

**Isolate test state, not test infrastructure.**
Use a dedicated test database or a seeded fixture — not mocks. The goal is a realistic environment with controlled, predictable data, not a fake one.

**Test user journeys, not internal function calls.**
A good E2E test navigates, clicks, and asserts on visible outcomes — the same things a user would notice. If the test still passes after a complete internal refactor, it is a good test.

---

## 4. Acceptance Checklist Before Marking Work Done

Before closing a task or opening a PR for any user-facing change, confirm:

- [ ] The feature behaves correctly in the browser (not just in the terminal)
- [ ] All new UI paths have at least one E2E test
- [ ] Failure cases are tested: what happens when the API returns an error? When input is invalid?
- [ ] No console errors or uncaught exceptions appear during normal usage
- [ ] The test suite passes (`npm test`, `pytest`, or equivalent) with no skipped E2E tests
- [ ] A screenshot or recording has been reviewed if the change is visual

**If a browser test cannot be written** (environment has no display, Playwright not installed), document the manual verification steps taken and flag the gap as a follow-up task — do not silently skip it.

---

## 5. Practical Tooling

**Playwright is the preferred E2E framework.**
It supports Chromium, Firefox, and WebKit; runs headless and headed; has excellent debugging tools (`--ui`, `--trace`); and integrates cleanly with CI.

**Set up once, run everywhere.**

```bash
# Install
npm install -D @playwright/test
npx playwright install chromium

# Run all E2E tests
npx playwright test

# Run with UI (interactive test runner)
npx playwright test --ui

# Show full trace for a failed test
npx playwright show-trace test-results/<test>/trace.zip
```

**Colocate E2E tests with the feature they test.**
Don't create a single monolithic `e2e/` folder for all tests. Mirror the structure of the application: `src/dashboard/` → `tests/e2e/dashboard.spec.ts`. This makes it obvious which tests cover which features and keeps test maintenance local to the feature.

**Keep E2E tests deterministic.**
Flaky tests are worse than no tests — they erode confidence and get disabled. Use `waitFor` and `expect(...).toBeVisible()` instead of arbitrary `sleep()`. Never rely on timing; rely on observable state.

---

# Part V — Project Specialized

Parts I–III are universal. This section records rules and decisions **specific to this project**.

This section defines how project documentation is organized and which documents are authoritative.

## Documentation Flow

Use `docs/` as the source of truth for project facts. `AGENTS.md` defines how to read and write that documentation, not the project details themselves.

- `docs/design/<module>.md` — authoritative current design
- `docs/proposals/` — ideas and pre-plan proposals awaiting a go/no-go decision
- `docs/plans/` — approved implementation work queue
- `docs/archive/` — completed plans, preserved as history

If content explains the project rather than the documentation workflow, it belongs in `docs/`.

## Authoritative Docs

Start here before making project-level changes:

- `docs/design/project.md` — mission, pillars, repository-wide conventions
- `docs/design/architecture.md` — runtime structure and cycle
- `docs/design/core.md` — models, constitution, directive
- `docs/design/execution.md` — planner, executor, verifier, safety, git workflow
- `docs/design/observability.md` — logs, audit trail, human review protocol
- `docs/design/evolution.md` — roadmap and long-range architecture

## Documentation Conventions

### Design Documents (`docs/design/`)

**Rule:** Every core module MUST have a design document in `docs/design/<module>.md`. The design doc is the authoritative reference for the module's purpose, data model, integration points, known limitations, and architectural decisions.
**Why:** Code explains how; design docs explain why. Without them, every non-trivial architectural decision has to be re-derived from reading the code.

**What belongs in a design doc:**

- Purpose and responsibilities
- Current design (data model, read/write paths, key algorithms)
- Known limitations
- Planned or in-progress changes (with links to `docs/plans/` for full specs)
- Integration points (who calls this module and how)
- Design constraints that must not be violated

**Current design docs:**

- `docs/design/project.md` — Mission, pillars, repository-wide conventions
- `docs/design/evolution.md` — Architecture evolution roadmap: five cognitive layers, phased plan
- `docs/design/architecture.md` — Module map, agent cycle, memory stack
- `docs/design/core.md` — Data models (Task, TaskPlan), constitution, directive
- `docs/design/llm.md` — LLM client protocol, ARK adapter, token tracking, audit logging, prompt templates
- `docs/design/storage.md` — TaskStore schema, task state machine, migrations
- `docs/design/observability.md` — Event system, LLM audit trail, human review protocol
- `docs/design/discovery.md` — Exploration strategies, interest profile, value scoring
- `docs/design/execution.md` — Planner, executor, verifier, git worktree isolation, NEEDS_HUMAN flow
- `docs/design/experience.md` — Long-term memory, recall, structured organization
- `docs/design/dashboard.md` — API endpoints, help center flow, frontend serving

### Proposals (`docs/proposals/`)

**Rule:** Ideas that are not yet approved for implementation MUST live in `docs/proposals/YYYY-MM-DD-<slug>.md`.
**Why:** Proposals need room for problem framing, trade-offs, and open questions without polluting `docs/design/` with designs that are not true yet or `docs/plans/` with work that has not been approved.

**Required proposal format:**

- Title: `# Proposal: <name>`
- Metadata block: `Status`, `Created`, `Decision`, `Scope`, `Next Step`, `Related`
- `## Summary` — 3-6 lines describing the idea and expected outcome
- `## Problem` — what gap or opportunity motivates the proposal
- `## Proposal` — the actual approach
- `## Why Now` or `## Expected Value` — why this is worth attention
- `## Risks and Open Questions` — unresolved issues that block planning
- `## Exit Criteria` — what must be true before this becomes a plan, is rejected, or is superseded

**Proposal statuses:**

- `Draft` — early idea, still being shaped
- `Review Needed` — ready for a go/no-go decision
- `Approved for Plan` — decision made; next step is to create a plan in `docs/plans/`
- `Rejected` — explicitly not proceeding
- `Superseded` — replaced by another proposal or plan

**Flow:**

- `proposal` — explore an idea and decide whether it is worth doing
- `plan` — define the approved implementation in detail
- `archive` — keep completed plans as historical record
- `design` — describe the current, implemented system

**Listing rule:** `docs/proposals/README.md` is the index of active proposals. Keep it ordered by status, then newest first within each status.

### Implementation Plans (`docs/plans/`)

**Rule:** Significant changes to existing modules or new subsystems MUST have an implementation plan in `docs/plans/YYYY-MM-DD-<slug>.md` before any code is written.
**Why:** Plans are written when context is fresh and scope is clear. They prevent scope creep during implementation and serve as a record of decisions made.

`docs/plans/` is a **work queue**: every file in it represents approved work that still needs to be done. Do not place pre-decision ideas here, and do not leave completed plans here.

### Plan Archive (`docs/archive/`)

**Rule:** When a plan is fully implemented and verified, move it from `docs/plans/` to `docs/archive/YYYY-MM-DD-<slug>.md`. Do not modify the content — move it as-is.
**Why:** `docs/plans/` must remain a clean work queue so the agent can treat its contents as actionable items without filtering. `docs/archive/` preserves the historical record of what was planned and decided, useful for understanding why things are the way they are.

**What belongs in archive:**

- Completed implementation plans (moved from `docs/plans/`)
- Nothing else — design docs stay in `docs/design/` regardless of completion status

## Immutable Guardrails

These stay in `AGENTS.md` because they must be visible at edit time, not only in downstream docs.

- `constitution.md` and `safety.py` are immutable and must never be modified
- New ideas belong in `docs/proposals/`, not `docs/design/` or `docs/plans/`
- Significant approved changes require a plan in `docs/plans/` before code is written
