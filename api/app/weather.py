"""Open-Meteo precipitation (no key) plus optional USGS elevation."""

from __future__ import annotations

from typing import Any

import requests

from . import cache

ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
FORECAST = "https://api.open-meteo.com/v1/forecast"
EPQS = "https://epqs.nationalmap.gov/v1/json"


def fetch_precip(
    lat: float,
    lon: float,
    date: str,
    hour: str | None = None,
    timezone: str = "America/Chicago",
) -> dict[str, Any]:
    key = cache.cache_key("openmeteo_climate_v2", round(lat, 4), round(lon, 4), date, timezone)
    hit = cache.load(key)
    if hit is not None:
        hit["cached"] = True
        return _with_hour(hit, hour)

    payload = _open_meteo(ARCHIVE, lat, lon, date, timezone)
    if payload is None or payload.get("daily_precip_mm") is None:
        payload = _open_meteo(FORECAST, lat, lon, date, timezone) or payload

    stored = payload or {
        "source": "open-meteo",
        "ok": False,
        "error": "No precipitation returned",
        "daily_precip_mm": None,
        "precip_hours": None,
        "hourly_precip_mm": [],
        "attribution": "Weather data by Open-Meteo.com (CC BY 4.0)",
        "caveat": "Reanalysis / model grid (several km), not FortyGuard 100 m tiles. Rain context only — not a hydro model.",
    }
    stored["cached"] = False
    cache.save(key, stored)
    return _with_hour(stored, hour)


def fetch_elevation_m(lat: float, lon: float) -> float | None:
    key = cache.cache_key("usgs_epqs", round(lat, 4), round(lon, 4))
    hit = cache.load(key)
    if hit is not None:
        return hit.get("elevation_m")
    try:
        resp = requests.get(
            EPQS,
            params={"x": lon, "y": lat, "units": "Meters", "wkid": 4326, "includeDate": "false"},
            timeout=8,
            headers={"User-Agent": "HeatCast/0.3 (FortyGuard hackathon FG-141)"},
        )
        resp.raise_for_status()
        data = resp.json()
        raw = data.get("value")
        elev = float(raw) if raw is not None and str(raw) not in {"", "-1000000"} else None
    except (requests.RequestException, TypeError, ValueError):
        return None
    if elev is None:
        return None
    cache.save(key, {"elevation_m": elev})
    return elev


def _open_meteo(base: str, lat: float, lon: float, date: str, timezone: str) -> dict[str, Any] | None:
    params = {
        "latitude": round(lat, 5),
        "longitude": round(lon, 5),
        "start_date": date,
        "end_date": date,
        "hourly": "precipitation,temperature_2m,relative_humidity_2m,wind_speed_10m,apparent_temperature",
        "daily": "precipitation_sum,precipitation_hours,rain_sum",
        "timezone": timezone,
        "wind_speed_unit": "ms",
    }
    try:
        resp = requests.get(base, params=params, timeout=12)
        resp.raise_for_status()
        data = resp.json()
    except (requests.RequestException, ValueError):
        return None
    daily = data.get("daily") or {}
    hourly = data.get("hourly") or {}
    daily_mm = _first_num(daily.get("precipitation_sum"))
    if daily_mm is None:
        daily_mm = _first_num(daily.get("rain_sum"))
    source = "open-meteo-archive" if "archive" in base else "open-meteo-forecast"
    hourly = data.get("hourly") or {}
    return {
        "ok": daily_mm is not None,
        "source": source,
        "lat": lat,
        "lon": lon,
        "date": date,
        "timezone": data.get("timezone") or timezone,
        "utc_offset_seconds": data.get("utc_offset_seconds"),
        "daily_precip_mm": daily_mm,
        "precip_hours": _first_num(daily.get("precipitation_hours")),
        "hourly_times": hourly.get("time") or [],
        "hourly_precip_mm": hourly.get("precipitation") or [],
        "hourly_temp_c": hourly.get("temperature_2m") or [],
        "hourly_rh": hourly.get("relative_humidity_2m") or [],
        "hourly_wind_ms": hourly.get("wind_speed_10m") or [],
        "hourly_apparent_c": hourly.get("apparent_temperature") or [],
        "attribution": "Weather data by Open-Meteo.com (CC BY 4.0)",
        "caveat": (
            "Open-Meteo reanalysis/forecast grid is several km — evaporative cooling context, "
            "not a hydrology model and not FortyGuard 100 m air tiles."
        ),
    }


