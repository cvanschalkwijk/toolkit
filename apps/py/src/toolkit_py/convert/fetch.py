"""
URL fetchers for the convert_url tool.

Two strategies:
  - "direct"   — plain HTTP GET via requests. Cheap, fast, enough for most
                 pages. Blocked by Cloudflare challenges, aggressive WAFs,
                 and sites that fingerprint python-requests.
  - "stealth"  — POST to a FlareSolverr instance (`FLARESOLVERR_URL`) which
                 drives a headful Chromium, solves CF Turnstile / JS
                 challenges, and hands back the post-challenge HTML.

Stealth returns HTML only — if the URL points at a binary (PDF, image),
FlareSolverr renders it as a Chrome download / preview page rather than
fetching the bytes directly. For binary content use the direct path
(upstream sites rarely block raw byte fetches) or pre-download and use
convert_file instead.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal

import requests

FetcherChoice = Literal["direct", "stealth"]

# Matches a recent Chrome on Linux — plenty of sites reject the default
# `python-requests/2.x` UA outright. The stealth path overrides this with
# whatever UA FlareSolverr's Chromium actually used.
_DIRECT_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
)

_DEFAULT_TIMEOUT_S = 60.0


@dataclass(frozen=True)
class FetchResult:
    content: bytes
    final_url: str
    status_code: int
    content_type: str
    fetcher_used: FetcherChoice


class FetchError(Exception):
    """Raised when a fetch fails in a way the caller should surface."""


def _flaresolverr_url() -> str | None:
    val = (os.environ.get("FLARESOLVERR_URL") or "").strip()
    return val or None


def fetch_html(
    url: str,
    fetcher: FetcherChoice = "direct",
    *,
    timeout_s: float = _DEFAULT_TIMEOUT_S,
) -> FetchResult:
    if fetcher == "direct":
        return _fetch_direct(url, timeout_s)
    if fetcher == "stealth":
        base = _flaresolverr_url()
        if not base:
            raise FetchError(
                "fetcher='stealth' requires FLARESOLVERR_URL to be set "
                "(bring up `docker compose --profile stealth up -d` or "
                "point at an existing instance)"
            )
        return _fetch_via_flaresolverr(url, base, timeout_s)
    raise ValueError(f"unknown fetcher: {fetcher}")


def _fetch_direct(url: str, timeout_s: float) -> FetchResult:
    try:
        resp = requests.get(
            url,
            headers={"User-Agent": _DIRECT_UA, "Accept": "*/*"},
            timeout=timeout_s,
            allow_redirects=True,
        )
    except requests.RequestException as e:
        raise FetchError(f"direct fetch failed: {e}") from e
    if not resp.ok:
        raise FetchError(f"direct fetch returned {resp.status_code} for {url}")
    return FetchResult(
        content=resp.content,
        final_url=resp.url,
        status_code=resp.status_code,
        content_type=resp.headers.get("content-type", ""),
        fetcher_used="direct",
    )


def _fetch_via_flaresolverr(url: str, base: str, timeout_s: float) -> FetchResult:
    endpoint = base.rstrip("/") + "/v1"
    # FlareSolverr's `maxTimeout` is in milliseconds and covers the full
    # challenge-solve + page-load window. Pad ours to match.
    body = {
        "cmd": "request.get",
        "url": url,
        "maxTimeout": int(timeout_s * 1000),
    }
    try:
        resp = requests.post(
            endpoint,
            json=body,
            # Give the outer HTTP call a bit more headroom than the
            # inner solve budget so we see FlareSolverr's error JSON
            # instead of our own timeout if the challenge takes a
            # while.
            timeout=timeout_s + 10,
        )
    except requests.RequestException as e:
        raise FetchError(f"flaresolverr POST failed: {e}") from e
    if not resp.ok:
        raise FetchError(
            f"flaresolverr returned {resp.status_code}: {resp.text[:400]}"
        )

    data = resp.json()
    if data.get("status") != "ok":
        # FlareSolverr puts the reason in `message` when status != ok
        # (e.g. "Challenge detected but solver is not enabled").
        raise FetchError(
            f"flaresolverr declined: {data.get('message', 'unknown error')}"
        )

    solution = data.get("solution") or {}
    html = solution.get("response", "") or ""
    headers = solution.get("headers") or {}
    content_type = (
        headers.get("Content-Type")
        or headers.get("content-type")
        or "text/html; charset=utf-8"
    )
    return FetchResult(
        content=html.encode("utf-8"),
        final_url=solution.get("url", url),
        status_code=int(solution.get("status", 200)),
        content_type=content_type,
        fetcher_used="stealth",
    )
