"""Same-hour TCM difference across a Range window (To − From).

Not a heat flux and not an exceedance-hour difference. Two filter_type=1
snapshots at the scored clock hour, joined by tile_id or nearest centroid.
``grad`` is mean |ΔT − neighbor ΔT| on the slim grid — edges of change, noisy
at 100 m.
"""

from __future__ import annotations

import math
from typing import Any

from .scoring import slim_heatmap, tile_temperature_c

MATCH_MAX_M = 150.0
NEIGHBOR_MAX_M = 160.0
_CELL_DEG = 0.001  # ~100 m
_EARTH_M = 6_371_000.0


def _as_tile_id(props: dict[str, Any]) -> str | None:
    tid = props.get("tile_id")
    if tid is None or tid == "":
        return None
    return str(tid)


def feature_centroid(ft: dict[str, Any]) -> tuple[float, float] | None:
    geom = ft.get("geometry") or {}
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    ring = None
    if gtype == "Polygon" and isinstance(coords, list) and coords:
        ring = coords[0]
    elif gtype == "MultiPolygon" and isinstance(coords, list) and coords and coords[0]:
        ring = coords[0][0]
    elif gtype == "Point" and isinstance(coords, (list, tuple)) and len(coords) >= 2:
        try:
            return float(coords[0]), float(coords[1])
        except (TypeError, ValueError):
            return None
    if not isinstance(ring, list):
        return None
    xs: list[float] = []
    ys: list[float] = []
    for pt in ring:
        if isinstance(pt, (list, tuple)) and len(pt) >= 2:
            try:
                xs.append(float(pt[0]))
                ys.append(float(pt[1]))
            except (TypeError, ValueError):
                continue
    if not xs:
        return None
    return sum(xs) / len(xs), sum(ys) / len(ys)


def haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * _EARTH_M * math.asin(min(1.0, math.sqrt(a)))


def _cell(lon: float, lat: float) -> tuple[int, int]:
    return int(math.floor(lon / _CELL_DEG)), int(math.floor(lat / _CELL_DEG))


def _index_cells(rows: list[tuple[int, float, float, dict[str, Any]]]) -> dict[tuple[int, int], list[int]]:
    buckets: dict[tuple[int, int], list[int]] = {}
    for i, (_idx, lon, lat, _ft) in enumerate(rows):
        buckets.setdefault(_cell(lon, lat), []).append(i)
    return buckets


def _nearby_indices(
    buckets: dict[tuple[int, int], list[int]], lon: float, lat: float
) -> list[int]:
    cx, cy = _cell(lon, lat)
    out: list[int] = []
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            out.extend(buckets.get((cx + dx, cy + dy), ()))
    return out


def join_tiles(
    start_features: list[dict[str, Any]],
    end_features: list[dict[str, Any]],
    *,
    match_max_m: float = MATCH_MAX_M,
) -> list[tuple[dict[str, Any], dict[str, Any], str]]:
    """Pair end tiles to start tiles. Prefer ``tile_id``, else nearest centroid."""
    start_by_id: dict[str, dict[str, Any]] = {}
    start_pool: list[tuple[int, float, float, dict[str, Any]]] = []
    for i, ft in enumerate(start_features):
        if not isinstance(ft, dict):
            continue
        xy = feature_centroid(ft)
        if xy is None:
            continue
        tid = _as_tile_id(ft.get("properties") or {})
        if tid is not None and tid not in start_by_id:
            start_by_id[tid] = ft
        start_pool.append((i, xy[0], xy[1], ft))

    used_ids: set[str] = set()
    used_pool: set[int] = set()
    pairs: list[tuple[dict[str, Any], dict[str, Any], str]] = []
    unmatched_end: list[tuple[float, float, dict[str, Any]]] = []

    for ft in end_features:
        if not isinstance(ft, dict):
            continue
        props = ft.get("properties") or {}
        tid = _as_tile_id(props)
        if tid is not None and tid in start_by_id and tid not in used_ids:
            pairs.append((start_by_id[tid], ft, "tile_id"))
            used_ids.add(tid)
            continue
        xy = feature_centroid(ft)
        if xy is None:
            continue
        unmatched_end.append((xy[0], xy[1], ft))

    if start_by_id:
        for i, lon, lat, sft in start_pool:
            tid = _as_tile_id(sft.get("properties") or {})
            if tid is not None and tid in used_ids:
                used_pool.add(i)

    remaining = [(i, lon, lat, sft) for i, lon, lat, sft in start_pool if i not in used_pool]
    buckets = _index_cells(remaining)
    candidates: list[tuple[float, int, int]] = []
    for e_i, (elon, elat, _eft) in enumerate(unmatched_end):
        for s_local in _nearby_indices(buckets, elon, elat):
            _i, slon, slat, _sft = remaining[s_local]
            dist = haversine_m(elon, elat, slon, slat)
            if dist <= match_max_m:
                candidates.append((dist, e_i, s_local))
    candidates.sort(key=lambda row: row[0])
    taken_end: set[int] = set()
    taken_start: set[int] = set()
    for _dist, e_i, s_local in candidates:
        if e_i in taken_end or s_local in taken_start:
            continue
        taken_end.add(e_i)
        taken_start.add(s_local)
        pairs.append((remaining[s_local][3], unmatched_end[e_i][2], "nearest"))
    return pairs


