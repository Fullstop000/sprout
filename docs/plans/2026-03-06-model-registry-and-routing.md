# 2026-03-06 Model Registry And Routing

## Context

The current V2 runtime reads one LLM configuration from environment variables in
`src/llm247_v2/__main__.py` and injects a single `ArkLLMClient` everywhere.
That blocks two user-facing requirements:

1. Dashboard users cannot register multiple models with different endpoint
   settings, model names, and API keys.
2. Different runtime call sites cannot be bound to different models.

The repository `README.md` references design docs under `docs/design/`, but
those files are not present on this branch. This plan is the authoritative
record for the feature implementation in this branch.

## Goals

- Support dashboard-driven model registration with these fields:
  - model type: `embedding` or `llm`
  - `base_url` for `llm` models
  - `api_path` for `embedding` models
  - model name
  - API key
- Define explicit runtime model binding points for current LLM usage.
- Allow dashboard users to bind each runtime point to one registered model.
- Use the latest registered `llm` model as the default fallback when no binding
  exists.

## Non-Goals

- Implement new embedding call paths in the agent runtime.
- Replace directive storage with model configuration storage.
- Migrate secrets to an external secret manager in this task.

## Design

### Data model

Add a dedicated SQLite-backed model registry store under `.llm247_v2/models.db`.

Tables:

- `registered_models`
  - `id`
  - `model_type`
  - `base_url`
  - `api_path`
  - `model_name`
  - `api_key`
  - `created_at`
  - `updated_at`
- `model_bindings`
  - `binding_point`
  - `model_id`
  - `updated_at`

### Binding points

Create explicit binding points for the current LLM call sites:

- `planning`
- `task_value`
- `discovery_generation`
- `interest_driven_discovery`
- `web_search_discovery`
- `learning_extraction`
- `experience_merge`

Each binding point only accepts `llm` models for now. The registry still allows
`embedding` models so the dashboard can manage them ahead of runtime adoption.

### Runtime routing

Introduce a routing layer that resolves a model by binding point:

- If a binding exists, create or reuse a client for the registered model.
- If no binding exists, use the latest registered default LLM client.
- Audit logging and token tracking remain attached to the concrete client used
  for the call.

Business code should depend on named binding points instead of directly sharing
one global client instance.

### Dashboard

Add backend APIs to:

- list registered models and binding point metadata
- register a model
- update binding selections

Add a dashboard page with:

- a registration form
- a registered model table
- one dropdown per binding point

## Verification

- Python unit tests for:
  - model registry persistence
  - binding persistence
  - routing fallback and bound-model selection
  - dashboard model APIs
- Frontend lint/build validation after UI changes.
