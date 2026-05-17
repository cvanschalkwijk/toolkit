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


# Minimum markdown length we'll accept as "looks like a real article."
# Empirically calibrated against The Motley Fool's template family,
# which renders the article body in an unconventional wrapper that
# precision-mode dismisses and recall-mode catches only the boilerplate
# preamble (~400 chars of "Stock prices used were…" + footer). Real
# article bodies on our financial-news sources are essentially never
# shorter than ~1500 chars — anything shorter is almost certainly a
# fragment (bio, video description, related-stories teaser) and should
# bump us down the fallback chain.
_TRAFILATURA_MIN_OUTPUT = 1500

ExtractionTier = Literal[
    "trafilatura_precision",
    "trafilatura_recall",
    "markitdown_fallback",
]


def _trafilatura_extract_text(html: str) -> tuple[str | None, ExtractionTier | None]:
    """
    Two-pass trafilatura extraction with a length-based fallback.

    Returns `(text, tier)` where `tier` identifies which pass produced
    the result — useful for telemetry and for the caller to advertise
    "extraction quality" in API responses.

    Pass 1 — `favor_precision=True`: aggressive dropping of borderline
        content. Gives the cleanest output when it works.
    Pass 2 — `favor_recall=True`: more inclusive. Tries when pass 1's
        output is too short (caught the bio block, etc.).

    Returns `(None, None)` when both passes still produce something too
    short to plausibly be an article — caller falls back to markitdown.
    """
    import trafilatura

    text = trafilatura.extract(
        html,
        output_format="markdown",
        include_comments=False,
        include_tables=True,
        favor_precision=True,
        with_metadata=False,
    )
    if text and len(text) >= _TRAFILATURA_MIN_OUTPUT:
        return str(text), "trafilatura_precision"

    # Pass 1 produced nothing usable. Retry with recall-favored
    # settings; this picks up article bodies wrapped in unconventional
    # divs that precision dismisses.
    recall = trafilatura.extract(
        html,
        output_format="markdown",
        include_comments=False,
        include_tables=True,
        favor_recall=True,
        with_metadata=False,
    )
    if recall and len(recall) >= _TRAFILATURA_MIN_OUTPUT:
        return str(recall), "trafilatura_recall"
    return None, None


def _extract_body_html(html: str | bytes) -> str | None:
    """
    Return the inner-HTML of the page's `<body>` tag.

    Cheap regex extraction — no lxml dependency on the hot path. Used
    when the caller passes `include_body_html=True` so downstream
    consumers can cache the raw page HTML alongside the cleaned
    markdown for future re-extraction or richer post-processing.

    Returns None when no `<body>` tag is present (response was a JSON
    fragment, etc.) — caller decides whether to return the whole input
    as a fallback.
    """
    import re

    text = html.decode("utf-8", errors="replace") if isinstance(html, bytes) else html
    m = re.search(r"<body\b[^>]*>(.*?)</body\s*>", text, re.IGNORECASE | re.DOTALL)
    if m:
        return m.group(1).strip()
    return None


def _trafilatura_from_url(url: str, include_body_html: bool = False) -> tuple[str, dict]:
    """
    Fetch a URL and extract just the article body as markdown.

    Uses trafilatura's built-in fetcher. Two-pass extraction
    (precision → recall); if both produce < _TRAFILATURA_MIN_OUTPUT
    chars, falls back to markitdown. The fallback returns whole-page
    transcription with chrome — preferable to silently caching a
    byline / author-bio fragment.

    The returned metadata dict carries:
      - title/author/date/sitename/categories/tags (from trafilatura)
      - extraction_tier: which pass produced the markdown
        ("trafilatura_precision" | "trafilatura_recall" | "markitdown_fallback")
      - body_html: opt-in, the inner-HTML of the page's <body> tag.
        Lets downstream consumers cache the raw HTML for future
        re-extraction. Off by default to keep response sizes small.
    """
    import trafilatura

    downloaded = trafilatura.fetch_url(url)
    if not downloaded:
        raise RuntimeError(
            f"trafilatura could not fetch {url} (blocked, paywalled, or non-HTML);"
            " retry with fetcher='stealth' to route through FlareSolverr"
        )

    base_meta: dict = _trafilatura_extract_metadata(downloaded)
    if include_body_html:
        base_meta = {**base_meta, "body_html": _extract_body_html(downloaded)}

    text, tier = _trafilatura_extract_text(downloaded)
    if text and tier:
        return text, {**base_meta, "extraction_tier": tier}

    # Neither precision nor recall produced enough content — fall back
    # to markitdown's whole-page transcription so we have *something*
    # cached.
    fallback = _markitdown_from_url(url)
    if fallback:
        return fallback, {**base_meta, "extraction_tier": "markitdown_fallback"}

    # Even markitdown came up empty (JS-rendered SPA, paywall splash,
    # 1×1 tracker pixel, etc.). Don't 500 here — return the raw
    # body_html (when the caller asked for it) with an
    # `empty_all_engines` tier so downstream consumers can attempt
    # LLM-based recovery against the raw HTML, or fall back to
    # fetcher='stealth' for a JS-rendered render. Throwing would
    # discard the page entirely and lose the body_html we already
    # fetched.
    return "", {**base_meta, "extraction_tier": "empty_all_engines"}


