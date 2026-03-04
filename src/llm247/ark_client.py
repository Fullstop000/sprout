from __future__ import annotations

from typing import Any, List

from llm247.token_usage import record_token_usage


class BudgetExhaustedError(RuntimeError):
    """Raised when model provider reports exhausted quota or token budget."""


class ArkModelClient:
    """Thin adapter for Ark-compatible Responses API."""

    def __init__(self, api_key: str, base_url: str, model: str) -> None:
        try:
            from openai import OpenAI
        except ModuleNotFoundError as error:  # pragma: no cover - dependency guard
            raise RuntimeError(
                "openai package is required, run: python3 -m pip install -r requirements.txt"
            ) from error

        self.client = OpenAI(base_url=base_url, api_key=api_key)
        self.model = model

    def generate_text(self, prompt: str) -> str:
        """Generate plain text from one user prompt."""
        try:
            response = self.client.responses.create(
                model=self.model,
                input=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_text",
                                "text": prompt,
                            }
                        ],
                    }
                ],
            )
        except Exception as error:
            if is_budget_exhausted_error(error):
                raise BudgetExhaustedError(str(error)) from error
            raise

        input_tokens, output_tokens, total_tokens = extract_response_usage(response)
        record_token_usage(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
        )

        text = extract_response_text(response)
        if not text.strip():
            raise RuntimeError("empty model response")
        return text


# Extract best-effort text across SDK response shape variants.
def extract_response_text(response: Any) -> str:
    """Extract output text from a Responses API object."""
    direct = getattr(response, "output_text", None)
    if isinstance(direct, str) and direct.strip():
        return direct

    collected: List[str] = []
    for output_item in getattr(response, "output", []) or []:
        for content_item in getattr(output_item, "content", []) or []:
            content_type = getattr(content_item, "type", "")
            if content_type in {"output_text", "text"}:
                text = getattr(content_item, "text", "")
                if text:
                    collected.append(text)

    return "\n".join(collected)


# Extract best-effort token usage across SDK response variants.
def extract_response_usage(response: Any) -> tuple[int, int, int]:
    """Extract input/output/total token usage from a Responses API object."""
    usage = getattr(response, "usage", None)
    if usage is None:
        return 0, 0, 0

    if isinstance(usage, dict):
        input_tokens = _to_int(usage.get("input_tokens", 0))
        output_tokens = _to_int(usage.get("output_tokens", 0))
        total_tokens = _to_int(usage.get("total_tokens", 0))
        if total_tokens <= 0:
            total_tokens = input_tokens + output_tokens
        return input_tokens, output_tokens, total_tokens

    input_tokens = _to_int(getattr(usage, "input_tokens", 0))
    output_tokens = _to_int(getattr(usage, "output_tokens", 0))
    total_tokens = _to_int(getattr(usage, "total_tokens", 0))
    if total_tokens <= 0:
        total_tokens = input_tokens + output_tokens

    return input_tokens, output_tokens, total_tokens


# Detect provider-level insufficient quota/token signals from exception text.
def is_budget_exhausted_error(error: Exception) -> bool:
    """Return True if an API error indicates exhausted budget or credits."""
    message = f"{type(error).__name__}: {error}".lower()
    keywords = {
        "insufficient_quota",
        "quota exceeded",
        "exceeded your current quota",
        "billing hard limit",
        "not enough balance",
        "credit balance",
        "token budget exhausted",
        "配额",
        "余额不足",
        "额度不足",
        "token耗尽",
    }
    return any(keyword in message for keyword in keywords)


def _to_int(value: object) -> int:
    """Convert token values to non-negative integers safely."""
    try:
        converted = int(value)
    except (TypeError, ValueError):
        return 0
    return max(0, converted)
