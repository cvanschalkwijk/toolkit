"""
PII sanitization via Microsoft Presidio.

Presidio has two engines that pair:
  - AnalyzerEngine — detects PII spans (names, emails, SSNs, etc.)
  - AnonymizerEngine — rewrites those spans with redact/replace/hash/mask

The first call warms up both engines and loads spaCy's en_core_web_lg
(~500 MB) for NER. Subsequent calls reuse the in-process instances.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any


@lru_cache(maxsize=1)
def _analyzer() -> Any:
    from presidio_analyzer import AnalyzerEngine

    return AnalyzerEngine()


@lru_cache(maxsize=1)
def _anonymizer() -> Any:
    from presidio_anonymizer import AnonymizerEngine

    return AnonymizerEngine()


# Map our simple mode names to Presidio's operator config.
def _operators_for(mode: str) -> dict:
    from presidio_anonymizer.entities import OperatorConfig

    if mode == "redact":
        # Presidio's "redact" replaces the span with empty string; we want a
        # recognisable `<ENTITY>` marker instead. Use "replace" with a lambda
        # via OperatorConfig's new_value templated at call time.
        return {
            "DEFAULT": OperatorConfig("replace", {"new_value": "<REDACTED>"}),
        }
    if mode == "replace":
        # Replace each entity with <ENTITY_TYPE>. We generate operators per
        # entity type at call time since Presidio expects them per-type.
        return {"DEFAULT": OperatorConfig("replace", {"new_value": "<ANON>"})}
    if mode == "mask":
        return {
            "DEFAULT": OperatorConfig(
                "mask",
                {
                    "masking_char": "*",
                    "chars_to_mask": 128,
                    "from_end": False,
                },
            ),
        }
    if mode == "hash":
        return {"DEFAULT": OperatorConfig("hash", {"hash_type": "sha256"})}
    raise ValueError(f"unknown anonymization mode: {mode}")


def run(params: dict) -> dict:
    import time

    text: str = params["text"]
    entities: list[str] | None = params.get("entities")
    mode: str = params.get("anonymization", "redact")
    language: str = params.get("language", "en")

    start = time.perf_counter()

    analyzer = _analyzer()
    anonymizer = _anonymizer()

    analyze_kwargs: dict[str, Any] = {"text": text, "language": language}
    if entities:
        analyze_kwargs["entities"] = entities

    results = analyzer.analyze(**analyze_kwargs)

    if mode == "replace":
        # Per-entity-type replacement: <PERSON>, <EMAIL_ADDRESS>, etc.
        from presidio_anonymizer.entities import OperatorConfig

        operators = {
            r.entity_type: OperatorConfig(
                "replace", {"new_value": f"<{r.entity_type}>"}
            )
            for r in results
        }
        operators.setdefault(
            "DEFAULT", OperatorConfig("replace", {"new_value": "<ANON>"})
        )
    else:
        operators = _operators_for(mode)

    anonymized = anonymizer.anonymize(
        text=text,
        analyzer_results=results,
        operators=operators,
    )

    redactions = [
        {
            "entity_type": r.entity_type,
            "start": r.start,
            "end": r.end,
            "score": float(r.score),
        }
        for r in results
    ]
    # Sort descending by start so applying in order doesn't shift later indices,
    # but we return the span list as-found for the caller's reference.
    redactions.sort(key=lambda r: r["start"])

    return {
        "sanitized_text": anonymized.text,
        "redactions": redactions,
        "anonymization": mode,
        "language": language,
        "duration_ms": int((time.perf_counter() - start) * 1000),
    }
