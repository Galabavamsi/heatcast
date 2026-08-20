"""US demo districts. FortyGuard coverage is United States only."""

from __future__ import annotations

from typing import Any


def _box(west: float, south: float, east: float, north: float) -> dict[str, Any]:
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


CITIES: dict[str, dict[str, Any]] = {
    "houston-eado": {
        "id": "houston-eado",
        "name": "Houston EaDo",
        "city_name": "Houston, TX",
        "blurb": "East Downtown fabric + pads — heat lasts here. Construction / outdoor-work hours.",
        "center": {"lon": -95.348, "lat": 29.756},
        "zoom": 14,
        "bbox": [-95.358, 29.750, -95.338, 29.762],
        "timezone": "America/Chicago",
        "default_date": "2024-07-15",
        "default_time": "15:00",
        "threshold_c": 35.0,
        "mode": "construction",
        "aoi": _box(-95.358, 29.750, -95.338, 29.762),
    },
    "houston-museum": {
        "id": "houston-museum",
        "name": "Houston Museum District",
        "city_name": "Houston, TX",
        "blurb": "Greener contrast tract — same day, fewer hours above threshold.",
        "center": {"lon": -95.390, "lat": 29.725},
        "zoom": 14,
        "bbox": [-95.398, 29.718, -95.380, 29.732],
        "timezone": "America/Chicago",
        "default_date": "2024-07-15",
        "default_time": "15:00",
        "threshold_c": 35.0,
        "mode": "urban",
        "aoi": _box(-95.398, 29.718, -95.380, 29.732),
    },
    "phoenix-downtown": {
        "id": "phoenix-downtown",
        "name": "Phoenix Downtown",
        "city_name": "Phoenix, AZ",
        "blurb": "Historic summer only. 2026-08-17 can return 0 tiles — use 2024-07-15.",
        "center": {"lon": -112.074, "lat": 33.448},
        "zoom": 14,
        "bbox": [-112.090, 33.440, -112.060, 33.460],
        "timezone": "America/Phoenix",
        "default_date": "2024-07-15",
        "default_time": "15:00",
        "threshold_c": 38.0,
        "mode": "urban",
        "aoi": _box(-112.090, 33.440, -112.060, 33.460),
    },
}

CITY_ORDER = ["houston-eado", "houston-museum", "phoenix-downtown"]


def get_city(city_id: str) -> dict[str, Any]:
    city = CITIES.get(city_id)
    if not city:
        raise KeyError(city_id)
    return city
