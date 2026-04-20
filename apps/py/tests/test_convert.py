"""
Conversion tests. Uses `pytest.importorskip` so the tests skip gracefully
when the `[convert]` optional deps aren't installed (letting the sanitize
or chunk CI job run without pulling markitdown/docling).
"""

from __future__ import annotations

import pytest


def test_pick_engine_routes_by_extension() -> None:
    from toolkit_py.convert.engines import _pick_engine_for_file

    assert _pick_engine_for_file("report.pdf") == "docling"
    assert _pick_engine_for_file("slides.pptx") == "docling"
    assert _pick_engine_for_file("spreadsheet.xlsx") == "docling"
    assert _pick_engine_for_file("essay.docx") == "docling"
    # Fall-through to markitdown
    assert _pick_engine_for_file("article.html") == "markitdown"
    assert _pick_engine_for_file("image.png") == "markitdown"
    assert _pick_engine_for_file("audio.mp3") == "markitdown"
    assert _pick_engine_for_file("unknown") == "markitdown"


def test_markitdown_roundtrips_html(sample_html: bytes) -> None:
    pytest.importorskip("markitdown")
    from toolkit_py.convert.engines import convert_bytes

    result = convert_bytes(sample_html, "sample.html", "markitdown", "markdown")
    md = result["markdown"]

    assert result["engine_used"] == "markitdown"
    assert result["format"] == "markdown"
    assert result["source"] == {"filename": "sample.html", "bytes": len(sample_html)}
    assert result["duration_ms"] >= 0

    # The HTML fixture has these strings — any conversion engine should
    # preserve them. Strip markdown backslash-escapes (markitdown escapes
    # `_` in table cells as `\_`) before substring checks.
    md_unescaped = md.replace("\\_", "_")
    assert "Introduction to Toolkit" in md
    assert "Chunking" in md
    assert "chunk_semantic" in md_unescaped
    # At least one list item survived.
    assert "Document conversion" in md or "document conversion" in md.lower()


def test_auto_engine_picks_markitdown_for_html(sample_html: bytes) -> None:
    pytest.importorskip("markitdown")
    from toolkit_py.convert.engines import convert_bytes

    result = convert_bytes(sample_html, "sample.html", "auto", "markdown")
    assert result["engine_used"] == "markitdown"


def test_docling_roundtrips_html(sample_html: bytes) -> None:
    pytest.importorskip("docling")
    from toolkit_py.convert.engines import convert_bytes

    result = convert_bytes(sample_html, "sample.html", "docling", "markdown")
    md = result["markdown"]

    assert result["engine_used"] == "docling"
    assert len(md) > 50
    assert "Toolkit" in md


@pytest.mark.slow
def test_convert_url_fetches_and_converts() -> None:
    """
    Live network test — fetches a real URL. Run with `pytest -m slow`.
    """
    pytest.importorskip("markitdown")
    from toolkit_py.convert.engines import convert_url

    result = convert_url(
        "https://en.wikipedia.org/wiki/Markdown", "markitdown", "markdown"
    )
    assert result["engine_used"] == "markitdown"
    assert len(result["markdown"]) > 500
    assert result["source"] == {"url": "https://en.wikipedia.org/wiki/Markdown"}


def test_fetch_stealth_requires_flaresolverr_url(monkeypatch: pytest.MonkeyPatch) -> None:
    pytest.importorskip("requests")
    from toolkit_py.convert.fetch import FetchError, fetch_html

    monkeypatch.delenv("FLARESOLVERR_URL", raising=False)
    with pytest.raises(FetchError, match="FLARESOLVERR_URL"):
        fetch_html("https://example.com", fetcher="stealth")


def test_fetch_stealth_parses_flaresolverr_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pytest.importorskip("requests")
    import requests

    from toolkit_py.convert import fetch as fetch_mod

    monkeypatch.setenv("FLARESOLVERR_URL", "http://flaresolverr.test:8191")

    captured: dict = {}

    class _Resp:
        ok = True
        status_code = 200

        def json(self) -> dict:
            return {
                "status": "ok",
                "solution": {
                    "url": "https://cf-walled.example.com",
                    "status": 200,
                    "response": "<html><body>after challenge</body></html>",
                    "headers": {"Content-Type": "text/html; charset=utf-8"},
                },
            }

    def _fake_post(url: str, json=None, timeout=None, **_: object) -> _Resp:  # noqa: A002
        captured["url"] = url
        captured["body"] = json
        captured["timeout"] = timeout
        return _Resp()

    monkeypatch.setattr(requests, "post", _fake_post)

    r = fetch_mod.fetch_html(
        "https://cf-walled.example.com", fetcher="stealth", timeout_s=30
    )

    assert captured["url"] == "http://flaresolverr.test:8191/v1"
    assert captured["body"] == {
        "cmd": "request.get",
        "url": "https://cf-walled.example.com",
        "maxTimeout": 30_000,
    }
    assert r.fetcher_used == "stealth"
    assert r.content == b"<html><body>after challenge</body></html>"
    assert r.content_type.startswith("text/html")
    assert r.status_code == 200


def test_fetch_stealth_surfaces_flaresolverr_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pytest.importorskip("requests")
    import requests

    from toolkit_py.convert import fetch as fetch_mod

    monkeypatch.setenv("FLARESOLVERR_URL", "http://flaresolverr.test:8191")

    class _Resp:
        ok = True
        status_code = 200

        def json(self) -> dict:
            return {"status": "error", "message": "Challenge detected but solver is not enabled"}

    monkeypatch.setattr(requests, "post", lambda *a, **kw: _Resp())

    with pytest.raises(fetch_mod.FetchError, match="solver is not enabled"):
        fetch_mod.fetch_html("https://cf.example.com", fetcher="stealth")
