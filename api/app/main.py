"""HeatCast FastAPI — urban planner district heat + estimated canopy overlay."""

from __future__ import annotations

import os
import sys
from concurrent.futures import ThreadPoolExecutor, wait
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator

API_ROOT = Path(__file__).resolve().parent.parent
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

load_dotenv(API_ROOT / ".env")

from fortyguard import FortyGuardError, TaskFailedError  # noqa: E402

from .buildings import fetch_buildings  # noqa: E402
from .cooling import fetch_cooling_centers  # noqa: E402
from .cities import CITIES, CITY_ORDER, get_city  # noqa: E402
from .dates import duration_note, duration_window  # noqa: E402
from .fg import (  # noqa: E402
    OUTPUT_DIR,
    cached_call,
    cached_heatmap,
    class_percents,
    drop_images,
    env_snapshot,
    get_client,
    heatmap_features,
    heatmap_stats,
    heat_intelligence_pdf,
    is_coverage_miss,
    strip_secrets,
)
from .flood import fetch_flood_zone  # noqa: E402
from .geo import (  # noqa: E402
    MAX_AREA_MI2,
    aoi_centroid,
    aoi_from_bbox,
    aoi_from_geojson,
    bbox_of_aoi,
    in_us,
    polygon_area_mi2,
    timezone_for,
)
from .landcover import bucket_classes  # noqa: E402
from .memo import write_memo  # noqa: E402
from .scenario import estimate_scenario, scenario_model_meta  # noqa: E402
from .routing import walk_route  # noqa: E402
from .delta import build_delta_layer  # noqa: E402
from .scoring import score_aoi, slim_heatmap  # noqa: E402
from .svi import SviError, svi_for_bbox  # noqa: E402  # CDC SVI 2022 overlay
from .unrelieved import unrelieved_scorecard  # noqa: E402
from .air_quality import fetch_us_aqi  # noqa: E402
from .cooling_plan import estimate_cooling_plan  # noqa: E402
from .hours_infer import infer_compound_hours, infer_peak_hours  # noqa: E402
from .walk_exposure import sample_walk_exposure  # noqa: E402
from .weather import fetch_elevation_m, fetch_precip, public_hourly  # noqa: E402

ENRICH_CORE_S = 45.0
ENRICH_EXTRA_S = 12.0

app = FastAPI(title="HeatCast", version="0.4.0")


def _cors_origins() -> list[str]:
    extra = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
    return [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        *extra,
    ]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


class AnalyzeRequest(BaseModel):
    start_date: str
    start_time: str
    end_date: str | None = None
    city_id: str | None = None
    bbox: list[float] | None = None
    aoi: dict[str, Any] | None = None
    name: str | None = None
    threshold_c: float | None = None
    include_exceedance: bool = True
    include_persistence: bool = True
    canopy_delta_pct: float = 0.0
    current_canopy_pct: float | None = None

    @field_validator("end_date", mode="before")
    @classmethod
    def _empty_end_date(cls, value: object) -> object:
        if value == "":
            return None
        return value


class EnrichRequest(BaseModel):
    lat: float
    lon: float
    temperature: float
    date: str
    time: str = Field(default="15:00")


class ScenarioRequest(BaseModel):
    canopy_delta_pct: float
    current_canopy_pct: float | None = None
    mean_c: float | None = None
    mean_hours: float | None = None
    threshold_c: float = 35.0


class SviRequest(BaseModel):
    west: float | None = None
    south: float | None = None
    east: float | None = None
    north: float | None = None
    bbox: list[float] | None = None
    heatmap: dict[str, Any] | None = None


class CoolingPlanRequest(BaseModel):
    canopy_delta_pct: float = 0.0
    roof_delta_pct: float = 0.0
    pavement_delta_pct: float = 0.0
    current_canopy_pct: float | None = None
    mean_c: float | None = None
    mean_hours: float | None = None
    threshold_c: float = 35.0


class WalkExposureRequest(BaseModel):
    coordinates: list[list[float]]
    heatmap: dict[str, Any] | None = None
    threshold_c: float = 35.0


