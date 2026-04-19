"""
Fixed-size character chunking. No embeddings, no external deps — the
simplest baseline. Good for smoke-testing the chunk surface, or as a
fallback when you just want deterministic slices.
"""

from __future__ import annotations


def run(params: dict) -> dict:
    text: str = params["text"]
    chunk_size: int = int(params.get("chunk_size", 512))
    overlap: int = int(params.get("overlap", 50))
    if overlap >= chunk_size:
        # Prevent infinite loop on pathological input.
        overlap = max(0, chunk_size // 4)

    chunks: list[dict] = []
    i, idx = 0, 0
    n = len(text)
    while i < n:
        j = min(n, i + chunk_size)
        chunks.append(
            {
                "text": text[i:j],
                "index": idx,
                "start": i,
                "end": j,
            }
        )
        if j >= n:
            break
        idx += 1
        i = j - overlap

    return {
        "chunks": chunks,
        "count": len(chunks),
        "embedding_model": None,
        "embedding_dim": 0,
        "strategy": "fixed",
    }
