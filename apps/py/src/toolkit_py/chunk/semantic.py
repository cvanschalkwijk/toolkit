"""
Semantic chunking: finds natural topic breaks by computing rolling cosine
similarity between sentence embeddings and splitting at the sharpest
drops. Wraps LangChain's `SemanticChunker` over a sentence-transformers
encoder.

Why this over fixed chunks: topic-aware boundaries keep related sentences
together, which improves retrieval quality downstream.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

_DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"


@lru_cache(maxsize=4)
def _load_encoder(name: str) -> Any:
    from langchain_community.embeddings import HuggingFaceEmbeddings

    return HuggingFaceEmbeddings(model_name=name)


def run(params: dict) -> dict:
    from langchain_experimental.text_splitter import SemanticChunker

    text: str = params["text"]
    breakpoint_percentile: int = int(params.get("breakpoint_percentile", 95))

    # Guard against Swagger UI's placeholder text being submitted verbatim —
    # an optional `z.string()` field renders with "string" pre-filled, and
    # users commonly forget to clear it. Treat empty / "string" as "unset".
    raw = (params.get("embedding_model") or "").strip()
    embedding_model: str = raw if raw and raw != "string" else _DEFAULT_MODEL

    encoder = _load_encoder(embedding_model)
    chunker = SemanticChunker(
        encoder,
        breakpoint_threshold_type="percentile",
        breakpoint_threshold_amount=breakpoint_percentile,
    )
    docs = chunker.create_documents([text])

    chunks: list[dict] = []
    cursor = 0
    for idx, doc in enumerate(docs):
        chunk_text = doc.page_content
        start = text.find(chunk_text, cursor)
        if start < 0:
            # Chunker may have normalised whitespace; fall back to a heuristic.
            start = cursor
        end = start + len(chunk_text)
        cursor = end
        chunks.append(
            {
                "text": chunk_text,
                "index": idx,
                "start": start,
                "end": end,
            }
        )

    return {
        "chunks": chunks,
        "count": len(chunks),
        "embedding_model": embedding_model,
        "embedding_dim": 0,  # No per-chunk embeddings returned — use chunk_late for those.
        "strategy": "semantic",
    }