def _trafilatura_from_html_bytes(
    content: bytes,
    include_body_html: bool = False,
) -> tuple[str, dict]:
    """
    Extract article body from already-fetched HTML bytes (stealth path).
    Same two-pass + markitdown-fallback policy as `_trafilatura_from_url`,
    plus opt-in body_html in the returned metadata.
    """
    html_str = content.decode("utf-8", errors="replace")

    base_meta: dict = _trafilatura_extract_metadata(html_str)
    if include_body_html:
        base_meta = {**base_meta, "body_html": _extract_body_html(html_str)}

    text, tier = _trafilatura_extract_text(html_str)
    if text and tier:
        return text, {**base_meta, "extraction_tier": tier}

    fallback = _markitdown_from_bytes(content, "page.html")
    if fallback:
        return fallback, {**base_meta, "extraction_tier": "markitdown_fallback"}

    # All engines empty on the stealth-fetched HTML too. Same
    # treatment as the direct path: surface `empty_all_engines` with
    # body_html so the caller can attempt LLM recovery instead of
    # losing the page entirely.
    return "", {**base_meta, "extraction_tier": "empty_all_engines"}


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
    include_body_html: bool = False,
) -> dict:
    """
    Convert a URL to markdown. Response shape:

      markdown: str           — cleaned markdown for downstream consumption
      engine_used: str        — engine the caller requested (or resolved auto→)
      fetcher_used: str       — direct | stealth
      extraction_tier: str    — only for engine='trafilatura'. One of:
        "trafilatura_precision"  — pass 1 succeeded
        "trafilatura_recall"     — pass 2 succeeded after pass 1 was too short
        "markitdown_fallback"    — both trafilatura passes failed; markitdown
                                   whole-page transcription used instead.
                                   Downstream consumers should treat this as
                                   "the markdown is dirty; feed body_html
                                   to an LLM to extract clean content."
      body_html: str | null   — only present when include_body_html=True; the
                                inner-HTML of the page's <body>, so callers
                                can re-process with a different extractor or
                                LLM without re-fetching.
      metadata: {...}         — trafilatura-extracted title/author/date/etc.
      duration_ms: int
      source: { url }
    """
    from .fetch import fetch_html

    start = time.perf_counter()
    # For URLs `auto` defaults to trafilatura — article-body extraction
    # is what callers actually want for news / blog / web pages.
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
            text, metadata = _trafilatura_from_url(url, include_body_html=include_body_html)
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
        synthetic_name = _synthetic_filename_for_url(url, fetched.content_type)
        if chosen == "docling":
            text = _docling_from_bytes(fetched.content, synthetic_name, format_)
        elif chosen == "markitdown":
            text = _markitdown_from_bytes(fetched.content, synthetic_name)
        elif chosen == "trafilatura":
            text, metadata = _trafilatura_from_html_bytes(
                fetched.content, include_body_html=include_body_html
            )
        else:
            raise ValueError(f"unknown engine: {engine}")

    # Promote extraction_tier + body_html out of the metadata bag and
    # onto the top-level response so callers can branch on them
    # without reaching into nested keys. metadata still carries
    # title/author/date/etc. for the trafilatura paths.
    extraction_tier = metadata.pop("extraction_tier", None) if metadata else None
    body_html = metadata.pop("body_html", None) if metadata else None

    out: dict = {
        "markdown": text,
        "engine_used": chosen,
        "fetcher_used": fetcher,
        "format": format_,
        "source": {"url": url},
        "duration_ms": int((time.perf_counter() - start) * 1000),
    }
    if extraction_tier:
        out["extraction_tier"] = extraction_tier
    if include_body_html:
        # Always present (possibly null) when caller opted in, so the
        # consumer can rely on `body_html in response` rather than
        # `body_html in response and response[body_html] is not None`.
        out["body_html"] = body_html
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
