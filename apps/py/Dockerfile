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

# Runtime deps.
# - wget + ca-certificates: healthcheck + outbound TLS
# - libxcb1, libgl1, libglib2.0-0, libsm6, libxext6, libxrender1, libgomp1:
#   opencv-python is pulled in by docling and has hard system-lib imports
#   for X11/OpenGL at module init time, even in headless containers. Without
#   these, `import cv2` fails with "libxcb.so.1: cannot open shared object".
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      wget \
      ca-certificates \
      libxcb1 \
      libgl1 \
      libglib2.0-0 \
      libsm6 \
      libxext6 \
      libxrender1 \
      libgomp1 \
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
#
# Pre-create the cache directory tree before dropping privileges. If a named
# docker volume mounts onto /home/app/.cache, it inherits these perms on
# first init — otherwise docker creates the mount point as root:root and the
# app user can't write.
#
# Also chown the rapidocr package dir: docling's OCR path downloads extra
# ONNX weights into rapidocr/models/ on first use, and that path defaults
# to the (root-owned) site-packages location. Without write access there,
# any PDF conversion that triggers OCR 500s with a PermissionError.
RUN groupadd --gid 1000 app \
 && useradd --uid 1000 --gid 1000 --shell /bin/sh -m -d /home/app app \
 && mkdir -p /home/app/.cache/huggingface /home/app/.cache/sentence-transformers \
 && chown -R app:app /app /home/app \
 && ( [ -d /usr/local/lib/python3.12/site-packages/rapidocr ] \
      && chown -R app:app /usr/local/lib/python3.12/site-packages/rapidocr \
      || true )
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
