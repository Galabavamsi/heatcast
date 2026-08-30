"""Open-Meteo US AQI (free, no key). Not FortyGuard env_params. Not CO2/methane."""

from __future__ import annotations

from typing import Any

import requests

from . import cache

AIR = "https://air-quality-api.open-meteo.com/v1/air-quality"


def fetch_us_aqi(lat: float, lon: float, date: str, timezone: str = "America/Chicago") -> dict[str, Any]:
    key = cache.cache_key("openmeteo_us_aqi_v1", round(lat, 4), round(lon, 4), date, timezone)
    hit = cache.load(key)
    if hit is not None:
        hit["cached"] = True
        return hit
    try:
        resp = requests.get(
            AIR,
            params={
                "latitude": round(lat, 5),
                "longitude": round(lon, 5),
                "start_date": date,
                "end_date": date,
                "hourly": "us_aqi,pm2_5",
                "timezone": timezone,
            },
            timeout=12,
            headers={"User-Agent": "HeatCast/0.5 (FortyGuard hackathon FG-141)"},
        )
        resp.raise_for_status()
        data = resp.json()
    except (requests.RequestException, ValueError):
        stored = {
            "ok": False,
            "source": "open-meteo-air-quality",
            "us_aqi": [],
            "pm25": [],
            "times": [],
            "attribution": "Air-quality data by Open-Meteo.com (CC BY 4.0)",
            "caveat": (
                "Open-Meteo US AQI is a km-scale model, not FortyGuard env_params "
                "and not certified concentrations. No CO2 or methane."
            ),
        }
        stored["cached"] = False
        return stored
    hourly = data.get("hourly") or {}
    aqi = hourly.get("us_aqi") or []
    stored = {
        "ok": any(v is not None for v in aqi),
        "source": "open-meteo-air-quality",
        "lat": lat,
        "lon": lon,
        "date": date,
        "timezone": data.get("timezone") or timezone,
        "times": hourly.get("time") or [],
        "us_aqi": aqi,
        "pm25": hourly.get("pm2_5") or [],
        "attribution": "Air-quality data by Open-Meteo.com (CC BY 4.0)",
        "caveat": (
            "Open-Meteo US AQI is a km-scale model, not FortyGuard env_params "
            "and not certified concentrations. No CO2 or methane."
        ),
        "cached": False,
    }
    cache.save(key, stored)
    return stored