def _with_hour(payload: dict[str, Any], hour: str | None) -> dict[str, Any]:
    out = dict(payload)
    out["hour_precip_mm"] = None
    out["comfort"] = None
    if not hour:
        return out
    want = str(hour).split(":")[0].zfill(2)
    times = out.get("hourly_times") or []
    idx = None
    for i, stamp in enumerate(times):
        text = str(stamp)
        clock = text.split("T", 1)[1] if "T" in text else text
        if clock.startswith(want):
            idx = i
            break
    if idx is None:
        return out
    values = out.get("hourly_precip_mm") or []
    if idx < len(values):
        try:
            mm = values[idx]
            out["hour_precip_mm"] = None if mm is None else float(mm)
        except (TypeError, ValueError):
            out["hour_precip_mm"] = None
    out["comfort"] = _comfort_at(out, idx)
    return out


def _series_at(payload: dict[str, Any], key: str, idx: int) -> float | None:
    values = payload.get(key) or []
    if idx >= len(values):
        return None
    try:
        raw = values[idx]
        return None if raw is None else float(raw)
    except (TypeError, ValueError):
        return None


def heat_index_c(temp_c: float, rh: float) -> float:
    """NWS Rothfusz heat index. Input °C and %, output °C."""
    t = temp_c * 9.0 / 5.0 + 32.0
    r = max(0.0, min(100.0, rh))
    if t < 80:
        hi_f = 0.5 * (t + 61.0 + (t - 68.0) * 1.2 + r * 0.094)
    else:
        hi_f = (
            -42.379
            + 2.04901523 * t
            + 10.14333127 * r
            - 0.22475541 * t * r
            - 0.00683783 * t * t
            - 0.05481717 * r * r
            + 0.00122874 * t * t * r
            + 0.00085282 * t * r * r
            - 0.00000199 * t * t * r * r
        )
    return round((hi_f - 32.0) * 5.0 / 9.0, 1)


def _hi_category(hi_c: float) -> str:
    if hi_c < 27:
        return "caution"
    if hi_c < 32:
        return "extreme caution"
    if hi_c < 41:
        return "danger"
    return "extreme danger"


def _comfort_at(payload: dict[str, Any], idx: int) -> dict[str, Any]:
    temp_c = _series_at(payload, "hourly_temp_c", idx)
    rh = _series_at(payload, "hourly_rh", idx)
    wind = _series_at(payload, "hourly_wind_ms", idx)
    apparent = _series_at(payload, "hourly_apparent_c", idx)
    hi = heat_index_c(temp_c, rh) if temp_c is not None and rh is not None else None
    return {
        "temp_c": temp_c,
        "rh_pct": rh,
        "wind_ms": wind,
        "apparent_c": apparent,
        "heat_index_c": hi,
        "category": _hi_category(hi) if hi is not None else None,
        "metric": "NWS heat index",
        "note": (
            "Heat index from Open-Meteo 2 m T + RH at the scored hour. "
            "Not UTCI (needs mean radiant temperature) and not FortyGuard tiles."
        ),
    }


def _first_num(values: Any) -> float | None:
    if isinstance(values, (int, float)):
        return float(values)
    if isinstance(values, list) and values:
        try:
            return None if values[0] is None else float(values[0])
        except (TypeError, ValueError):
            return None
    return None

