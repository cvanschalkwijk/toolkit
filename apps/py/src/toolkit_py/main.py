"""
FastAPI sidecar exposing category-specific endpoints:

- /convert/file, /convert/url  (conversion — markitdown + docling)
- /chunk                        (chunking — sentence-transformers + jina-v3)
- /sanitize                     (sanitization — Microsoft Presidio)
- /extract                      (structured extraction — Instructor)
- /health                       (always available)

Lazy imports: each endpoint imports its category module inside the handler,
so a sidecar built with a subset of optional-deps still boots. Missing
categories surface as HTTP 501 with a clear "install extras" message.
"""

from __future__ import annotations

import asyncio
from typing import Annotated, Any, Literal

from fastapi import FastAPI, File, Form, UploadFile
from pydantic import BaseModel, Field

from . import __version__
from .errors import CategoryNotInstalled, map_exception

app = FastAPI(
    title="toolkit-py",
    version=__version__,
    description=(
        "Python sidecar for the toolkit HTTP + MCP API. Internal-only; "
        "not intended to be hit directly by end users."
    ),
)


# --- Health ------------------------------------------------------------------


def _probe(required: list[str]) -> str:
    """
    Report a category as `ready` only when every required engine library is
    importable. Uses find_spec so we don't pay the import cost on every
    health check.
    """
    from importlib.util import find_spec

    missing = [name for name in required if find_spec(name) is None]
    if not missing:
        return "ready"
    return f"not_installed (missing: {', '.join(missing)})"


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "version": __version__,
        "categories": {
            "convert": _probe(["markitdown", "docling"]),
            "chunk": _probe(["sentence_transformers", "langchain_experimental", "torch"]),
            "sanitize": _probe(["presidio_analyzer", "presidio_anonymizer", "spacy"]),
            "extract": _probe(["instructor", "openai"]),
        },
    }


# --- Convert -----------------------------------------------------------------

EngineChoice = Literal["auto", "markitdown", "docling"]
OutputFormat = Literal["markdown", "json", "html"]


class ConvertUrlRequest(BaseModel):
    url: str = Field(..., description="Absolute URL to fetch and convert.")
    engine: EngineChoice = Field("auto")
    format: OutputFormat = Field("markdown")


@app.post("/convert/file")
async def convert_file(
    file: Annotated[UploadFile, File(description="The document to convert.")],
    engine: Annotated[EngineChoice, Form()] = "auto",
    format: Annotated[OutputFormat, Form()] = "markdown",
) -> dict:
    try:
        from .convert import engines
    except ImportError as e:
        raise map_exception(CategoryNotInstalled("convert")) from e

    content = await file.read()
    filename = file.filename or "upload"
    try:
        return await asyncio.to_thread(
            engines.convert_bytes, content, filename, engine, format
        )
    except Exception as e:  # noqa: BLE001
        raise map_exception(e) from e


@app.post("/convert/url")
async def convert_url(body: ConvertUrlRequest) -> dict:
    try:
        from .convert import engines
    except ImportError as e:
        raise map_exception(CategoryNotInstalled("convert")) from e

    try:
        return await asyncio.to_thread(
            engines.convert_url, body.url, body.engine, body.format
        )
    except Exception as e:  # noqa: BLE001
        raise map_exception(e) from e


# --- Chunk -------------------------------------------------------------------

ChunkStrategy = Literal["semantic", "late", "fixed"]


class ChunkRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=1_000_000)
    strategy: ChunkStrategy = Field("semantic")
    # Shared tunables; only relevant subsets used per strategy.
    min_chunk_size: int = Field(200, ge=1, le=100_000)
    max_chunk_size: int = Field(2000, ge=1, le=200_000)
    breakpoint_percentile: int = Field(95, ge=50, le=99)
    chunk_size: int = Field(512, ge=1, le=100_000)
    overlap: int = Field(50, ge=0, le=10_000)
    embedding_model: str | None = Field(None)


@app.post("/chunk")
async def chunk(body: ChunkRequest) -> dict:
    try:
        if body.strategy == "semantic":
            from .chunk import semantic as strategy
        elif body.strategy == "late":
            from .chunk import late as strategy
        else:
            from .chunk import fixed as strategy  # type: ignore[no-redef]
    except ImportError as e:
        raise map_exception(CategoryNotInstalled("chunk")) from e

    try:
        return await asyncio.to_thread(strategy.run, body.model_dump())
    except Exception as e:  # noqa: BLE001
        raise map_exception(e) from e


# --- Sanitize ----------------------------------------------------------------

AnonMode = Literal["redact", "replace", "hash", "mask"]


class SanitizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=1_000_000)
    entities: list[str] | None = Field(
        None,
        description=(
            "Which PII entity types to redact. If omitted, Presidio's default "
            "built-in recognizer set is used (EMAIL_ADDRESS, PHONE_NUMBER, "
            "CREDIT_CARD, SSN, PERSON, IP_ADDRESS, LOCATION, etc)."
        ),
    )
    anonymization: AnonMode = Field("redact")
    language: str = Field("en")


@app.post("/sanitize/text")
async def sanitize_text(body: SanitizeRequest) -> dict:
    try:
        from .sanitize import presidio_runner
    except ImportError as e:
        raise map_exception(CategoryNotInstalled("sanitize")) from e

    try:
        return await asyncio.to_thread(presidio_runner.run, body.model_dump())
    except Exception as e:  # noqa: BLE001
        raise map_exception(e) from e


# --- Extract -----------------------------------------------------------------


class ExtractRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=1_000_000)
    schema_: dict[str, Any] = Field(
        ...,
        alias="schema",
        description="JSON Schema object describing the desired output structure.",
    )
    model: str | None = Field(
        None,
        description="LLM model ID override. Defaults to env LLM_DEFAULT_MODEL.",
    )
    system_prompt: str | None = Field(None)
    max_retries: int = Field(2, ge=0, le=10)
    temperature: float = Field(0.1, ge=0.0, le=2.0)

    model_config = {"populate_by_name": True}


@app.post("/extract/structured")
async def extract_structured(body: ExtractRequest) -> dict:
    try:
        from .extract import instructor_runner
    except ImportError as e:
        raise map_exception(CategoryNotInstalled("extract")) from e

    try:
        return await asyncio.to_thread(
            instructor_runner.run,
            body.model_dump(by_alias=True),
        )
    except Exception as e:  # noqa: BLE001
        raise map_exception(e) from e
