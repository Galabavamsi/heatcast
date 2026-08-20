"""FortyGuard helpers: lazy client, disk cache, coverage-miss detection, slim payloads."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fortyguard import FortyGuardClient, FortyGuardError, TaskFailedError

from . import cache

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "outputs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

_SECRET_KEYS = {"api_key", "apikey", "key", "token", "secret", "authorization"}
_IMAGE_KEYS = {
    "original_image",
    "orignal_image",
    "segmented_image",
    "image_content",
    "image_legend",
    "image",
    "images",
    "image_year",
    "image_dimensions",
}

_client: FortyGuardClient | None = None


def get_client() -> FortyGuardClient:
    global _client
    if _client is None:
        _client = FortyGuardClient()
    return _client


def strip_secrets(payload: Any) -> Any:
    if isinstance(payload, dict):
        out = {}
        for key, value in payload.items():
            if str(key).lower().replace("-", "_") in _SECRET_KEYS:
                continue
            if isinstance(value, str) and value == os.getenv("FORTYGUARD_API_KEY"):
                continue
            out[key] = strip_secrets(value)
        return out
    if isinstance(payload, list):
        return [strip_secrets(item) for item in payload]
    return payload


def drop_images(payload: Any) -> Any:
    if isinstance(payload, dict):
        out = {}
        for key, value in payload.items():
            if str(key).lower() in _IMAGE_KEYS or "base64" in str(key).lower():
                continue
            if isinstance(value, str) and len(value) > 4000:
                continue
            out[key] = drop_images(value)
        return out
    if isinstance(payload, list):
        if payload and isinstance(payload[0], str) and len(payload[0]) > 400:
            return f"[{len(payload)} truncated image blobs]"
        return [drop_images(item) for item in payload]
    return payload


def _unwrap(payload: dict[str, Any]) -> tuple[str | None, dict[str, Any]]:
    if not isinstance(payload, dict):
        return None, {}
    if "result" in payload and ("activity_id" in payload or isinstance(payload.get("result"), dict)):
        result = payload.get("result")
        if isinstance(result, dict):
            return payload.get("activity_id"), result
    return payload.get("activity_id"), payload


def heatmap_features(result: dict[str, Any]) -> list[dict[str, Any]]:
    if isinstance(result, list):
        return result
    if not isinstance(result, dict):
        return []
    for key in ("map_data", "geojson", "heatmap", "features"):
        blob = result.get(key)
        if isinstance(blob, list):
            return blob
        if isinstance(blob, dict):
            feats = blob.get("features")
            if isinstance(feats, list):
                return feats
            nested = blob.get("map_data") or blob.get("geojson")
            if isinstance(nested, dict) and isinstance(nested.get("features"), list):
                return list(nested["features"])
            if isinstance(nested, list):
                return nested
    return []


def heatmap_stats(result: dict[str, Any], features: list[dict[str, Any]]) -> dict[str, Any]:
    stats = result.get("stats_data") or result.get("stats") or {}
    temp_stats = stats.get("temperature_stats") if isinstance(stats, dict) else None
    n_cells = None
    if isinstance(stats, dict):
        n_cells = stats.get("n_cells")
        if n_cells is None and isinstance(temp_stats, dict):
            n_cells = temp_stats.get("n_cells")
    if n_cells is None:
        n_cells = len(features)
    units = "°C"
    if isinstance(stats, dict):
        units = stats.get("units") or (temp_stats or {}).get("units") or "°C"
        if str(units).lower() in {"c", "celsius", "degc", "°c"}:
            units = "°C"
    mean = max_ = min_ = None
    if isinstance(temp_stats, dict):
        mean = temp_stats.get("average") or temp_stats.get("mean") or temp_stats.get("avg")
        max_ = temp_stats.get("max") or temp_stats.get("maximum")
        min_ = temp_stats.get("min") or temp_stats.get("minimum")
    if isinstance(stats, dict):
        mean = mean if mean is not None else stats.get("mean")
        max_ = max_ if max_ is not None else stats.get("max")
        min_ = min_ if min_ is not None else stats.get("min")
    return {
        "n_cells": int(n_cells or 0),
        "feature_count": len(features),
        "units": units,
        "mean": mean,
        "max": max_,
        "min": min_,
        "analytic_type": (stats or {}).get("analytic_type") if isinstance(stats, dict) else None,
        "raw": {k: v for k, v in (stats.items() if isinstance(stats, dict) else []) if k != "tiles"},
    }


def is_coverage_miss(features: list[dict[str, Any]], stats: dict[str, Any]) -> bool:
    return int(stats.get("n_cells") or 0) == 0 or len(features) == 0


def _aoi_fingerprint(polygon_aoi: dict[str, Any]) -> Any:
    try:
        coords = polygon_aoi["features"][0]["geometry"]["coordinates"][0]
        return [[round(float(x), 5), round(float(y), 5)] for x, y in coords]
    except Exception:
        return polygon_aoi


def cached_heatmap(
    polygon_aoi: dict[str, Any],
    *,
    start_date: str,
    start_time: str | None,
    filter_type: int,
    granularity: int,
    analytic_type: str,
    threshold: float | None = None,
    direction: str | None = None,
    live: bool = True,
) -> dict[str, Any] | None:
    key = cache.cache_key(
        "heatmap",
        _aoi_fingerprint(polygon_aoi),
        start_date,
        start_time,
        filter_type,
        granularity,
        analytic_type,
        threshold,
        direction,
    )
    hit = cache.load(key)
    if hit is not None:
        hit["cached"] = True
        return hit
    if not live:
        return None
    client = get_client()
    try:
        payload = client.create_heatmap(
            polygon_aoi=polygon_aoi,
            start_date=start_date,
            start_time=start_time,
            filter_type=filter_type,
            granularity=granularity,
            analytic_type=analytic_type,
            threshold=threshold,
            direction=direction,
            wait=True,
            timeout=240.0,
            verbose=False,
        )
    except TaskFailedError:
        # Failed tasks are free — do not cache.
        raise
    activity_id, result = _unwrap(payload if isinstance(payload, dict) else {})
    stored = {
        "activity_id": activity_id,
        "result": result,
        "cached": False,
    }
    cache.save(key, stored)
    stored["cached"] = False
    return stored


def cached_call(kind: str, parts: list[Any], fn) -> dict[str, Any]:
    key = cache.cache_key(kind, *parts)
    hit = cache.load(key)
    if hit is not None:
        hit["cached"] = True
        return hit
    try:
        payload = fn()
    except TaskFailedError:
        raise
    if isinstance(payload, dict):
        activity_id, result = _unwrap(payload)
        stored = {"activity_id": activity_id, "result": result, "cached": False}
    else:
        stored = {"activity_id": None, "result": payload, "cached": False}
    cache.save(key, stored)
    return stored


def env_snapshot(result: dict[str, Any], start_time: str) -> dict[str, Any]:
    keep = (
        "apparent_temperature_celsius",
        "wet_bulb_temperature_celsius",
        "relative_humidity_percent",
        "precipitation_mm",
    )
    locations = result.get("locations") or []
    loc = locations[0] if locations else result
    params = (loc.get("parameters") if isinstance(loc, dict) else None) or result.get("parameters") or {}
    timestamps = ((result.get("metadata") or {}).get("timestamps")) or []
    hour = _hour_from_time(start_time)
    idx = _index_for_hour(timestamps, hour)

    series: dict[str, list[Any]] = {}
    for name in keep:
        values = params.get(name) if isinstance(params, dict) else None
        if isinstance(values, list):
            series[name] = values

    apparent = series.get("apparent_temperature_celsius") or []
    hot_idx = None
    if apparent:
        numeric = [(i, v) for i, v in enumerate(apparent) if isinstance(v, (int, float))]
        if numeric:
            hot_idx = max(numeric, key=lambda pair: pair[1])[0]

    def at_index(i: int | None) -> dict[str, Any]:
        if i is None:
            return {}
        row = {"index": i, "timestamp": timestamps[i] if i < len(timestamps) else None}
        for name, values in series.items():
            row[name] = values[i] if i < len(values) else None
        return row

    precip = None
    if isinstance(params, dict):
        raw_p = params.get("precipitation_mm")
        if isinstance(raw_p, (int, float)):
            precip = float(raw_p)
        elif isinstance(raw_p, list):
            pick = hot_idx if hot_idx is not None else idx
            if pick is not None and pick < len(raw_p) and isinstance(raw_p[pick], (int, float)):
                precip = float(raw_p[pick])

    return {
        "caveat": (
            "heat_index_celsius is humidity-sensitivity at a fixed heatmap temperature, "
            "not a diurnal forecast. Use apparent_temperature_celsius at the hot hour. "
            "Do not count hours from heat_index. env_params is coarse — points ~1 km apart can be identical. "
            "precipitation_mm here is a point series/scalar, not radar."
        ),
        "requested_hour": at_index(idx),
        "hot_hour": at_index(hot_idx),
        "precipitation_mm": precip,
        "timezone": (result.get("metadata") or {}).get("timezone"),
    }


def class_percents(result: dict[str, Any]) -> dict[str, float]:
    candidates = []
    if isinstance(result, dict):
        seg = result.get("segmentation") or {}
        if isinstance(seg, dict) and isinstance(seg.get("segments"), dict):
            candidates.append(seg["segments"])
        front = result.get("front") or {}
        if isinstance(front, dict) and isinstance(front.get("segments"), dict):
            candidates.append(front["segments"])
        if isinstance(result.get("segments"), dict):
            candidates.append(result["segments"])
    out: dict[str, float] = {}
    source = candidates[0] if candidates else {}
    for key, value in source.items():
        try:
            out[str(key)] = round(float(value), 2)
        except (TypeError, ValueError):
            continue
    return out


def heat_intelligence_pdf(
    lat: float, lon: float, temperature: float, date: str, timeout: float = 20.0
) -> dict[str, Any]:
    key = cache.cache_key("heat_intelligence", round(lat, 5), round(lon, 5), round(temperature, 2), date)
    hit = cache.load(key)
    if hit and hit.get("filename"):
        path = OUTPUT_DIR / hit["filename"]
        if path.exists():
            hit["cached"] = True
            return hit

    client = get_client()
    captured: dict[str, str] = {}
    orig = client._submit

    def _capture(path: str, payload: dict) -> str:
        activity_id = orig(path, payload)
        captured["activity_id"] = activity_id
        return activity_id

    client._submit = _capture  # type: ignore[method-assign]
    pending = OUTPUT_DIR / "heat_intelligence_pending.pdf"
    try:
        pdf_path = client.heat_intelligence(
            latitude=lat,
            longitude=lon,
            temperature=temperature,
            date=date,
            analysis=("geographic", "environmental", "urban"),
            output_path=pending,
            verbose=False,
            timeout=timeout,
        )
    except FortyGuardError:
        client._submit = orig  # type: ignore[method-assign]
        raise
    client._submit = orig  # type: ignore[method-assign]

    activity_id = captured.get("activity_id") or "unknown"
    final_name = f"heat_intelligence_{activity_id}.pdf"
    final = OUTPUT_DIR / final_name
    Path(pdf_path).replace(final)
    stored = {
        "activity_id": activity_id,
        "filename": final_name,
        "download_url": f"/v1/outputs/{final_name}",
        "cached": False,
    }
    cache.save(key, stored)
    return stored


def _hour_from_time(start_time: str) -> int:
    try:
        return int(str(start_time).split(":")[0])
    except (TypeError, ValueError, IndexError):
        return 15


def _index_for_hour(timestamps: list[Any], hour: int) -> int | None:
    for i, stamp in enumerate(timestamps):
        text = str(stamp)
        try:
            clock = text.split("T", 1)[1]
            if int(clock.split(":")[0]) == hour:
                return i
        except (IndexError, ValueError):
            continue
    if 0 <= hour < len(timestamps):
        return hour
    return 0 if timestamps else None
