"""
Document conversion backends: trafilatura + markitdown + docling.

Auto-routing:
- URLs (HTML pages, news articles, blog posts) → trafilatura
    Precision-focused article-body extractor. Drops nav, footer,
    sidebars, ads, related-stories blocks. Returns just the article
    body as markdown along with metadata (title/author/date/sitename).
- PDF / DOCX / PPTX / XLSX files → docling (table + header structure)
- Everything else (raw HTML bytes, audio, YouTube, ZIP, text, images)
  → markitdown (broadest format coverage; transcribes everything)

`engine="markitdown"` keeps the legacy whole-page-transcription
behavior for URLs (useful for YouTube transcripts + audio URLs where
trafilatura doesn't apply). `engine="docling"` forces docling for
URL inputs that point at a PDF.

The stealth fetcher (`fetcher="stealth"`) routes through FlareSolverr
first, then hands the rendered HTML bytes to the chosen engine.
Trafilatura accepts HTML strings via `trafilatura.extract(html)`, so
it works on both the direct and stealth paths.

All engines return plain markdown by default. Docling additionally
supports html / json output via the `format` arg.
"""

from __future__ import annotations

import io
import json
import time
from functools import lru_cache
from pathlib import Path
from typing import Literal

EngineChoice = Literal["auto", "markitdown", "docling", "trafilatura"]
OutputFormat = Literal["markdown", "json", "html"]
FetcherChoice = Literal["direct", "stealth"]

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


# --- trafilatura -------------------------------------------------------------


def _trafilatura_extract_metadata(downloaded: str | None | bytes) -> dict:
    """Best-effort metadata extraction; never blocks the main path."""
    import trafilatura

    try:
        meta = trafilatura.extract_metadata(downloaded)
    except Exception:
        return {}
    if meta is None:
        return {}
    return {
        "title": meta.title,
        "author": meta.author,
        "date": meta.date,
        "sitename": meta.sitename,
        "categories": meta.categories,
        "tags": meta.tags,
    }


def _trafilatura_from_url(url: str) -> tuple[str, dict]:
    """
    Fetch a URL and extract just the article body as markdown.

    Uses trafilatura's built-in fetcher (follows redirects, respects
    basic robots.txt). For sites that hot-block scrapers, returns an
    error — the caller can retry with `fetcher="stealth"` which routes
    through FlareSolverr and feeds the rendered HTML to
    `_trafilatura_from_html_bytes`.

    `favor_precision=True` biases toward dropping borderline content
    rather than keeping it — appropriate for news where a few extra
    "related stories" links would muddy downstream summarization.
    """
    import trafilatura

    downloaded = trafilatura.fetch_url(url)
    if not downloaded:
        raise RuntimeError(
            f"trafilatura could not fetch {url} (blocked, paywalled, or non-HTML);"
            " retry with fetcher='stealth' to route through FlareSolverr"
        )
    text = trafilatura.extract(
        downloaded,
        output_format="markdown",
        include_comments=False,
        include_tables=True,
        favor_precision=True,
        with_metadata=False,
    )
    if not text:
        raise RuntimeError(
            f"trafilatura fetched {url} but extracted no article content"
            " (page may be a navigation index, a JS-rendered SPA, or paywalled)"
        )
    return str(text), _trafilatura_extract_metadata(downloaded)


def _trafilatura_from_html_bytes(content: bytes) -> tuple[str, dict]:
    """
    Extract article body from already-fetched HTML bytes. Used by the
    stealth path so FlareSolverr does the fetch and trafilatura does
    the extraction.
    """
    import trafilatura

    html_str = content.decode("utf-8", errors="replace")
    text = trafilatura.extract(
        html_str,
        output_format="markdown",
        include_comments=False,
        include_tables=True,
        favor_precision=True,
        with_metadata=False,
    )
    if not text:
        raise RuntimeError(
            "trafilatura extracted no article content from the fetched HTML"
            " (page may be a navigation index, a JS-rendered SPA after stealth render, or paywalled)"
        )
    return str(text), _trafilatura_extract_metadata(html_str)


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
    fetcher: FetcherChoice = "direct",
) -> dict:
    from .fetch import fetch_html

    start = time.perf_counter()
    # For URLs `auto` defaults to trafilatura — article-body extraction
    # is what callers actually want for news / blog / web pages.
    # markitdown's whole-page transcription dumped nav, ads, footer junk
    # into the output, which broke downstream LLM analysis. Operators
    # who want the old whole-page behavior can pass engine="markitdown";
    # PDF URLs should use engine="docling".
    chosen = "trafilatura" if engine == "auto" else engine

    metadata: dict = {}

    if fetcher == "direct":
        # Fast path — hand the URL to the engine and let its own HTTP
        # client do the fetch. trafilatura + markitdown + docling each
        # handle their own URL fetch.
        if chosen == "docling":
            text = _docling_from_url(url, format_)
        elif chosen == "markitdown":
            text = _markitdown_from_url(url)
        elif chosen == "trafilatura":
            text, metadata = _trafilatura_from_url(url)
        else:
            raise ValueError(f"unknown engine: {engine}")
    else:
        # Stealth path — fetch via FlareSolverr first (so CF / WAF
        # challenges get solved), then feed the resulting HTML bytes
        # through the chosen engine. The engine never sees the URL —
        # only the rendered HTML — so markitdown's URL-specific handlers
        # (YouTube transcript, audio transcription) won't fire on this
        # path. That's intentional: if you need those, use fetcher="direct".
        fetched = fetch_html(url, fetcher="stealth")
        # FlareSolverr returns HTML regardless of the actual URL type —
        # give the engine a filename hint so byte-based engines dispatch
        # to the HTML parser, not some other format guess.
        synthetic_name = _synthetic_filename_for_url(url, fetched.content_type)
        if chosen == "docling":
            text = _docling_from_bytes(fetched.content, synthetic_name, format_)
        elif chosen == "markitdown":
            text = _markitdown_from_bytes(fetched.content, synthetic_name)
        elif chosen == "trafilatura":
            text, metadata = _trafilatura_from_html_bytes(fetched.content)
        else:
            raise ValueError(f"unknown engine: {engine}")

    out: dict = {
        "markdown": text,
        "engine_used": chosen,
        "fetcher_used": fetcher,
        "format": format_,
        "source": {"url": url},
        "duration_ms": int((time.perf_counter() - start) * 1000),
    }
    if metadata:
        out["metadata"] = metadata
    return out


def _synthetic_filename_for_url(url: str, content_type: str) -> str:
    """Fabricate a filename so byte-based engines pick the HTML parser.

    FlareSolverr always returns HTML (the rendered page), so extension
    sniffing against the original URL (`.pdf`, `.docx`, …) would mislead
    the engine. Prefer `.html` unless the response content-type says
    otherwise.
    """
    ct = (content_type or "").lower()
    if "html" in ct or not ct:
        return "page.html"
    if "json" in ct:
        return "page.json"
    if "xml" in ct:
        return "page.xml"
    return "page.txt"


def convert_local_path(
    path: str | Path,
    engine: EngineChoice,
    format_: OutputFormat,
) -> dict:
    """Convenience for tests/CLI work; mirrors `convert_bytes` via file load."""
    p = Path(path)
    return convert_bytes(p.read_bytes(), p.name, engine, format_)
