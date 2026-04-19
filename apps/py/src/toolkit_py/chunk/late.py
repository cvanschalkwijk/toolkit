"""
Late chunking: encode the whole document with a long-context embedding
model in one pass (preserving global context in every token's
representation), then carve it into char-level chunks and mean-pool the
token embeddings that fall in each chunk's span.

Why it matters: standard per-chunk embedding sees only the local window,
so a phrase like "their policy" in a late chunk loses its referent. Late
chunking's per-chunk vectors carry the document-wide context along for
the ride.

Reference:
- https://jina.ai/news/late-chunking-in-long-context-embedding-models/
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

_DEFAULT_MODEL = "jinaai/jina-embeddings-v3"
_MAX_SEQ_LENGTH = 8192  # jina-v3 context cap; longer inputs are truncated.


@lru_cache(maxsize=2)
def _load_model(name: str) -> tuple[Any, Any]:
    from transformers import AutoModel, AutoTokenizer

    tok = AutoTokenizer.from_pretrained(name, trust_remote_code=True)
    model = AutoModel.from_pretrained(name, trust_remote_code=True)
    model.eval()
    return tok, model


def _char_spans(text: str, chunk_size: int, overlap: int) -> list[tuple[int, int]]:
    if overlap >= chunk_size:
        overlap = max(0, chunk_size // 4)
    spans: list[tuple[int, int]] = []
    i = 0
    n = len(text)
    while i < n:
        j = min(n, i + chunk_size)
        spans.append((i, j))
        if j >= n:
            break
        i = j - overlap
    return spans


def run(params: dict) -> dict:
    import torch

    text: str = params["text"]
    chunk_size: int = int(params.get("chunk_size", 512))
    overlap: int = int(params.get("overlap", 50))
    embedding_model: str = params.get("embedding_model") or _DEFAULT_MODEL

    tok, model = _load_model(embedding_model)

    enc = tok(
        text,
        return_tensors="pt",
        return_offsets_mapping=True,
        truncation=True,
        max_length=_MAX_SEQ_LENGTH,
    )
    offsets = enc.pop("offset_mapping")[0].tolist()  # list of (char_start, char_end)
    truncated = len(text) > offsets[-1][1] if offsets else False

    with torch.no_grad():
        out = model(**enc)
    last_hidden = out.last_hidden_state[0]  # (tokens, dim)
    dim = last_hidden.shape[-1]

    spans = _char_spans(text, chunk_size, overlap)
    chunks: list[dict] = []
    for idx, (start, end) in enumerate(spans):
        token_ids: list[int] = []
        for t_idx, (c_s, c_e) in enumerate(offsets):
            # Skip special tokens (offset = [0,0] by convention).
            if c_s == 0 and c_e == 0 and t_idx > 0:
                continue
            if c_s >= end:
                break
            if c_e <= start:
                continue
            token_ids.append(t_idx)
        if token_ids:
            pooled = last_hidden[token_ids].mean(dim=0)
            embedding = pooled.tolist()
        else:
            embedding = [0.0] * dim
        chunks.append(
            {
                "text": text[start:end],
                "index": idx,
                "start": start,
                "end": end,
                "embedding": embedding,
            }
        )

    return {
        "chunks": chunks,
        "count": len(chunks),
        "embedding_model": embedding_model,
        "embedding_dim": dim,
        "strategy": "late",
        "truncated": truncated,
    }
