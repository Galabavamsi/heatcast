"""OSM building footprints via Overpass — extruded in MapLibre, not FortyGuard."""

from __future__ import annotations

from typing import Any

from .overpass import overpass_query
from . import cache as disk_cache


def fetch_buildings(west: float, south: float, east: float, north: float) -> dict[str, Any]:
    key = disk_cache.cache_key("osm-buildings-v2", round(west, 4), round(south, 4), round(east, 4), round(north, 4))
    cached = disk_cache.load(key)
    if isinstance(cached, dict) and isinstance(cached.get("features"), list):
        return cached
    # Cap output so downtown boxes (Houston ~2 mi²) do not 504 Overpass.
    query = f"""
    [out:json][timeout:25][maxsize:33554432];
    way["building"]({south},{west},{north},{east});
    out geom 180;
    """
    data = overpass_query(query, timeout_s=28)
    features = []
    with_height = 0
    for el in data.get("elements") or []:
        geom = el.get("geometry") or []
        if len(geom) < 3:
            continue
        ring = [[pt["lon"], pt["lat"]] for pt in geom]
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        tags = el.get("tags") or {}
        height, source = _height_m(tags)
        if source != "default":
            with_height += 1
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "height": height,
                    "height_source": source,
                    "building": tags.get("building", "yes"),
                },
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            }
        )
    n = len(features)
    if n > 400:
        features = features[:400]
    result = {
        "type": "FeatureCollection",
        "features": features,
        "meta": {
            "count": n,
            "returned": len(features),
            "with_measured_height": with_height,
            "height_coverage": round(with_height / n, 3) if n else 0,
            "note": "Heights from OSM height or levels×3.5 m; else assumed 9 m. Shade is geometry, not FortyGuard.",
        },
    }
    disk_cache.save(key, result)
    return result


def _height_m(tags: dict[str, str]) -> tuple[float, str]:
    raw = tags.get("height") or tags.get("building:height")
    if raw:
        try:
            return float(str(raw).replace("m", "").strip()), "height"
        except ValueError:
            pass
    levels = tags.get("building:levels") or tags.get("levels")
    if levels:
        try:
            return float(levels) * 3.5, "levels"
        except ValueError:
            pass
    return 9.0, "default"
