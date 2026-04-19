"""
Cross-category exception → HTTP status mapping.

Each category module raises its own native exceptions; `map_exception` turns
them into a FastAPI-friendly `HTTPException` with a structured detail payload
the Bun client can inspect.

Kept central so new categories inherit consistent semantics (415 for bad
format, 422 for "understood but couldn't process", 501 for missing optional
deps, 502 for upstream fetch failures, 500 otherwise).
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException


def http_err(status: int, message: str, **extra: Any) -> HTTPException:
    return HTTPException(
        status_code=status,
        detail={"message": message, **extra},
    )


class CategoryNotInstalled(Exception):
    """Raised from an endpoint when its optional-deps group isn't installed."""

    def __init__(self, category: str) -> None:
        super().__init__(
            f"{category} is not installed. "
            f"Install with: pip install 'toolkit-py[{category}]'"
        )
        self.category = category


def map_exception(e: Exception) -> HTTPException:
    """
    Best-effort error mapping. Imports remain optional so this module loads
    even when a category's deps are absent.
    """
    # 1. Our own signals first.
    if isinstance(e, HTTPException):
        return e
    if isinstance(e, CategoryNotInstalled):
        return http_err(501, str(e), category=e.category)

    name = type(e).__name__

    # 2. Convert category (markitdown / docling).
    if name == "UnsupportedFormatException":
        return http_err(415, f"unsupported input format: {e}")
    if name == "FileConversionException":
        return http_err(422, f"conversion failed: {e}")
    if name == "MissingDependencyException":
        return http_err(501, f"missing optional dependency: {e}")

    # 3. Network / fetch errors.
    if name in {"ConnectionError", "ConnectTimeout", "ReadTimeout", "HTTPError"}:
        return http_err(502, f"upstream fetch failed: {e}")

    # 4. Fallthrough — surface as 500 with the exception class name so the
    # Bun client can log something meaningful.
    return http_err(500, f"internal error: {name}: {e}")
