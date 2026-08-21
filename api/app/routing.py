"""Walking route to a nearby indoor site. OSRM public router — US only, fail-open."""

from __future__ import annotations

from typing import Any

import requests

from . import cache
from .geo import in_us

OSRM_WALK = "https://router.project-osrm.org/route/v1/walking/{lon1},{lat1};{lon2},{lat2}"
OSRM_PARAMS = {"overview": "full", "geometries": "geojson", "steps": "false"}
WALK_VERTEX_CAP = 120


def walk_route(from_lon: float, from_lat: float, to_lon: float, to_lat: float) -> dict[str, Any] | None:
    if not in_us(from_lon, from_lat) or not in_us(to_lon, to_lat):
        return None
    key = cache.cache_key(
        "osrm-walk-v2",
        round(from_lon, 5),
        round(from_lat, 5),
        round(to_lon, 5),
        round(to_lat, 5),
    )
    hit = cache.load(key)
    if hit is not None:
        hit["cached"] = True
        return hit
    url = OSRM_WALK.format(lon1=from_lon, lat1=from_lat, lon2=to_lon, lat2=to_lat)
    try:
        resp = requests.get(
            url,
            params=OSRM_PARAMS,
            timeout=8,
            headers={"User-Agent": "HeatCast/0.4 (FortyGuard hackathon FG-141)"},
        )
        resp.raise_for_status()
        data = resp.json()
    except (requests.RequestException, ValueError):
        return None
    routes = data.get("routes") or []
    if not routes:
        return None
    geom = (routes[0].get("geometry") or {}) if isinstance(routes[0], dict) else {}
    coords = geom.get("coordinates") if isinstance(geom, dict) else None
    if not isinstance(coords, list) or len(coords) < 2:
        return None
    slim = []
    for pt in coords[:WALK_VERTEX_CAP]:
        if not isinstance(pt, (list, tuple)) or len(pt) < 2:
            continue
        slim.append([float(pt[0]), float(pt[1])])
    if len(slim) < 2:
        return None
    stored = {
        "type": "LineString",
        "coordinates": slim,
        "distance_m": round(float(routes[0].get("distance") or 0), 1),
        "duration_s": round(float(routes[0].get("duration") or 0), 1),
        "profile": "walking",
        "source": "osrm",
        "cached": False,
        "note": "Walking directions from OSRM. Not an official cooling-center route.",
    }
    cache.save(key, stored)
    return stored
