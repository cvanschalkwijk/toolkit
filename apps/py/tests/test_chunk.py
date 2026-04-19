"""
Chunking tests. Fixed-size tests run without any extras. Semantic + late
tests use `pytest.importorskip` so they skip cleanly when the `[chunk]`
extras aren't installed.
"""

from __future__ import annotations

import pytest


SAMPLE_TEXT = (
    "Toolkit is a dual-interface utility API. It exposes HTTP and MCP over "
    "the same tool registry. "
    "Adding a tool is one TypeScript file. Both the HTTP route and the MCP "
    "tool appear automatically. "
    "The repo is hostname-agnostic. Any reverse proxy in front of the Bun "
    "container will do. "
    "Tools come in four categories: conversion, chunking, sanitization, and "
    "structured extraction. "
    "Each category has at least one backend implementation and its own "
    "documentation page. "
    "You can add a new category by making a folder and registering the new "
    "tools in the registry file."
) * 3  # ~2 KB


def test_fixed_chunks_at_size_with_overlap() -> None:
    from toolkit_py.chunk import fixed

    result = fixed.run({"text": SAMPLE_TEXT, "chunk_size": 200, "overlap": 40})
    assert result["strategy"] == "fixed"
    assert result["count"] > 1
    assert result["embedding_dim"] == 0
    # Every chunk (except the last) is exactly chunk_size long.
    for ch in result["chunks"][:-1]:
        assert ch["end"] - ch["start"] == 200
    # Consecutive chunks overlap by `overlap`.
    for prev, nxt in zip(result["chunks"], result["chunks"][1:], strict=False):
        assert nxt["start"] == prev["end"] - 40


def test_fixed_guards_against_overlap_ge_chunk_size() -> None:
    from toolkit_py.chunk import fixed

    # Overlap >= chunk_size would be an infinite loop; we silently clamp.
    result = fixed.run({"text": "abcdefghijklmnop", "chunk_size": 4, "overlap": 10})
    assert result["count"] >= 1


def test_fixed_short_text_is_single_chunk() -> None:
    from toolkit_py.chunk import fixed

    result = fixed.run({"text": "hello", "chunk_size": 512, "overlap": 50})
    assert result["count"] == 1
    assert result["chunks"][0]["text"] == "hello"


def test_semantic_produces_topic_chunks() -> None:
    pytest.importorskip("langchain_experimental")
    pytest.importorskip("sentence_transformers")
    from toolkit_py.chunk import semantic

    result = semantic.run({"text": SAMPLE_TEXT, "breakpoint_percentile": 95})
    assert result["strategy"] == "semantic"
    assert result["count"] >= 1
    assert result["embedding_model"]
    # Each chunk has valid coordinates into the source text.
    for ch in result["chunks"]:
        assert ch["start"] >= 0
        assert ch["end"] > ch["start"]
        assert ch["text"]


def test_late_returns_per_chunk_embeddings() -> None:
    pytest.importorskip("transformers")
    pytest.importorskip("torch")
    from toolkit_py.chunk import late

    result = late.run(
        {"text": SAMPLE_TEXT, "chunk_size": 300, "overlap": 30}
    )
    assert result["strategy"] == "late"
    assert result["count"] >= 2
    assert result["embedding_dim"] > 0
    for ch in result["chunks"]:
        assert isinstance(ch["embedding"], list)
        assert len(ch["embedding"]) == result["embedding_dim"]
        # Embeddings should be non-trivial (not all zeros) for non-empty chunks.
        assert any(abs(v) > 1e-6 for v in ch["embedding"])
