# toolkit-py — FastAPI sidecar with conversion / chunking / sanitization /
# extraction backends.
#
# Image lives at ghcr.io/<owner>/toolkit/py.
#
# Build args:
#   BUILD_EXTRAS   pip extras to install. Default `all` = everything.
#                  Narrow (`convert`, `convert,chunk`, …) to get a smaller
#                  image with only the categories you need. Missing
#                  categories return HTTP 501 at runtime with a clear
#                  "install extras" message.
#   SPACY_MODEL    spaCy model name for the sanitize category. Default
#                  `en_core_web_lg` — the model Presidio's NER recognizers
#                  expect. Set to empty to skip the download.
#
# Example: convert-only minimal image
#   docker build --build-arg BUILD_EXTRAS=convert --build-arg SPACY_MODEL= \
#                -f apps/py/Dockerfile -t toolkit-py:convert .

ARG BUILD_EXTRAS=all
ARG SPACY_MODEL=en_core_web_lg

# --- base --------------------------------------------------------------------
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Runtime deps Presidio + docling expect at import time.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      wget \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# --- deps (cache-friendly) ---------------------------------------------------
FROM base AS deps
ARG BUILD_EXTRAS
ARG SPACY_MODEL
WORKDIR /app

# Copy the manifest first so this layer only invalidates when deps change.
COPY apps/py/pyproject.toml ./
# Create a dummy src/ so `pip install .[extras]` can resolve the package
# metadata without the actual source yet (keeps layer caching tight).
RUN mkdir -p src/toolkit_py && \
    echo '__version__ = "0.1.0"' > src/toolkit_py/__init__.py

RUN pip install ".[${BUILD_EXTRAS}]"

# spaCy model download (only if requested) — large (~500 MB for en_core_web_lg).
# Conditional so slim builds (e.g., BUILD_EXTRAS=convert) don't pay the cost.
RUN if [ -n "${SPACY_MODEL}" ] && python -c "import spacy" 2>/dev/null; then \
      python -m spacy download "${SPACY_MODEL}"; \
    else \
      echo "spaCy not installed or SPACY_MODEL empty — skipping model download."; \
    fi

# --- runner ------------------------------------------------------------------
FROM base AS runner
WORKDIR /app

# Bring the pre-populated site-packages over from the deps stage.
COPY --from=deps /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin

# Now copy the real source.
COPY apps/py/pyproject.toml ./
COPY apps/py/src/ ./src/

# Non-root user with a real home — HuggingFace / spaCy / torch all default
# their model cache to $HOME/.cache, so we need it writable. A home-less
# nologin user causes sentence-transformers to blow up with a PermissionError
# on first model download.
RUN groupadd --gid 1000 app \
 && useradd --uid 1000 --gid 1000 --shell /bin/sh -m -d /home/app app \
 && chown -R app:app /app /home/app
USER app

# Point the HF / transformers caches at a known writable directory so the
# download location doesn't depend on $HOME resolution quirks.
ENV HF_HOME=/home/app/.cache/huggingface \
    TRANSFORMERS_CACHE=/home/app/.cache/huggingface \
    SENTENCE_TRANSFORMERS_HOME=/home/app/.cache/sentence-transformers

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8000/health > /dev/null || exit 1

CMD ["uvicorn", "toolkit_py.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--app-dir", "src"]
