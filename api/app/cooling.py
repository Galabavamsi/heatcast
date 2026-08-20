"""Indoor public sites that often serve as cooling centers (OSM, not FortyGuard)."""

from __future__ import annotations

from typing import Any

from .overpass import overpass_query
from . import cache as disk_cache
MAX_SITES = 40

KINDS = {
    "library": "Library",
    "community_centre": "Community centre",
    "social_facility": "Social facility",
    "townhall": "Town hall",
    "sports_centre": "Sports centre",
}

QUERY = """
[out:json][timeout:15];
(
  node["amenity"="library"]({s},{w},{n},{e});
  node["amenity"="community_centre"]({s},{w},{n},{e});
  node["amenity"="social_facility"]({s},{w},{n},{e});
  node["amenity"="townhall"]({s},{w},{n},{e});
  node["leisure"="sports_centre"]({s},{w},{n},{e});
  way["amenity"="library"]({s},{w},{n},{e});
  way["amenity"="community_centre"]({s},{w},{n},{e});
  way["amenity"="social_facility"]({s},{w},{n},{e});
  way["amenity"="townhall"]({s},{w},{n},{e});
  way["leisure"="sports_centre"]({s},{w},{n},{e});
);
out center tags 40;
"""


def fetch_cooling_centers(west: float, south: float, east: float, north: float) -> dict[str, Any]:
    cache_id = disk_cache.cache_key(
        "osm-cooling-v2", round(west, 4), round(south, 4), round(east, 4), round(north, 4)
    )
    cached = disk_cache.load(cache_id)
    if isinstance(cached, dict) and isinstance(cached.get("features"), list):
        return cached
    body = QUERY.format(w=west, s=south, e=east, n=north)
    data = overpass_query(body, timeout_s=20)
    features: list[dict[str, Any]] = []
    seen: set[tuple[float, float, str]] = set()
    for el in data.get("elements") or []:
        lat, lon = _center(el)
        if lat is None or lon is None:
            continue
        tags = el.get("tags") or {}
        kind_key = tags.get("amenity") or tags.get("leisure") or "site"
        kind = KINDS.get(kind_key, kind_key.replace("_", " ").title())
        name = (tags.get("name") or tags.get("official_name") or kind).strip()
        key = (round(lon, 5), round(lat, 5), name.lower())
        if key in seen:
            continue
        seen.add(key)
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "name": name,
                    "kind": kind,
                    "osm_id": el.get("id"),
                    "osm_type": el.get("type"),
                },
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
            }
        )
        if len(features) >= MAX_SITES:
            break
    result = {
        "type": "FeatureCollection",
        "features": features,
        "meta": {
            "count": len(features),
            "note": "OSM indoor public sites often used as cooling centers. Not an official cooling-center registry and not FortyGuard.",
        },
    }
    disk_cache.save(cache_id, result)
    return result


def _center(el: dict[str, Any]) -> tuple[float | None, float | None]:
    if "lat" in el and "lon" in el:
        return float(el["lat"]), float(el["lon"])
    center = el.get("center") or {}
    if "lat" in center and "lon" in center:
        return float(center["lat"]), float(center["lon"])
    geom = el.get("geometry") or []
    if not geom:
        return None, None
    lats = [pt["lat"] for pt in geom if "lat" in pt]
    lons = [pt["lon"] for pt in geom if "lon" in pt]
    if not lats or not lons:
        return None, None
    return sum(lats) / len(lats), sum(lons) / len(lons)
