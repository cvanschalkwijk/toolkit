"""
Structured extraction via Instructor + any OpenAI-compatible LLM endpoint.

The caller hands us a JSON Schema describing the shape they want; we build
an equivalent Pydantic model dynamically at runtime, hand it to Instructor
as the `response_model`, and let Instructor's retry loop enforce schema
adherence.

Env vars:
  - LLM_BASE_URL        OpenAI-compatible base URL (required)
  - LLM_API_KEY         API key (required)
  - LLM_DEFAULT_MODEL   Model ID default; caller can override per request
"""

from __future__ import annotations

import os
import time
from typing import Any, Literal

from pydantic import BaseModel, Field, create_model


# --- JSON Schema → Pydantic ---------------------------------------------------

_PRIMITIVE_TYPES: dict[str, Any] = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
    "null": type(None),
}


def _schema_to_type(schema: dict[str, Any], name_hint: str = "Field") -> Any:
    """
    Convert a JSON Schema fragment into a Python / Pydantic type annotation.

    Supports:
      - primitive types (string, integer, number, boolean, null)
      - string `enum`s → Literal[...]
      - `array` with a single `items` schema → list[<inner>]
      - `object` with `properties` → nested dynamically-created model
      - top-level `type` as a list (e.g. ["string","null"]) → union/optional
      - `anyOf` / `oneOf` → union of each branch
    """
    # Union via type-list
    t = schema.get("type")
    if isinstance(t, list):
        members = []
        for sub_t in t:
            if sub_t == "null":
                members.append(type(None))
            else:
                members.append(_schema_to_type({**schema, "type": sub_t}, name_hint))
        # Collapse to Optional if only one non-null
        non_null = [m for m in members if m is not type(None)]
        if len(non_null) == 1 and type(None) in members:
            return non_null[0] | None
        # Broad union fallback
        union_type = members[0]
        for m in members[1:]:
            union_type = union_type | m
        return union_type

    # anyOf / oneOf — union of each branch
    for key in ("anyOf", "oneOf"):
        if key in schema:
            branches = [
                _schema_to_type(sub, f"{name_hint}Alt{idx}")
                for idx, sub in enumerate(schema[key])
            ]
            u = branches[0]
            for b in branches[1:]:
                u = u | b
            return u

    # enum (on strings; others passthrough)
    if "enum" in schema and (t == "string" or t is None):
        literals = tuple(schema["enum"])
        return Literal[literals]  # type: ignore[valid-type]

    if t == "array":
        item_schema = schema.get("items", {})
        return list[_schema_to_type(item_schema, f"{name_hint}Item")]

    if t == "object":
        return _schema_to_model(schema, name_hint)

    if t in _PRIMITIVE_TYPES:
        return _PRIMITIVE_TYPES[t]

    # Unknown / missing type — fall back to Any.
    return Any


def _schema_to_model(schema: dict[str, Any], name: str) -> type[BaseModel]:
    props: dict[str, Any] = schema.get("properties", {})
    required: list[str] = list(schema.get("required", []))
    fields: dict[str, Any] = {}
    for field_name, sub in props.items():
        annotation = _schema_to_type(sub, field_name.capitalize())
        description = sub.get("description")
        if field_name in required:
            fields[field_name] = (annotation, Field(..., description=description))
        else:
            fields[field_name] = (annotation | None, Field(None, description=description))
    return create_model(name, **fields)  # type: ignore[call-overload]


# --- Runner -------------------------------------------------------------------


def _require_env(name: str) -> str:
    v = os.environ.get(name, "").strip()
    if not v:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=501,
            detail={
                "message": (
                    f"{name} is not configured. "
                    f"Set LLM_BASE_URL + LLM_API_KEY to use extract_structured."
                ),
                "category": "extract",
            },
        )
    return v


def run(params: dict) -> dict:
    text: str = params["text"]
    schema: dict[str, Any] = params["schema"]
    # Swagger UI pre-fills "string" into optional fields; treat that as unset.
    raw_model = (params.get("model") or "").strip()
    model_override: str | None = raw_model if raw_model and raw_model != "string" else None
    system_prompt: str = params.get("system_prompt") or (
        "You extract structured data from text. Return only values that are "
        "explicitly stated or can be directly inferred from the input. "
        "Omit optional fields when the information is not present."
    )
    max_retries: int = int(params.get("max_retries", 2))
    temperature: float = float(params.get("temperature", 0.1))

    base_url = _require_env("LLM_BASE_URL")
    api_key = _require_env("LLM_API_KEY")
    model_id = model_override or os.environ.get("LLM_DEFAULT_MODEL", "").strip()
    if not model_id:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=400,
            detail={
                "message": (
                    "No model specified. Pass `model` in the request or set "
                    "LLM_DEFAULT_MODEL on the sidecar."
                ),
            },
        )

    import instructor
    from openai import OpenAI

    client = instructor.from_openai(OpenAI(base_url=base_url, api_key=api_key))
    response_model = _schema_to_model(schema, "ExtractTarget")

    start = time.perf_counter()
    # Instructor runs the retry loop internally; attempts count is best-effort
    # via max_retries + 1 (the initial try).
    data = client.chat.completions.create(
        model=model_id,
        response_model=response_model,
        max_retries=max_retries,
        temperature=temperature,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": text},
        ],
    )

    return {
        "data": data.model_dump(exclude_none=True),
        "model_used": model_id,
        "max_retries": max_retries,
        "duration_ms": int((time.perf_counter() - start) * 1000),
    }