class BriefRequest(BaseModel):
    city: str | None = None
    scorecard: dict[str, Any]
    rain: dict[str, Any] | None = None
    flood: dict[str, Any] | None = None
    scenario: dict[str, Any] | None = None
    coverage_miss: bool = False
    satellite_buckets: dict[str, Any] | None = None
    streetview_classes: dict[str, Any] | None = None
    svi: dict[str, Any] | None = None
    cooling: dict[str, Any] | None = None
    shade: dict[str, Any] | None = None
    activity_ids: dict[str, Any] | None = None


@app.get("/health")
def health() -> dict[str, object]:
    return {"ok": True, "service": "heatcast"}


@app.get("/v1/cities")
def cities() -> dict[str, object]:
    ordered = [CITIES[cid] for cid in CITY_ORDER if cid in CITIES]
    return {"default_city_id": "houston-eado", "cities": ordered, "scenario_model": scenario_model_meta()}


@app.get("/v1/credits")
def credits() -> JSONResponse:
    try:
        usage = get_client().fetch_api_key_usage()
    except FortyGuardError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return JSONResponse(strip_secrets(usage))


@app.get("/v1/geocode")
def geocode(q: str, limit: int = 6) -> dict[str, object]:
    query = (q or "").strip()
    if len(query) < 2:
        return {"results": []}
    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": query,
                "format": "jsonv2",
                "addressdetails": 1,
                "limit": max(1, min(limit, 8)),
                "countrycodes": "us",
            },
            headers={"User-Agent": "HeatCast/0.4 (hackathon district heat)"},
            timeout=12,
        )
        resp.raise_for_status()
        rows = []
        for item in resp.json() or []:
            lon = float(item["lon"])
            lat = float(item["lat"])
            if not in_us(lon, lat):
                continue
            bbox_raw = item.get("boundingbox") or []
            bbox = None
            if len(bbox_raw) == 4:
                south, north, west, east = (float(v) for v in bbox_raw)
                bbox = [west, south, east, north]
            rows.append(
                {
                    "name": item.get("display_name"),
                    "lat": lat,
                    "lon": lon,
                    "bbox": bbox,
                    "kind": item.get("type") or item.get("class"),
                }
            )
        return {"results": rows}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Place search failed: {exc}") from exc


def _osm_empty(error: str, note: str) -> dict[str, object]:
    return {
        "type": "FeatureCollection",
        "features": [],
        "meta": {"count": 0, "error": error, "note": note},
    }


@app.get("/v1/buildings")
def buildings(
    west: float | None = None,
    south: float | None = None,
    east: float | None = None,
    north: float | None = None,
    city_id: str | None = None,
) -> dict[str, object]:
    if None not in (west, south, east, north):
        box = (float(west), float(south), float(east), float(north))
    elif city_id:
        try:
            city = get_city(city_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=f"Unknown city_id {city_id}") from exc
        box = tuple(city["bbox"])
    else:
        raise HTTPException(status_code=400, detail="Pass bbox west,south,east,north")
    w, s, e, n = box
    if not in_us(w, s) or not in_us(e, n):
        raise HTTPException(status_code=400, detail="Buildings lookup is US-only.")
    try:
        return fetch_buildings(w, s, e, n)
    except Exception as exc:
        return _osm_empty(f"OSM buildings failed: {exc}", "OSM buildings lookup failed.")


@app.get("/v1/cooling")
def cooling(
    west: float | None = None,
    south: float | None = None,
    east: float | None = None,
    north: float | None = None,
) -> dict[str, object]:
    if None in (west, south, east, north):
        raise HTTPException(status_code=400, detail="Pass bbox west,south,east,north")
    w, s, e, n = float(west), float(south), float(east), float(north)
    if not in_us(w, s) or not in_us(e, n):
        raise HTTPException(status_code=400, detail="Cooling-center lookup is US-only.")
    try:
        return fetch_cooling_centers(w, s, e, n)
    except Exception as exc:
        return _osm_empty(f"OSM cooling sites failed: {exc}", "OSM cooling lookup failed.")


