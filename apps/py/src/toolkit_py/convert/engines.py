"""
Document conversion backends: markitdown + docling.

Auto-routing (for `engine="auto"`):
- PDF / DOCX / PPTX / XLSX → docling (better table + header structure)
- Everything else (HTML, images, audio, YouTube, ZIP, text, URLs)
  → markitdown (broader format coverage)

Both engines return plain markdown by default. Docling additionally supports
html / json output via the `format` arg.
"""

from __future__ import annotations

import io
import json
import time
from functools import lru_cache
from pathlib import Path
from typing import Literal

EngineChoice = Literal["auto", "markitdown", "docling"]
OutputFormat = Literal["markdown", "json", "html"]

# Extensions that docling handles best.
_DOCLING_EXTENSIONS = frozenset({"pdf", "docx", "pptx", "xlsx"})


def _ext(filename: str) -> str:
    if "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower()


def _pick_engine_for_file(filename: str) -> str:
    return "docling" if _ext(filename) in _DOCLING_EXTENSIONS else "markitdown"


# --- markitdown --------------------------------------------------------------


@lru_cache(maxsize=1)
def _markitdown():
    from markitdown import MarkItDown

    return MarkItDown()


def _markitdown_from_bytes(content: bytes, filename: str) -> str:
    md = _markitdown()
    stream = io.BytesIO(content)
    ext = _ext(filename)
    try:
        from markitdown import StreamInfo

        kwargs = {"stream_info": StreamInfo(extension=f".{ext}")} if ext else {}
        result = md.convert_stream(stream, **kwargs)
    except (ImportError, TypeError):
        # Older markitdown: no StreamInfo export, signature took
        # file_extension= positionally.
        stream.seek(0)
        result = md.convert_stream(stream, file_extension=f".{ext}" if ext else None)
    return str(result.text_content)


def _markitdown_from_url(url: str) -> str:
    result = _markitdown().convert(url)
    return str(result.text_content)


# --- docling -----------------------------------------------------------------


def _docling_output(doc, format_: OutputFormat) -> str:
    if format_ == "markdown":
        return str(doc.export_to_markdown())
    if format_ == "html":
        return str(doc.export_to_html())
    if format_ == "json":
        return json.dumps(doc.export_to_dict(), ensure_ascii=False)
    return str(doc.export_to_markdown())


# Module-level singleton — docling's DocumentConverter loads ~500 MB of
# layout / OCR / reading-order models at instantiation time. Rebuilding
# it on every request added ~40s of serialization-overhead latency per
# call, which dominates the actual conversion work. Cached via lru_cache
# so the first call pays the warmup cost once per sidecar process.
@lru_cache(maxsize=1)
def _docling_converter():
    from docling.document_converter import DocumentConverter

    return DocumentConverter()


def _docling_from_bytes(content: bytes, filename: str, format_: OutputFormat) -> str:
    from docling_core.types.io import DocumentStream

    stream = DocumentStream(name=filename, stream=io.BytesIO(content))
    result = _docling_converter().convert(stream)
    return _docling_output(result.document, format_)


def _docling_from_url(url: str, format_: OutputFormat) -> str:
    result = _docling_converter().convert(url)
    return _docling_output(result.document, format_)


# --- public entry points -----------------------------------------------------


def convert_bytes(
    content: bytes,
    filename: str,
    engine: EngineChoice,
    format_: OutputFormat,
) -> dict:
    start = time.perf_counter()
    chosen = _pick_engine_for_file(filename) if engine == "auto" else engine
    if chosen == "docling":
        text = _docling_from_bytes(content, filename, format_)
    elif chosen == "markitdown":
        text = _markitdown_from_bytes(content, filename)
    else:
        raise ValueError(f"unknown engine: {engine}")
    return {
        "markdown": text,
        "engine_used": chosen,
        "format": format_,
        "source": {"filename": filename, "bytes": len(content)},
        "duration_ms": int((time.perf_counter() - start) * 1000),
    }


def convert_url(
    url: str,
    engine: EngineChoice,
    format_: OutputFormat,
) -> dict:
    start = time.perf_counter()
    # For URLs `auto` defaults to markitdown — it handles HTML + YouTube +
    # audio URLs natively. Operators who specifically want docling's PDF
    # handling on a URL pointing at a PDF can pass engine="docling".
    chosen = "markitdown" if engine == "auto" else engine
    if chosen == "docling":
        text = _docling_from_url(url, format_)
    elif chosen == "markitdown":
        text = _markitdown_from_url(url)
    else:
        raise ValueError(f"unknown engine: {engine}")
    return {
        "markdown": text,
        "engine_used": chosen,
        "format": format_,
        "source": {"url": url},
        "duration_ms": int((time.perf_counter() - start) * 1000),
    }


def convert_local_path(
    path: str | Path,
    engine: EngineChoice,
    format_: OutputFormat,
) -> dict:
    """Convenience for tests/CLI work; mirrors `convert_bytes` via file load."""
    p = Path(path)
    return convert_bytes(p.read_bytes(), p.name, engine, format_)
