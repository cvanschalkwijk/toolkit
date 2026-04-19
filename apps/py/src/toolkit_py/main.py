"""
FastAPI sidecar exposing category-specific endpoints:

- /convert/file, /convert/url  (Phase 3: markitdown + docling)
- /chunk                        (Phase 5: sentence-transformers + jina-v3)
- /sanitize                     (Phase 6: Microsoft Presidio)
- /extract                      (Phase 7: Instructor)
- /health                       (always available)

This file is the skeleton — Phase 1 only wires /health. Later phases fill in
the category routers, each in their own module under toolkit_py/<category>/.
"""

from fastapi import FastAPI

from . import __version__

app = FastAPI(
    title="toolkit-py",
    version=__version__,
    description="Python sidecar for the toolkit HTTP + MCP API. "
    "Internal-only; not intended to be hit directly by end users.",
)


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "version": __version__,
        "categories": {
            "convert": "not_implemented",
            "chunk": "not_implemented",
            "sanitize": "not_implemented",
            "extract": "not_implemented",
        },
    }
