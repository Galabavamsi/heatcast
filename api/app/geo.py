"""AOI geometry helpers. Coordinates are [lon, lat]."""

from __future__ import annotations

import math
from typing import Any

from shapely.geometry import shape

MAX_AREA_MI2 = 45.0


def aoi_from_bbox(west: float, south: float, east: float, north: float) -> dict[str, Any]:
    west, east = (west, east) if west <= east else (east, west)
    south, north = (south, north) if south <= north else (north, south)
    ring = [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
    ]
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {},
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            }
        ],
    }


def aoi_from_geojson(raw: dict[str, Any]) -> dict[str, Any]:
    if raw.get("type") == "FeatureCollection" and raw.get("features"):
        geom = raw["features"][0].get("geometry")
    elif raw.get("type") == "Feature":
        geom = raw.get("geometry")
    elif raw.get("type") in {"Polygon", "MultiPolygon"}:
        geom = raw
    else:
        raise ValueError("AOI must be a GeoJSON Polygon, Feature, or FeatureCollection.")
    if not geom or geom.get("type") not in {"Polygon", "MultiPolygon"}:
        raise ValueError("AOI geometry must be a Polygon.")
    return {
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "properties": {}, "geometry": geom}],
    }


def bbox_of_aoi(polygon_aoi: dict[str, Any]) -> tuple[float, float, float, float]:
    geom = shape(polygon_aoi["features"][0]["geometry"])
    west, south, east, north = geom.bounds
    return float(west), float(south), float(east), float(north)


def polygon_area_mi2(polygon_aoi: dict[str, Any]) -> float:
    geom = shape(polygon_aoi["features"][0]["geometry"])
    lat = geom.centroid.y
    km2 = geom.area * (111.32 * math.cos(math.radians(lat))) * 110.57
    return km2 / 2.589988


def aoi_centroid(polygon_aoi: dict[str, Any]) -> tuple[float, float]:
    """Return (lat, lon) of the AOI polygon centroid."""
    geom = shape(polygon_aoi["features"][0]["geometry"])
    return float(geom.centroid.y), float(geom.centroid.x)


def in_us(lon: float, lat: float) -> bool:
    """Loose US coverage boxes (CONUS, Alaska, Hawaii). FortyGuard is US-only."""
    if -125.0 <= lon <= -66.5 and 24.4 <= lat <= 49.5:
        return True
    if -170.0 <= lon <= -129.0 and 51.0 <= lat <= 72.0:
        return True
    if -161.0 <= lon <= -154.0 and 18.5 <= lat <= 22.5:
        return True
    return False


def timezone_for(lon: float, lat: float) -> str:
    if -161.0 <= lon <= -154.0 and 18.5 <= lat <= 22.5:
        return "Pacific/Honolulu"
    if lon <= -129.0 and lat >= 51.0:
        return "America/Anchorage"
    if lon <= -115.0:
        return "America/Los_Angeles" if lat < 42 else "America/Los_Angeles"
    if lon <= -100.0:
        return "America/Phoenix" if 31.0 <= lat <= 37.5 and lon >= -115.0 else "America/Denver"
    if lon <= -87.0:
        return "America/Chicago"
    return "America/New_York"


def expand_bbox(
    west: float, south: float, east: float, north: float, factor: float
) -> tuple[float, float, float, float]:
    cx = (west + east) / 2
    cy = (south + north) / 2
    hx = (east - west) / 2 * factor
    hy = (north - south) / 2 * factor
    return cx - hx, cy - hy, cx + hx, cy + hy