@app.get("/v1/osm")
def osm_layers(
    west: float | None = None,
    south: float | None = None,
    east: float | None = None,
    north: float | None = None,
) -> dict[str, object]:
    """Cooling POIs then building footprints — sequential so Overpass is not double-hit."""
    if None in (west, south, east, north):
        raise HTTPException(status_code=400, detail="Pass bbox west,south,east,north")
    w, s, e, n = float(west), float(south), float(east), float(north)
    if not in_us(w, s) or not in_us(e, n):
        raise HTTPException(status_code=400, detail="OSM overlay is US-only.")
    cooling: dict[str, object]
    buildings: dict[str, object]
    try:
        cooling = fetch_cooling_centers(w, s, e, n)
    except Exception as exc:
        cooling = _osm_empty(str(exc), "OSM cooling lookup failed.")
    try:
        buildings = fetch_buildings(w, s, e, n)
    except Exception as extra:
        buildings = _osm_empty(str(extra), "OSM buildings lookup failed.")
    return {"cooling": cooling, "buildings": buildings}


@app.get("/v1/walk")
def walk(
    from_lon: float,
    from_lat: float,
    to_lon: float,
    to_lat: float,
) -> dict[str, object]:
    """Walking polyline from hotspot to an indoor site. US-only, fail-open."""
    if not in_us(from_lon, from_lat) or not in_us(to_lon, to_lat):
        raise HTTPException(status_code=400, detail="Walking routes are US-only.")
    route = walk_route(from_lon, from_lat, to_lon, to_lat)
    if route is None:
        return {"ok": False, "coordinates": [], "note": "No walking route for these points."}
    return {"ok": True, **route}


@app.get("/v1/weather")
def weather(
    date: str = "2024-07-15",
    time: str = "15:00",
    lat: float | None = None,
    lon: float | None = None,
    city_id: str | None = None,
) -> dict[str, object]:
    tz = "America/Chicago"
    if lat is not None and lon is not None:
        if not in_us(lon, lat):
            raise HTTPException(status_code=400, detail="Weather lookup is US-only.")
        tz = timezone_for(lon, lat)
    elif city_id:
        try:
            city = get_city(city_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=f"Unknown city_id {city_id}") from exc
        lat, lon = aoi_centroid(city["aoi"])
        tz = city.get("timezone") or timezone_for(lon, lat)
    else:
        raise HTTPException(status_code=400, detail="Pass lat,lon")
    rain = fetch_precip(lat, lon, date, hour=time, timezone=tz)
    flood = fetch_flood_zone(lat, lon)
    elevation_m = fetch_elevation_m(lat, lon)
    aqi = fetch_us_aqi(lat, lon, date, timezone=tz)
    return {
        "lat": lat,
        "lon": lon,
        "date": date,
        "time": time,
        "timezone": tz,
        "rain": _public_rain(rain),
        "comfort": rain.get("comfort") if rain else None,
        "hourly": public_hourly(rain),
        "aqi": {
            "ok": aqi.get("ok"),
            "source": aqi.get("source"),
            "us_aqi": aqi.get("us_aqi") or [],
            "pm25": aqi.get("pm25") or [],
            "times": aqi.get("times") or [],
            "attribution": aqi.get("attribution"),
            "caveat": aqi.get("caveat"),
            "cached": aqi.get("cached"),
        },
        "flood": flood,
        "elevation_m": elevation_m,
    }


def _svi_box(
    west: float | None,
    south: float | None,
    east: float | None,
    north: float | None,
    bbox: list[float] | None = None,
) -> tuple[float, float, float, float]:
    if bbox and len(bbox) == 4:
        west, south, east, north = (float(v) for v in bbox)
    if None in (west, south, east, north):
        raise HTTPException(status_code=400, detail="Pass bbox west,south,east,north")
    return float(west), float(south), float(east), float(north)


def _svi_payload(
    west: float,
    south: float,
    east: float,
    north: float,
    heatmap: dict[str, Any] | None = None,
) -> dict[str, object]:
    try:
        return svi_for_bbox(west, south, east, north, heatmap=heatmap)
    except SviError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except requests.Timeout as exc:
        raise HTTPException(status_code=504, detail="CDC SVI timed out. Try a smaller box.") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"CDC SVI overlay failed: {exc}") from exc


@app.get("/v1/svi")
def svi_get(
    west: float | None = None,
    south: float | None = None,
    east: float | None = None,
    north: float | None = None,
) -> dict[str, object]:
    w, s, e, n = _svi_box(west, south, east, north)
    return _svi_payload(w, s, e, n)


