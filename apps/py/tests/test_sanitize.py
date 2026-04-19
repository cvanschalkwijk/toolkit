"""
Sanitization tests. Uses `pytest.importorskip` so the job skips when
[sanitize] extras aren't installed.

Presidio's analyzer needs spaCy's en_core_web_lg loaded. The CI job for
this category downloads it as part of the setup step.
"""

from __future__ import annotations

import pytest


TEXT_WITH_PII = (
    "Please reach Alice Jones at alice.jones@example.com or call 415-555-0100. "
    "Her SSN is 123-45-6789. She lives in San Francisco."
)


def test_redact_mode_returns_spans_and_redacted_text() -> None:
    pytest.importorskip("presidio_analyzer")
    pytest.importorskip("presidio_anonymizer")
    pytest.importorskip("spacy")
    from toolkit_py.sanitize import presidio_runner

    result = presidio_runner.run(
        {
            "text": TEXT_WITH_PII,
            "entities": [
                "EMAIL_ADDRESS",
                "PHONE_NUMBER",
                "PERSON",
                "US_SSN",
                "LOCATION",
            ],
            "anonymization": "redact",
            "language": "en",
        }
    )

    # All the obvious PII is gone from the sanitized text.
    assert "alice.jones@example.com" not in result["sanitized_text"]
    assert "415-555-0100" not in result["sanitized_text"]
    assert "123-45-6789" not in result["sanitized_text"]

    # Redaction markers are present.
    assert "<REDACTED>" in result["sanitized_text"]

    # Redaction metadata is returned.
    types = {r["entity_type"] for r in result["redactions"]}
    assert "EMAIL_ADDRESS" in types
    assert "PHONE_NUMBER" in types
    assert "US_SSN" in types


def test_replace_mode_uses_per_entity_type_labels() -> None:
    pytest.importorskip("presidio_analyzer")
    pytest.importorskip("presidio_anonymizer")
    pytest.importorskip("spacy")
    from toolkit_py.sanitize import presidio_runner

    result = presidio_runner.run(
        {
            "text": TEXT_WITH_PII,
            "entities": ["EMAIL_ADDRESS", "PHONE_NUMBER", "US_SSN"],
            "anonymization": "replace",
            "language": "en",
        }
    )
    assert "<EMAIL_ADDRESS>" in result["sanitized_text"]
    assert "<PHONE_NUMBER>" in result["sanitized_text"]
    assert "<US_SSN>" in result["sanitized_text"]


def test_mask_mode_leaves_character_markers() -> None:
    pytest.importorskip("presidio_analyzer")
    pytest.importorskip("presidio_anonymizer")
    pytest.importorskip("spacy")
    from toolkit_py.sanitize import presidio_runner

    result = presidio_runner.run(
        {
            "text": "Email me at a@b.co",
            "entities": ["EMAIL_ADDRESS"],
            "anonymization": "mask",
            "language": "en",
        }
    )
    assert "a@b.co" not in result["sanitized_text"]
    assert "*" in result["sanitized_text"]


def test_unknown_mode_raises() -> None:
    pytest.importorskip("presidio_analyzer")
    pytest.importorskip("presidio_anonymizer")
    from toolkit_py.sanitize import presidio_runner

    with pytest.raises(ValueError, match="unknown anonymization mode"):
        presidio_runner.run(
            {"text": "x", "anonymization": "nope", "language": "en"}
        )
