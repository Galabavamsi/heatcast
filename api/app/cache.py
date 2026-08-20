"""Disk cache keyed by request fingerprint. Failed FortyGuard tasks are free; repeats are not."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

CACHE_DIR = Path(__file__).resolve().parent.parent / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def cache_key(*parts: Any) -> str:
    blob = json.dumps(parts, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def load(key: str) -> Any | None:
    path = CACHE_DIR / f"{key}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def save(key: str, payload: Any) -> None:
    path = CACHE_DIR / f"{key}.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
