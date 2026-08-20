"""Overpass helpers with mirror fallback. OSM overlays are not FortyGuard."""

from __future__ import annotations

import hashlib
import threading
import time
from typing import Any

import requests

MIRRORS = (
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass-api.de/api/interpreter",
)
USER_AGENT = "HeatCast/0.4 (planner OSM overlay; not FortyGuard)"
_CACHE_TTL_S = 2 * 3600
_lock = threading.Lock()
_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def overpass_query(query: str, timeout_s: int = 22) -> dict[str, Any]:
    key = hashlib.sha256(query.encode("utf-8")).hexdigest()
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < _CACHE_TTL_S:
            return hit[1]

    last_err: Exception | None = None
    for url in MIRRORS:
        try:
            resp = requests.post(
                url,
                data={"data": query},
                timeout=timeout_s,
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            )
            if resp.status_code in {429, 504, 502, 503}:
                last_err = RuntimeError(f"{url} HTTP {resp.status_code}")
                time.sleep(1.2 if resp.status_code == 429 else 0.3)
                continue
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, dict) and data.get("remark") and "error" in str(data.get("remark")).lower():
                last_err = RuntimeError(str(data.get("remark")))
                continue
            if not isinstance(data, dict):
                last_err = RuntimeError(f"{url} returned non-JSON Overpass payload")
                continue
            with _lock:
                _cache[key] = (time.time(), data)
            return data
        except (requests.RequestException, ValueError) as exc:
            last_err = exc
            time.sleep(0.25)
            continue
    raise RuntimeError(f"Overpass failed on all mirrors: {last_err}")
