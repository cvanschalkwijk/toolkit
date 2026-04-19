"""
Structured extraction tests.

Schema → Pydantic conversion is exercised without any LLM calls.
The end-to-end instructor flow is mocked via `respx` so no real LLM
endpoint is required to run CI.
"""

from __future__ import annotations

import pytest


def test_schema_to_model_primitives() -> None:
    from toolkit_py.extract.instructor_runner import _schema_to_model

    schema = {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "age": {"type": "integer"},
            "height_m": {"type": "number"},
            "verified": {"type": "boolean"},
        },
        "required": ["name"],
    }
    Model = _schema_to_model(schema, "Person")
    # Instantiating with required field works.
    m = Model(name="Ada", age=36, verified=True)
    assert m.name == "Ada"
    assert m.age == 36
    assert m.verified is True


def test_schema_to_model_enum_and_optional() -> None:
    from toolkit_py.extract.instructor_runner import _schema_to_model

    schema = {
        "type": "object",
        "properties": {
            "status": {"type": "string", "enum": ["draft", "live", "archived"]},
            "published_year": {"type": ["integer", "null"]},
        },
        "required": ["status"],
    }
    Model = _schema_to_model(schema, "Doc")
    m = Model(status="live")
    assert m.status == "live"
    # Invalid enum member rejected.
    with pytest.raises(Exception):
        Model(status="NOT_A_STATUS")


def test_schema_to_model_array_and_nested_object() -> None:
    from toolkit_py.extract.instructor_runner import _schema_to_model

    schema = {
        "type": "object",
        "properties": {
            "tags": {"type": "array", "items": {"type": "string"}},
            "author": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "affiliation": {"type": "string"},
                },
                "required": ["name"],
            },
        },
        "required": ["tags", "author"],
    }
    Model = _schema_to_model(schema, "Post")
    m = Model(tags=["a", "b"], author={"name": "Ada"})
    assert m.tags == ["a", "b"]
    assert m.author.name == "Ada"


def test_run_requires_llm_env(monkeypatch: pytest.MonkeyPatch) -> None:
    pytest.importorskip("instructor")
    pytest.importorskip("openai")
    from toolkit_py.extract import instructor_runner

    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        instructor_runner.run(
            {
                "text": "anything",
                "schema": {"type": "object", "properties": {"x": {"type": "string"}}},
            }
        )
    assert exc.value.status_code == 501


def test_run_requires_model(monkeypatch: pytest.MonkeyPatch) -> None:
    pytest.importorskip("instructor")
    pytest.importorskip("openai")
    from toolkit_py.extract import instructor_runner

    monkeypatch.setenv("LLM_BASE_URL", "http://mock/v1")
    monkeypatch.setenv("LLM_API_KEY", "test")
    monkeypatch.delenv("LLM_DEFAULT_MODEL", raising=False)

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        instructor_runner.run(
            {
                "text": "x",
                "schema": {"type": "object", "properties": {"x": {"type": "string"}}},
            }
        )
    assert exc.value.status_code == 400


def test_run_extracts_against_mocked_llm(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """
    Full end-to-end with a mocked OpenAI-compat endpoint via respx.
    Verifies the schema→model pipeline produces valid structured output.
    """
    pytest.importorskip("instructor")
    pytest.importorskip("openai")
    respx = pytest.importorskip("respx")

    monkeypatch.setenv("LLM_BASE_URL", "http://mock/v1")
    monkeypatch.setenv("LLM_API_KEY", "test")
    monkeypatch.setenv("LLM_DEFAULT_MODEL", "mock-gpt")

    from toolkit_py.extract import instructor_runner

    schema = {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "occupation": {"type": "string"},
            "birth_year": {"type": "integer"},
        },
        "required": ["name", "occupation", "birth_year"],
    }

    # Instructor with tools/function-calling produces a tool_calls response.
    # Respond with a well-formed chat.completions response that Instructor
    # can successfully parse into our schema.
    mock_response = {
        "id": "mock",
        "object": "chat.completion",
        "created": 0,
        "model": "mock-gpt",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {
                                "name": "ExtractTarget",
                                "arguments": (
                                    '{"name": "Ada Lovelace", '
                                    '"occupation": "mathematician", '
                                    '"birth_year": 1815}'
                                ),
                            },
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ],
        "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
    }

    with respx.mock(base_url="http://mock/v1") as mock:
        mock.post("/chat/completions").respond(200, json=mock_response)
        result = instructor_runner.run(
            {
                "text": "Ada Lovelace was a mathematician born in 1815.",
                "schema": schema,
            }
        )

    assert result["data"] == {
        "name": "Ada Lovelace",
        "occupation": "mathematician",
        "birth_year": 1815,
    }
    assert result["model_used"] == "mock-gpt"