@app.post("/v1/svi")
def svi_post(body: SviRequest) -> dict[str, object]:
    w, s, e, n = _svi_box(body.west, body.south, body.east, body.north, body.bbox)
    return _svi_payload(w, s, e, n, heatmap=body.heatmap)


@app.post("/v1/scenario")
def scenario(body: ScenarioRequest) -> dict[str, object]:
    return estimate_scenario(
        canopy_delta_pct=body.canopy_delta_pct,
        current_canopy_pct=body.current_canopy_pct,
        mean_c=body.mean_c,
        mean_hours=body.mean_hours,
        threshold_c=body.threshold_c,
    )


@app.post("/v1/tools/cooling")
def tools_cooling(body: CoolingPlanRequest) -> dict[str, object]:
    """Literature cooling-plan attribution. Does not call FortyGuard."""
    return estimate_cooling_plan(
        canopy_delta_pct=body.canopy_delta_pct,
        roof_delta_pct=body.roof_delta_pct,
        pavement_delta_pct=body.pavement_delta_pct,
        current_canopy_pct=body.current_canopy_pct,
        mean_c=body.mean_c,
        mean_hours=body.mean_hours,
        threshold_c=body.threshold_c,
    )


@app.post("/v1/tools/walk-exposure")
def tools_walk_exposure(body: WalkExposureRequest) -> dict[str, object]:
    """Nearest TCM tile along an OSRM walk. No new heatmap."""
    return sample_walk_exposure(
        body.coordinates,
        body.heatmap,
        threshold_c=body.threshold_c,
    )


@app.get("/v1/tools/hours")
def tools_hours(
    date: str = "2024-07-15",
    time: str = "15:00",
    lat: float | None = None,
    lon: float | None = None,
    threshold_c: float = 35.0,
) -> dict[str, object]:
    """Open-Meteo hour-by-hour heat-load + optional US AQI. Not FG tiles."""
    if lat is None or lon is None:
        raise HTTPException(status_code=400, detail="Pass lat,lon")
    if not in_us(lon, lat):
        raise HTTPException(status_code=400, detail="Hours lookup is US-only.")
    tz = timezone_for(lon, lat)
    rain = fetch_precip(lat, lon, date, hour=time, timezone=tz)
    hourly = public_hourly(rain) or {}
    aqi = fetch_us_aqi(lat, lon, date, timezone=tz)
    peak = infer_peak_hours(
        times=hourly.get("times") or [],
        temps=hourly.get("temp_c") or [],
        ghi=hourly.get("ghi_wm2") or [],
        threshold_c=threshold_c,
    )
    compound = infer_compound_hours(
        times=hourly.get("times") or [],
        temps=hourly.get("temp_c") or [],
        rh=hourly.get("rh_pct") or [],
        us_aqi=aqi.get("us_aqi") or [],
        threshold_c=threshold_c,
    )
    return {
        "lat": lat,
        "lon": lon,
        "date": date,
        "time": time,
        "timezone": tz,
        "threshold_c": threshold_c,
        "hourly": hourly,
        "aqi": {
            "ok": aqi.get("ok"),
            "source": aqi.get("source"),
            "us_aqi": aqi.get("us_aqi") or [],
            "attribution": aqi.get("attribution"),
            "caveat": aqi.get("caveat"),
        },
        "peak": peak,
        "compound": compound,
        "comfort": rain.get("comfort") if rain else None,
    }


def _resolve_aoi(body: AnalyzeRequest) -> tuple[dict[str, Any], str, str | None]:
    if body.bbox and len(body.bbox) == 4:
        west, south, east, north = (float(v) for v in body.bbox)
        aoi = aoi_from_bbox(west, south, east, north)
        label = body.name or "Custom area"
        return aoi, label, None
    if body.aoi:
        aoi = aoi_from_geojson(body.aoi)
        label = body.name or "Custom area"
        return aoi, label, None
    if body.city_id:
        city = get_city(body.city_id)
        return city["aoi"], city["name"], city["id"]
    raise HTTPException(status_code=400, detail="Draw a box on the map or search a US place.")


