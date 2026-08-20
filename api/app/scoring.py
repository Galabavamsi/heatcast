"""Score FortyGuard tiles for a district AOI."""

from __future__ import annotations

from typing import Any

_TEMP_KEYS = ("temperature", "max_temperature", "average_temperature")
_HOURS_KEYS = ("hours", "hours_above")


def _as_float(val: Any) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def tile_temperature_c(props: dict[str, Any]) -> float | None:
    """Prefer real °C fields. `value` is hours on exceedance tiles — last resort only."""
    for key in _TEMP_KEYS:
        num = _as_float(props.get(key))
        if num is not None:
            return num
    return _as_float(props.get("value"))


def tile_hours(props: dict[str, Any]) -> float | None:
    for key in _HOURS_KEYS:
        num = _as_float(props.get(key))
        if num is not None:
            return num
    has_temp = any(props.get(k) is not None for k in _TEMP_KEYS)
    if has_temp:
        return None
    return _as_float(props.get("value"))


def _close_ring(ring: Any) -> Any:
    if not isinstance(ring, list) or len(ring) < 3:
        return ring
    first, last = ring[0], ring[-1]
    if first != last:
        return list(ring) + [first]
    return ring


def _normalize_geometry(geom: Any) -> dict[str, Any] | None:
    if not isinstance(geom, dict):
        return None
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if gtype == "Polygon" and isinstance(coords, list) and coords:
        return {"type": "Polygon", "coordinates": [_close_ring(ring) for ring in coords]}
    if gtype == "MultiPolygon" and isinstance(coords, list) and coords:
        return {
            "type": "MultiPolygon",
            "coordinates": [[_close_ring(ring) for ring in poly] for poly in coords if poly],
        }
    if gtype in {"Polygon", "MultiPolygon"} and coords is not None:
        return {"type": str(gtype), "coordinates": coords}
    return None


def slim_heatmap(features: list[dict[str, Any]], max_features: int = 1800) -> dict[str, Any]:
    step = max(1, len(features) // max_features) if len(features) > max_features else 1
    slim = []
    for ft in features[::step]:
        if not isinstance(ft, dict):
            continue
        geom = _normalize_geometry(ft.get("geometry"))
        if geom is None:
            continue
        props = ft.get("properties") or {}
        temp = None
        for key in _TEMP_KEYS:
            temp = _as_float(props.get(key))
            if temp is not None:
                break
        hours = tile_hours(props)
        out_props: dict[str, Any] = {"tile_id": props.get("tile_id")}
        if temp is not None:
            out_props["temperature"] = round(temp, 4)
        if hours is not None:
            out_props["hours"] = round(hours, 4)
            out_props["value"] = round(hours, 4)
        slim.append({"type": "Feature", "geometry": geom, "properties": out_props})
    return {"type": "FeatureCollection", "features": slim}


def apply_cooling_overlay(heatmap: dict[str, Any], delta_c: float) -> dict[str, Any]:
    """Shift displayed tile °C. Overlay is a model, not a new FortyGuard heatmap."""
    if not delta_c:
        return heatmap
    features = []
    for ft in heatmap.get("features") or []:
        props = dict(ft.get("properties") or {})
        temp = props.get("temperature")
        if isinstance(temp, (int, float)):
            props["measured_c"] = round(float(temp), 2)
            props["temperature"] = round(float(temp) - delta_c, 2)
            props["overlay"] = True
        features.append({**ft, "properties": props})
    return {"type": "FeatureCollection", "features": features}


def score_aoi(features: list[dict[str, Any]], threshold_c: float) -> dict[str, Any]:
    """Tile stats (tiles are nearly equal at 100 m)."""
    temps: list[tuple[float, dict[str, Any]]] = []
    hours: list[float] = []
    hotspot = None
    for ft in features:
        props = ft.get("properties") or {}
        temp = tile_temperature_c(props)
        if temp is None:
            continue
        temps.append((temp, ft))
        hr = tile_hours(props)
        if hr is not None:
            hours.append(hr)
        if hotspot is None or temp > hotspot["temperature_c"]:
            geom = ft.get("geometry") or {}
            coords = ((geom.get("coordinates") or [[]])[0] or [[0, 0]])
            xs = [c[0] for c in coords if isinstance(c, (list, tuple)) and len(c) >= 2]
            ys = [c[1] for c in coords if isinstance(c, (list, tuple)) and len(c) >= 2]
            lon = sum(xs) / len(xs) if xs else 0.0
            lat = sum(ys) / len(ys) if ys else 0.0
            hotspot = {
                "lon": round(lon, 5),
                "lat": round(lat, 5),
                "temperature_c": round(temp, 2),
                "tile_id": props.get("tile_id"),
            }
    n = len(temps)
    values = [t[0] for t in temps]
    above = sum(1 for t in values if t >= threshold_c)
    return {
        "tile_count": n,
        "mean_c": round(sum(values) / n, 2) if n else None,
        "max_c": round(max(values), 2) if n else None,
        "min_c": round(min(values), 2) if n else None,
        "share_above_threshold": round(above / n, 3) if n else None,
        "hotspot": hotspot,
        "mean_hours": round(sum(hours) / len(hours), 2) if hours else None,
        "max_hours": round(max(hours), 2) if hours else None,
    }
