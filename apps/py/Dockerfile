# toolkit-py: Python sidecar for toolkit.
# Phase 1: minimal install (fastapi + uvicorn only). Phases 3-7 add engine deps.
# Full dependency install moves to a later build stage once we know the final
# requirements set, to keep the Phase 1 image fast.

FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install only the framework deps at the skeleton stage.
RUN pip install --no-cache-dir 'fastapi>=0.115' 'uvicorn[standard]>=0.32'

COPY src/ ./src/
COPY pyproject.toml ./

EXPOSE 8000

CMD ["uvicorn", "toolkit_py.main:app", "--host", "0.0.0.0", "--port", "8000", "--app-dir", "src"]