def _tcm_snapshot(
    aoi: dict[str, Any],
    *,
    start_date: str,
    start_time: str,
) -> dict[str, Any] | None:
    """Single-hour TCM. Fail-open for the Range end snapshot."""
    try:
        return cached_heatmap(
            aoi,
            start_date=start_date,
            start_time=start_time,
            filter_type=1,
            granularity=100,
            analytic_type="tcm",
            live=True,
        )
    except (TaskFailedError, FortyGuardError):
        return None


def _duration_payload(
    aoi: dict[str, Any],
    *,
    start_date: str,
    end_date: str | None,
    filter_type: int,
    threshold: float,
    analytic_type: str,
    live: bool,
) -> tuple[dict[str, Any] | None, str | None]:
    """Exceedance (total hours) or persistence (longest consecutive streak). Fail-open."""
    try:
        raw = cached_heatmap(
            aoi,
            start_date=start_date,
            start_time=None,
            end_date=end_date,
            filter_type=filter_type,
            granularity=100,
            analytic_type=analytic_type,
            threshold=threshold,
            direction="above",
            live=live,
        )
    except (TaskFailedError, FortyGuardError):
        return None, None
    if not raw:
        return None, None
    activity_id = raw.get("activity_id")
    result = raw.get("result") or {}
    features = heatmap_features(result)
    stats = heatmap_stats(result, features)
    score = score_aoi(features, threshold)
    return (
        {
            "cached": raw.get("cached"),
            "activity_id": activity_id,
            "analytic_type": analytic_type,
            "stats": stats,
            "mean_hours": score.get("mean_hours") or stats.get("mean"),
            "max_hours": score.get("max_hours") or stats.get("max"),
            "units": "hour",
            "heatmap": slim_heatmap(features, max_features=1800),
        },
        activity_id if isinstance(activity_id, str) else None,
    )


