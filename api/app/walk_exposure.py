"""Sample FortyGuard 2 m air along an OSRM walking path. Neighborhood walk, not cargo."""

from __future__ import annotations

from typing import Any

from .scoring import tile_hours, tile_temperature_c


def _centroid(geom: dict[str, Any] | None) -> tuple[float, float] | None:
    if not isinstance(geom, dict):
        return None
    coords = geom.get("coordinates")
    ring: list[Any] = []
    if geom.get("type") == "Polygon" and isinstance(coords, list) and coords:
        ring = coords[0] if isinstance(coords[0], list) else []
    elif geom.get("type") == "MultiPolygon" and isinstance(coords, list) and coords:
        first = coords[0] if coords else []
        ring = first[0] if isinstance(first, list) and first else []
    xs: list[float] = []
    ys: list[float] = []
    for pt in ring:
        if isinstance(pt, (list, tuple)) and len(pt) >= 2:
            xs.append(float(pt[0]))
            ys.append(float(pt[1]))
    if not xs:
        return None
    return sum(xs) / len(xs), sum(ys) / len(ys)


def _haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    from math import atan2, cos, radians, sin, sqrt

    r = 6371000.0
    p1, p2 = radians(lat1), radians(lat2)
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    x = sin(dlat / 2) ** 2 + cos(p1) * cos(p2) * sin(dlon / 2) ** 2
    return 2 * r * atan2(sqrt(x), sqrt(1 - x))


def _tile_points(heatmap: dict[str, Any] | None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for ft in (heatmap or {}).get("features") or []:
        if not isinstance(ft, dict):
            continue
        props = ft.get("properties") or {}
        temp = tile_temperature_c(props)
        if temp is None:
            continue
        center = _centroid(ft.get("geometry"))
        if center is None:
            continue
        out.append(
            {
                "lon": center[0],
                "lat": center[1],
                "temp_c": float(temp),
                "hours": tile_hours(props),
                "tile_id": props.get("tile_id"),
            }
        )
    return out


def nearest_tile(lon: float, lat: float, tiles: list[dict[str, Any]]) -> dict[str, Any] | None:
    best = None
    best_d = float("inf")
    for tile in tiles:
        d = _haversine_m(lon, lat, tile["lon"], tile["lat"])
        if d < best_d:
            best_d = d
            best = {**tile, "distance_m": round(d, 1)}
    return best


def hottest_stretch(samples: list[dict[str, Any]], window: int = 3) -> dict[str, Any] | None:
    if len(samples) < 1:
        return None
    w = max(1, min(window, len(samples)))
    best_i = 0
    best_mean = -1.0
    for i in range(0, len(samples) - w + 1):
        chunk = samples[i : i + w]
        temps = [s["temp_c"] for s in chunk if s.get("temp_c") is not None]
        if not temps:
            continue
        mean = sum(temps) / len(temps)
        if mean > best_mean:
            best_mean = mean
            best_i = i
    chunk = samples[best_i : best_i + w]
    return {
        "start_index": best_i,
        "end_index": best_i + len(chunk) - 1,
        "mean_c": round(best_mean, 2),
        "max_c": round(max(s["temp_c"] for s in chunk), 2),
        "from_m": chunk[0].get("along_m"),
        "to_m": chunk[-1].get("along_m"),
    }


def sample_walk_exposure(
    coordinates: list[list[float]],
    heatmap: dict[str, Any] | None,
    *,
    threshold_c: float = 35.0,
    max_samples: int = 24,
) -> dict[str, Any]:
    tiles = _tile_points(heatmap)
    if len(coordinates) < 2:
        return {
            "ok": False,
            "samples": [],
            "note": "Need a walking polyline.",
        }
    if not tiles:
        return {
            "ok": False,
            "samples": [],
            "note": "No FortyGuard air tiles to sample along the walk.",
        }
    step = max(1, len(coordinates) // max_samples) if len(coordinates) > max_samples else 1
    picked = coordinates[::step]
    if picked[-1] != coordinates[-1]:
        picked.append(coordinates[-1])
    samples: list[dict[str, Any]] = []
    along = 0.0
    prev = None
    for lon, lat in picked:
        if prev is not None:
            along += _haversine_m(prev[0], prev[1], lon, lat)
        tile = nearest_tile(lon, lat, tiles)
        samples.append(
            {
                "lon": round(lon, 5),
                "lat": round(lat, 5),
                "along_m": round(along, 1),
                "temp_c": None if tile is None else round(tile["temp_c"], 2),
                "hours": None if tile is None or tile.get("hours") is None else tile["hours"],
                "tile_id": None if tile is None else tile.get("tile_id"),
            }
        )
        prev = (lon, lat)
    temps = [s["temp_c"] for s in samples if s["temp_c"] is not None]
    return {
        "ok": True,
        "kind": "walk_tile_sample",
        "not_used": "cargo_vaccine_wbgt_osha",
        "threshold_c": threshold_c,
        "samples": samples,
        "mean_c": round(sum(temps) / len(temps), 2) if temps else None,
        "max_c": round(max(temps), 2) if temps else None,
        "share_above": round(sum(1 for t in temps if t >= threshold_c) / len(temps), 3) if temps else None,
        "hottest_stretch": hottest_stretch(samples),
        "distance_m": samples[-1]["along_m"] if samples else 0,
        "label": (
            "Nearest FortyGuard 2 m air tile along the OSRM walk. "
            "Neighborhood access check — not cargo, vaccines, or worker WBGT."
        ),
    }