def _delta_feature(start_ft: dict[str, Any], end_ft: dict[str, Any], delta_c: float) -> dict[str, Any]:
    geom = start_ft.get("geometry") or end_ft.get("geometry")
    start_props = start_ft.get("properties") or {}
    end_props = end_ft.get("properties") or {}
    tid = start_props.get("tile_id")
    if tid is None:
        tid = end_props.get("tile_id")
    rounded = round(float(delta_c), 4)
    return {
        "type": "Feature",
        "geometry": geom,
        "properties": {
            "tile_id": tid,
            "temperature": rounded,
            "delta_c": rounded,
            "delta_abs": round(abs(float(delta_c)), 4),
        },
    }


def annotate_grad(
    features: list[dict[str, Any]],
    *,
    neighbor_max_m: float = NEIGHBOR_MAX_M,
) -> list[dict[str, Any]]:
    """Crude |∇ΔT|: mean absolute difference vs adjacent slim-tile centroids."""
    rows: list[tuple[int, float, float, dict[str, Any], float]] = []
    for i, ft in enumerate(features):
        if not isinstance(ft, dict):
            continue
        xy = feature_centroid(ft)
        if xy is None:
            continue
        props = ft.get("properties") or {}
        val = props.get("delta_c")
        if val is None:
            val = props.get("temperature")
        try:
            delta = float(val)
        except (TypeError, ValueError):
            continue
        rows.append((i, xy[0], xy[1], ft, delta))

    index_rows = [(i, lon, lat, ft) for i, lon, lat, ft, _d in rows]
    buckets = _index_cells(index_rows)
    out: list[dict[str, Any]] = []
    for local, (_orig, lon, lat, ft, delta) in enumerate(rows):
        diffs: list[float] = []
        for other in _nearby_indices(buckets, lon, lat):
            if other == local:
                continue
            _oi, olon, olat, _oft, od = rows[other]
            if haversine_m(lon, lat, olon, olat) <= neighbor_max_m:
                diffs.append(abs(delta - od))
        props = dict(ft.get("properties") or {})
        props["grad"] = round(sum(diffs) / len(diffs), 4) if diffs else 0.0
        out.append({**ft, "properties": props})
    return out


def delta_stats(features: list[dict[str, Any]]) -> dict[str, Any]:
    vals: list[float] = []
    for ft in features:
        props = ft.get("properties") or {}
        raw = props.get("delta_c")
        if raw is None:
            raw = props.get("temperature")
        try:
            vals.append(float(raw))
        except (TypeError, ValueError):
            continue
    n = len(vals)
    return {
        "n_matched": n,
        "mean_delta": round(sum(vals) / n, 3) if n else None,
        "max_delta": round(max(vals), 3) if n else None,
        "min_delta": round(min(vals), 3) if n else None,
        "delta_abs_mean": round(sum(abs(v) for v in vals) / n, 3) if n else None,
    }


def build_delta_layer(
    start_features: list[dict[str, Any]],
    end_features: list[dict[str, Any]],
    *,
    hour: str,
    start_date: str,
    end_date: str,
    start_activity_id: str | None = None,
    end_activity_id: str | None = None,
    max_features: int = 1800,
) -> dict[str, Any] | None:
    """Join two TCM snapshots. Returns None when nothing can be differenced."""
    if not start_features or not end_features:
        return None
    pairs = join_tiles(start_features, end_features)
    delta_feats: list[dict[str, Any]] = []
    for start_ft, end_ft, _how in pairs:
        t0 = tile_temperature_c(start_ft.get("properties") or {})
        t1 = tile_temperature_c(end_ft.get("properties") or {})
        if t0 is None or t1 is None:
            continue
        delta_feats.append(_delta_feature(start_ft, end_ft, t1 - t0))
    if not delta_feats:
        return None
    stats = delta_stats(delta_feats)
    slim = slim_heatmap(delta_feats, max_features=max_features, extra_keys=("delta_c", "delta_abs"))
    slim_feats = annotate_grad(list(slim.get("features") or []))
    slim = {"type": "FeatureCollection", "features": slim_feats}
    return {
        "activity_id": end_activity_id,
        "start_activity_id": start_activity_id,
        "end_activity_id": end_activity_id,
        "analytic_type": "tcm_delta",
        "units": "°C",
        "hour": hour,
        "start_date": start_date,
        "end_date": end_date,
        "note": (
            "To − From at the same clock hour. Positive = hotter at the end of the window. "
            "Not a heat flux. Edges (|∇ΔT|) are noisy at 100 m."
        ),
        "heatmap": slim,
        **stats,
    }