@app.post("/v1/analyze")
def analyze(body: AnalyzeRequest) -> dict[str, object]:
    try:
        aoi, place_name, city_id = _resolve_aoi(body)
    except HTTPException:
        raise
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown city_id {body.city_id}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        area_mi2 = polygon_area_mi2(aoi)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if area_mi2 < 0.04:
        raise HTTPException(status_code=400, detail="Area is too small — drag a larger neighborhood box.")
    if area_mi2 > MAX_AREA_MI2:
        raise HTTPException(
            status_code=400,
            detail=f"Area is {area_mi2:.1f} mi² (limit {MAX_AREA_MI2:.0f} mi²). Shrink the box.",
        )

    lat, lon = aoi_centroid(aoi)
    if not in_us(lon, lat):
        raise HTTPException(status_code=400, detail="Temperature coverage is the United States only.")

    threshold = body.threshold_c if body.threshold_c is not None else (38.0 if lat > 32.5 and lon < -110 else 35.0)
    try:
        window = duration_window(body.start_date, body.end_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    datetime_label = (
        f"{window.start_date}T{body.start_time}"
        if window.end_date is None
        else f"{window.start_date}T{body.start_time}/{window.end_date}"
    )
    tz = timezone_for(lon, lat)
    west, south, east, north = bbox_of_aoi(aoi)

    try:
        tcm = cached_heatmap(
            aoi,
            start_date=window.start_date,
            start_time=body.start_time,
            filter_type=1,
            granularity=100,
            analytic_type="tcm",
            live=True,
        )
    except TaskFailedError as exc:
        raise HTTPException(status_code=502, detail=f"Heatmap task failed: {exc}") from exc
    except FortyGuardError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    tcm = tcm or {}
    tcm_result = tcm.get("result") or {}
    features = heatmap_features(tcm_result)
    stats = heatmap_stats(tcm_result, features)
    coverage_miss = is_coverage_miss(features, stats)
    aoi_score = score_aoi([] if coverage_miss else features, threshold)
    hotspot = None if coverage_miss else aoi_score.get("hotspot")
    activity_id = tcm.get("activity_id")

    exceedance_payload = None
    exceedance_id = None
    persistence_payload = None
    persistence_id = None
    tcm_end_raw = None
    duration_jobs: dict[str, tuple[str, bool]] = {}
    if body.include_exceedance:
        duration_jobs["exceedance"] = ("exceedance", body.include_exceedance)
    if body.include_persistence:
        duration_jobs["persistence"] = ("persistence", body.include_persistence)
    need_end_tcm = window.end_date is not None
    extra_workers = 1 if need_end_tcm else 0
    if duration_jobs or need_end_tcm:
        pool = ThreadPoolExecutor(max_workers=max(1, len(duration_jobs) + extra_workers))
        try:
            futs = {
                pool.submit(
                    _duration_payload,
                    aoi,
                    start_date=window.start_date,
                    end_date=window.end_date,
                    filter_type=window.filter_type,
                    threshold=threshold,
                    analytic_type=kind,
                    live=live,
                ): name
                for name, (kind, live) in duration_jobs.items()
            }
            if need_end_tcm and window.end_date:
                futs[
                    pool.submit(
                        _tcm_snapshot,
                        aoi,
                        start_date=window.end_date,
                        start_time=body.start_time,
                    )
                ] = "tcm_end"
            for fut, name in futs.items():
                if name == "tcm_end":
                    tcm_end_raw = fut.result()
                    continue
                payload, activity = fut.result()
                if name == "exceedance":
                    exceedance_payload, exceedance_id = payload, activity
                else:
                    persistence_payload, persistence_id = payload, activity
        finally:
            pool.shutdown(wait=False, cancel_futures=True)

    delta_payload = None
    tcm_end_id = None
    if need_end_tcm and tcm_end_raw and not coverage_miss:
        end_result = tcm_end_raw.get("result") or {}
        end_features = heatmap_features(end_result)
        end_stats = heatmap_stats(end_result, end_features)
        if not is_coverage_miss(end_features, end_stats):
            raw_end_id = tcm_end_raw.get("activity_id")
            tcm_end_id = raw_end_id if isinstance(raw_end_id, str) else None
            start_id = activity_id if isinstance(activity_id, str) else None
            try:
                delta_payload = build_delta_layer(
                    features,
                    end_features,
                    hour=body.start_time,
                    start_date=window.start_date,
                    end_date=window.end_date or window.start_date,
                    start_activity_id=start_id,
                    end_activity_id=tcm_end_id,
                )
            except Exception:
                delta_payload = None

    rain = fetch_precip(
        lat,
        lon,
        window.start_date,
        hour=body.start_time,
        timezone=tz,
    )
    flood = fetch_flood_zone(lat, lon)

    warning = None
    if coverage_miss:
        warning = (
            f"Heatmap completed with 0 tiles for {place_name} at {datetime_label}. "
            "This is a coverage miss, not 0°C. Historic summer dates (e.g. 2024-07-15) usually have data."
        )

    mean_hours = None if not exceedance_payload else exceedance_payload.get("mean_hours")
    mean_streak = None if not persistence_payload else persistence_payload.get("mean_hours")
    unrelieved = unrelieved_scorecard(mean_streak, mean_hours)
    scenario = estimate_scenario(
        canopy_delta_pct=body.canopy_delta_pct,
        current_canopy_pct=body.current_canopy_pct,
        mean_c=aoi_score.get("mean_c"),
        mean_hours=mean_hours,
        threshold_c=threshold,
    )

    slim_stats = {k: stats[k] for k in ("n_cells", "feature_count", "units", "mean", "max", "min") if k in stats}
    if coverage_miss:
        slim_stats["mean"] = None
        slim_stats["max"] = None
        slim_stats["min"] = None

    scorecard = {
        "mean_c": aoi_score.get("mean_c"),
        "max_c": aoi_score.get("max_c"),
        "min_c": aoi_score.get("min_c"),
        "share_above_threshold": aoi_score.get("share_above_threshold"),
        "threshold_c": threshold,
        "mean_hours_above": mean_hours,
        "max_hours_above": None if not exceedance_payload else exceedance_payload.get("max_hours"),
        "mean_streak_hours": mean_streak,
        "max_streak_hours": None if not persistence_payload else persistence_payload.get("max_hours"),
        "unrelieved_heat_ratio": None if not unrelieved else unrelieved.get("ratio"),
        "unrelieved": unrelieved,
    }

    memo_doc = write_memo(
        {
            "city": place_name,
            "scorecard": scorecard,
            "rain": _public_rain(rain),
            "flood": flood,
            "scenario": scenario,
            "coverage_miss": coverage_miss,
            "activity_ids": {
                "tcm": activity_id,
                "exceedance": exceedance_id,
                "persistence": persistence_id,
            },
        },
        use_llm=False,
    )

    heatmap = slim_heatmap([] if coverage_miss else features)

    return {
        "city": {"id": city_id or "custom", "name": place_name, "mode": "urban"},
        "place_name": place_name,
        "aoi": aoi,
        "bbox": [west, south, east, north],
        "aoi_area_mi2": round(area_mi2, 3),
        "centroid": {"lat": lat, "lon": lon},
        "scorecard": scorecard,
        "rain": _public_rain(rain),
        "comfort": rain.get("comfort") if rain else None,
        "flood": flood,
        "scenario": scenario,
        "scenario_model": scenario_model_meta(),
        "memo": memo_doc.get("text"),
        "memo_meta": {"source": memo_doc.get("source"), "model": memo_doc.get("model")},
        "heatmap": heatmap,
        "exceedance": exceedance_payload,
        "persistence": persistence_payload,
        "delta": delta_payload,
        "stats": slim_stats,
        "hotspot": hotspot,
        "warning": warning,
        "coverage_miss": coverage_miss,
        "confidence": {
            "activity_id": activity_id,
            "datetime": datetime_label,
            "units": "°C",
            "tile_count": 0 if coverage_miss else stats.get("feature_count") or 0,
            "n_cells": 0 if coverage_miss else stats.get("n_cells") or 0,
            "coverage_miss": coverage_miss,
            "cached": bool(tcm.get("cached")),
            "city_id": city_id or "custom",
            "granularity_m": 100,
            "filter_type": 1,
            "duration_filter_type": window.filter_type,
            "duration_days": window.days,
            "end_date": window.end_date,
            "duration_note": duration_note(window),
            "analytic_type": "tcm",
            "threshold_c": threshold,
            "scale_note": (
                "Tiles are ~100 m neighborhood UHI, not sidewalk CFD. "
                "Hours = total time above threshold; streak = longest consecutive run. "
                "Unrelieved-heat ratio = streak ÷ hours (HeatCast index, 0–1). "
                "Range ΔT is To − From at the scored hour (two TCM snapshots), not a heat flux. "
                "Tree sketch is a literature overlay, not a new heatmap."
            ),
        },
        "activity_ids": {
            "tcm": activity_id,
            "exceedance": exceedance_id,
            "persistence": persistence_id,
            "tcm_end": tcm_end_id,
        },
    }


def _enrich_call(name: str, fn):
    try:
        return name, fn(), None
    except Exception as exc:  # noqa: BLE001 — surface any Premium failure as a chip
        return name, None, str(exc)


def _run_enrich_jobs(jobs: dict[str, Any], timeout_s: float) -> tuple[dict[str, object], dict[str, str]]:
    collected: dict[str, object] = {}
    errors: dict[str, str] = {}
    if not jobs:
        return collected, errors
    pool = ThreadPoolExecutor(max_workers=max(1, len(jobs)))
    try:
        futs = {pool.submit(_enrich_call, name, fn): name for name, fn in jobs.items()}
        done, pending = wait(futs, timeout=timeout_s)
        for fut in done:
            name, payload, err = fut.result()
            if err:
                errors[name] = err
            else:
                collected[name] = payload
        for fut in pending:
            errors[futs[fut]] = f"timeout after {timeout_s:.0f}s"
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return collected, errors


@app.post("/v1/brief")
def brief(body: BriefRequest) -> dict[str, object]:
    """Rewrite the planner brief after satellite / SVI / OSM layers land."""
    memo_doc = write_memo(body.model_dump(), use_llm=True)
    return {
        "text": memo_doc.get("text"),
        "source": memo_doc.get("source"),
        "model": memo_doc.get("model"),
    }


@app.post("/v1/enrich")
def enrich(body: EnrichRequest) -> dict[str, object]:
    """Premium hotspot layers. Satellite + env first; streetview/PDF are optional extras."""
    errors: dict[str, str] = {}
    activity_ids: dict[str, str | None] = {}
    env_out = None
    sat_out = None
    sv_out = None
    intel_out = None

    client = get_client()
    loc_parts = [round(body.lat, 5), round(body.lon, 5), round(body.temperature, 2), body.date, body.time]

    def env_fn():
        return cached_call(
            "env_params",
            loc_parts,
            lambda: client.environmental_parameters(
                latitude=body.lat,
                longitude=body.lon,
                temperature=body.temperature,
                start_date=body.date,
                start_time=body.time,
                filter_type=1,
                analysis=(
                    "apparent_temperature_celsius",
                    "wet_bulb_temperature_celsius",
                    "relative_humidity_percent",
                    "precipitation_mm",
                ),
                verbose=False,
                timeout=ENRICH_CORE_S,
            ),
        )

    def sat_fn():
        return cached_call(
            "satellite",
            loc_parts,
            lambda: client.satellite_segmentation(
                latitude=body.lat,
                longitude=body.lon,
                start_date=body.date,
                start_time=body.time,
                filter_type=1,
                granularity=100,
                verbose=False,
                timeout=ENRICH_CORE_S,
            ),
        )

    def sv_fn():
        return cached_call(
            "streetview",
            [round(body.lat, 5), round(body.lon, 5)],
            lambda: client.street_view_segmentation(
                latitude=body.lat,
                longitude=body.lon,
                verbose=False,
                timeout=ENRICH_EXTRA_S,
            ),
        )

    def intel_fn():
        return heat_intelligence_pdf(
            body.lat, body.lon, body.temperature, body.date, timeout=ENRICH_EXTRA_S
        )

    collected, core_errors = _run_enrich_jobs(
        {"env_params": env_fn, "satellite": sat_fn},
        ENRICH_CORE_S + 2.0,
    )
    errors.update(core_errors)
    extra, extra_errors = _run_enrich_jobs(
        {"streetview": sv_fn, "heat_intelligence": intel_fn},
        ENRICH_EXTRA_S + 1.0,
    )
    collected.update(extra)
    errors.update(extra_errors)

    env = collected.get("env_params")
    if isinstance(env, dict):
        activity_ids["env_params"] = env.get("activity_id")
        env_out = {
            "activity_id": env.get("activity_id"),
            "cached": env.get("cached"),
            **env_snapshot(env.get("result") or {}, body.time),
        }

    sat = collected.get("satellite")
    if isinstance(sat, dict):
        activity_ids["satellite"] = sat.get("activity_id")
        sat_result = drop_images(sat.get("result") or {})
        percents = class_percents(sat_result)
        sat_out = {
            "activity_id": sat.get("activity_id"),
            "cached": sat.get("cached"),
            "classes_percent": percents,
            "buckets": bucket_classes(percents),
        }

    sv = collected.get("streetview")
    if isinstance(sv, dict):
        activity_ids["streetview"] = sv.get("activity_id")
        sv_result = drop_images(sv.get("result") or {})
        sv_out = {
            "activity_id": sv.get("activity_id"),
            "cached": sv.get("cached"),
            "classes_percent": class_percents(sv_result),
        }

    intel = collected.get("heat_intelligence")
    if isinstance(intel, dict):
        intel_out = intel
        activity_ids["heat_intelligence"] = intel.get("activity_id")

    return {
        "lat": body.lat,
        "lon": body.lon,
        "temperature_c": body.temperature,
        "date": body.date,
        "time": body.time,
        "env_params": env_out,
        "satellite": sat_out,
        "streetview": sv_out,
        "heat_intelligence": intel_out,
        "activity_ids": activity_ids,
        "errors": errors or None,
    }


@app.get("/v1/outputs/{filename}")
def download_output(filename: str) -> FileResponse:
    if "/" in filename or "\\" in filename or filename.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = OUTPUT_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path, media_type="application/pdf", filename=filename)


def _public_rain(rain: dict[str, object] | None) -> dict[str, object] | None:
    if not rain:
        return None
    return {
        "ok": rain.get("ok"),
        "source": rain.get("source"),
        "daily_precip_mm": rain.get("daily_precip_mm"),
        "precip_hours": rain.get("precip_hours"),
        "hour_precip_mm": rain.get("hour_precip_mm"),
        "attribution": rain.get("attribution"),
        "caveat": rain.get("caveat"),
        "cached": rain.get("cached"),
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=False)
