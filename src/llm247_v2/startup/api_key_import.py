from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from llm247_v2.core.models import ModelType
from llm247_v2.core.models import RegisteredModel
from llm247_v2.storage.model_registry import ModelRegistryStore


@dataclass(frozen=True)
class ApiKeyImportEntry:
    alias: str
    model_type: str
    model_name: str
    endpoint: str
    api_key: str
    desc: str = ""
    roocode_wrapper: bool = False


def _parse_scalar(raw: str) -> str:
    value = raw.strip()
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    return value


def _parse_bool(raw: str) -> bool:
    return _parse_scalar(raw).strip().lower() in {"1", "true", "yes", "on"}


def parse_api_key_yaml(path: Path) -> list[ApiKeyImportEntry]:
    current_alias = ""
    current_fields: dict[str, str] = {}
    entries: list[ApiKeyImportEntry] = []

    def flush_current() -> None:
        nonlocal current_alias, current_fields
        if not current_alias:
            return
        model_type = _parse_scalar(current_fields.get("type", ModelType.LLM.value)).lower()
        model_name = _parse_scalar(current_fields.get("model", ""))
        endpoint = _parse_scalar(current_fields.get("entrypoint", current_fields.get("endpoint", "")))
        api_key = _parse_scalar(current_fields.get("ak", current_fields.get("api_key", "")))
        desc = _parse_scalar(current_fields.get("desc", ""))
        roocode_wrapper = _parse_bool(current_fields.get("roocode_wrapper", "false"))

        if not model_name or not endpoint or not api_key:
            raise ValueError(f"incomplete api key entry: {current_alias}")

        entries.append(
            ApiKeyImportEntry(
                alias=current_alias,
                model_type=model_type,
                model_name=model_name,
                endpoint=endpoint,
                api_key=api_key,
                desc=desc,
                roocode_wrapper=roocode_wrapper,
            )
        )
        current_alias = ""
        current_fields = {}

    for lineno, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        if not raw_line.startswith((" ", "\t")):
            flush_current()
            if not stripped.endswith(":"):
                raise ValueError(f"line {lineno}: expected top-level '<alias>:' entry")
            current_alias = stripped[:-1].strip()
            current_fields = {}
            continue

        if not current_alias:
            raise ValueError(f"line {lineno}: nested field without parent entry")
        if ":" not in stripped:
            raise ValueError(f"line {lineno}: expected 'key: value'")
        key, value = stripped.split(":", 1)
        current_fields[key.strip()] = value.strip()

    flush_current()
    return entries


def import_api_key_file(model_store: ModelRegistryStore, path: Path) -> list[RegisteredModel]:
    imported: list[RegisteredModel] = []
    for entry in parse_api_key_yaml(path):
        existing = _find_existing_model(model_store, entry)
        payload = {
            "model_type": entry.model_type,
            "model_name": entry.model_name,
            "api_key": entry.api_key,
            "desc": entry.desc,
            "roocode_wrapper": entry.roocode_wrapper,
            "base_url": entry.endpoint if entry.model_type == ModelType.LLM.value else "",
            "api_path": entry.endpoint if entry.model_type == ModelType.EMBEDDING.value else "",
        }
        if existing:
            imported.append(model_store.update_model(existing.id, **payload))
        else:
            imported.append(model_store.register_model(**payload))
    return imported


def _find_existing_model(model_store: ModelRegistryStore, entry: ApiKeyImportEntry) -> RegisteredModel | None:
    for model in model_store.list_models(model_type=entry.model_type):
        endpoint = model.base_url if entry.model_type == ModelType.LLM.value else model.api_path
        if endpoint == entry.endpoint and model.model_name == entry.model_name:
            return model
    return None
