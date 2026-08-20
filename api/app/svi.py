"""CDC/ATSDR Social Vulnerability Index 2022 (census tract) overlay.

HeatCast fetches bbox-clipped tracts from CDC's public FeatureServer (no key)
and optionally joins FortyGuard TCM tile centroids. SVI is overlay context —
FortyGuard does not produce vulnerability scores.

Priority index (HeatCast overlay, not a CDC product):
    svi = RPL_THEMES in [0, 1]   # overall SVI percentile; -999 excluded
    heat_norm = (tract_mean_c - aoi_min_c) / (aoi_max_c - aoi_min_c)
              using FortyGuard TCM tile centroids that fall in the tract.
              If aoi_max_c == aoi_min_c, heat_norm = 1 for tracts with tiles.
    priority = svi * heat_norm
"""

from __future__ import annotations

import math
import time
from threading import Lock
from typing import Any, Callable

import requests
from shapely.geometry import Point, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.strtree import STRtree
from shapely.validation import make_valid

from .geo import MAX_AREA_MI2, aoi_from_bbox, in_us, polygon_area_mi2
from .scoring import tile_temperature_c

SVI_LAYER = (
    "https://onemap.cdc.gov/onemapservices/rest/services/"
    "SVI/CDC_ATSDR_Social_Vulnerability_Index_2022_USA/FeatureServer/2/query"
)
SVI_SOURCE = "CDC/ATSDR Social Vulnerability Index 2022 (US census tract)"
SVI_SOURCE_URL = "https://www.atsdr.cdc.gov/placeandhealth/svi/index.html"
PRIORITY_FORMULA = (
    "priority = SVI_percentile × heat_norm, where SVI_percentile is CDC/ATSDR "
    "SVI 2022 RPL_THEMES (0–1) and heat_norm = (tract mean FortyGuard TCM − min "
    "TCM in box) / (max TCM − min TCM in box)"
)
HIGH_SVI = 0.75
HOT_THIRD = 2.0 / 3.0
USER_AGENT = "HeatCast/0.4 (planner heat × vulnerability overlay)"
TIMEOUT_S = 18
TTL_S = 6 * 3600
MAX_TRACTS = 400
SIMPLIFY_DEG = 0.00018
OUT_FIELDS = (
    "LOCATION,FIPS,COUNTY,STATE,ST_ABBR,E_TOTPOP,"
    "RPL_THEMES,RPL_THEME1,RPL_THEME2,RPL_THEME3,RPL_THEME4"
)

_LOCK = Lock()
_MEM: dict[str, tuple[float, dict[str, Any]]] = {}


class SviError(ValueError):
    """Invalid SVI request (bbox / coverage)."""


def svi_for_bbox(
    west: float,
    south: float,
    east: float,
    north: float,
    heatmap: dict[str, Any] | None = None,
) -> dict[str, Any]:
    west, south, east, north = _validate_bbox(west, south, east, north)
    tracts, cached = _cached_tracts(west, south, east, north)
    joined = False
    if heatmap and (heatmap.get("features") or []):
        tracts = join_heat_to_tracts(tracts, heatmap)
        joined = True
    summary, top = summarize_svi(tracts, joined=joined)
    summary["cached"] = cached
    return {
        "type": "FeatureCollection",
        "features": tracts["features"],
        "summary": summary,
        "top_priority": top,
    }


def _validate_bbox(west: float, south: float, east: float, north: float) -> tuple[float, float, float, float]:
    west, east = (west, east) if west <= east else (east, west)
    south, north = (south, north) if south <= north else (north, south)
    aoi = aoi_from_bbox(west, south, east, north)
    try:
        area = polygon_area_mi2(aoi)
    except Exception as exc:
        raise SviError("Could not measure that box.") from exc
    if area < 0.04:
        raise SviError("Area is too small — drag a larger neighborhood box.")
    if area > MAX_AREA_MI2:
        raise SviError(f"Area is {area:.1f} mi² (limit {MAX_AREA_MI2:.0f} mi²). Shrink the box.")
    lat = (south + north) / 2
    lon = (west + east) / 2
    if not in_us(west, south) or not in_us(east, north) or not in_us(lon, lat):
        raise SviError("SVI overlay is the United States only.")
    return west, south, east, north


def _cache_key(west: float, south: float, east: float, north: float) -> str:
    return "svi22:" + ",".join(f"{v:.4f}" for v in (west, south, east, north))


def _cached_tracts(west: float, south: float, east: float, north: float) -> tuple[dict[str, Any], bool]:
    key = _cache_key(west, south, east, north)
    now = time.monotonic()
    with _LOCK:
        hit = _MEM.get(key)
        if hit and now - hit[0] < TTL_S:
            return _clone_fc(hit[1]), True
    fetched = query_cdc_bbox(west, south, east, north)
    with _LOCK:
        if len(_MEM) >= 48:
            oldest = min(_MEM, key=lambda k: _MEM[k][0])
            _MEM.pop(oldest, None)
        _MEM[key] = (time.monotonic(), fetched)
    return _clone_fc(fetched), False


def _clone_fc(fc: dict[str, Any]) -> dict[str, Any]:
    features = []
    for ft in fc.get("features") or []:
        props = dict(ft.get("properties") or {})
        features.append({"type": "Feature", "id": ft.get("id") or props.get("fips"), "properties": props, "geometry": ft.get("geometry")})
    return {"type": "FeatureCollection", "features": features}


def query_cdc_bbox(
    west: float,
    south: float,
    east: float,
    north: float,
    fetch: Callable[..., requests.Response] | None = None,
) -> dict[str, Any]:
    """Bbox-clipped SVI 2022 tracts. Never downloads the national file."""
    get = fetch or requests.post
    features: list[dict[str, Any]] = []
    offset = 0
    while offset < MAX_TRACTS:
        params = {
            "where": "1=1",
            "geometry": f"{west},{south},{east},{north}",
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": OUT_FIELDS,
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
            "resultOffset": str(offset),
            "resultRecordCount": str(min(2000, MAX_TRACTS - offset)),
            "maxAllowableOffset": str(SIMPLIFY_DEG),
        }
        try:
            resp = get(
                SVI_LAYER,
                data=params,
                timeout=TIMEOUT_S,
                headers={"User-Agent": USER_AGENT},
            )
            if resp.status_code >= 400:
                resp = requests.get(
                    SVI_LAYER,
                    params=params,
                    timeout=TIMEOUT_S,
                    headers={"User-Agent": USER_AGENT},
                )
        except TypeError:
            resp = requests.get(
                SVI_LAYER,
                params=params,
                timeout=TIMEOUT_S,
                headers={"User-Agent": USER_AGENT},
            )
        except requests.RequestException:
            resp = requests.get(
                SVI_LAYER,
                params=params,
                timeout=TIMEOUT_S,
                headers={"User-Agent": USER_AGENT},
            )
        resp.raise_for_status()
        payload = resp.json()
        if isinstance(payload, dict) and payload.get("error"):
            msg = payload["error"]
            if isinstance(msg, dict):
                msg = msg.get("message") or msg
            raise RuntimeError(f"CDC SVI query failed: {msg}")
        batch = _slim_collection(payload)
        features.extend(batch)
        n = len((payload or {}).get("features") or []) if isinstance(payload, dict) else 0
        exceeded = bool(isinstance(payload, dict) and payload.get("exceededTransferLimit"))
        if not exceeded or n == 0:
            break
        offset += n
    return {"type": "FeatureCollection", "features": features[:MAX_TRACTS]}


def _slim_collection(raw: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not raw or raw.get("type") != "FeatureCollection":
        # Esri JSON fallback
        rows = (raw or {}).get("features") or []
        out = []
        for row in rows:
            attrs = row.get("attributes") or row.get("properties") or {}
            geom = _esri_geom_to_geojson(row.get("geometry")) if row.get("geometry") and "rings" in (row.get("geometry") or {}) else row.get("geometry")
            slim = _slim_feature(attrs, geom)
            if slim:
                out.append(slim)
        return out
    out = []
    for ft in raw.get("features") or []:
        slim = _slim_feature(ft.get("properties") or {}, ft.get("geometry"))
        if slim:
            out.append(slim)
    return out


def _svi_value(raw: Any) -> float | None:
    if raw is None:
        return None
    try:
        num = float(raw)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(num) or num < 0:
        return None
    return max(0.0, min(1.0, num))


def _theme(raw: Any) -> float | None:
    val = _svi_value(raw)
    return None if val is None else round(val, 4)


def _short_name(location: str | None, fips: str) -> str:
    text = (location or "").strip()
    if not text:
        return f"Tract {fips}" if fips else "Census tract"
    return text.split(";")[0].strip() or text


def _simplify_geom(geom: dict[str, Any] | None) -> dict[str, Any] | None:
    if not geom or geom.get("type") not in {"Polygon", "MultiPolygon"}:
        return None
    try:
        g: BaseGeometry = shape(geom)
        if g.is_empty:
            return None
        if not g.is_valid:
            g = make_valid(g)
        simple = g.simplify(SIMPLIFY_DEG, preserve_topology=True)
        if simple.is_empty:
            return None
        mapped = mapping(simple)
        if mapped.get("type") not in {"Polygon", "MultiPolygon"}:
            return geom
        return mapped
    except Exception:
        return geom


def _slim_feature(attrs: dict[str, Any], geom: dict[str, Any] | None) -> dict[str, Any] | None:
    svi = _svi_value(attrs.get("RPL_THEMES") if "RPL_THEMES" in attrs else attrs.get("svi"))
    if svi is None:
        return None
    geometry = _simplify_geom(geom)
    if geometry is None:
        return None
    fips = str(attrs.get("FIPS") or attrs.get("fips") or "").strip()
    location = attrs.get("LOCATION") or attrs.get("location")
    name = _short_name(str(location) if location else None, fips)
    pop = attrs.get("E_TOTPOP") if "E_TOTPOP" in attrs else attrs.get("population")
    try:
        population = int(pop) if pop is not None and int(pop) >= 0 else None
    except (TypeError, ValueError):
        population = None
    props = {
        "fips": fips,
        "name": name,
        "location": location,
        "county": attrs.get("COUNTY") or attrs.get("county"),
        "state": attrs.get("STATE") or attrs.get("state") or attrs.get("ST_ABBR"),
        "svi": round(svi, 4),
        "svi_pct": int(round(svi * 100)),
        "theme1": _theme(attrs.get("RPL_THEME1") if "RPL_THEME1" in attrs else attrs.get("theme1")),
        "theme2": _theme(attrs.get("RPL_THEME2") if "RPL_THEME2" in attrs else attrs.get("theme2")),
        "theme3": _theme(attrs.get("RPL_THEME3") if "RPL_THEME3" in attrs else attrs.get("theme3")),
        "theme4": _theme(attrs.get("RPL_THEME4") if "RPL_THEME4" in attrs else attrs.get("theme4")),
        "population": population,
        "high_svi": svi >= HIGH_SVI,
    }
    return {"type": "Feature", "id": fips or name, "properties": props, "geometry": geometry}


def _esri_geom_to_geojson(geom: dict[str, Any] | None) -> dict[str, Any] | None:
    rings = (geom or {}).get("rings")
    if not rings:
        return None
    return {"type": "Polygon", "coordinates": rings}


def _tile_samples(heatmap: dict[str, Any]) -> list[tuple[float, float, float]]:
    samples: list[tuple[float, float, float]] = []
    for ft in heatmap.get("features") or []:
        if not isinstance(ft, dict):
            continue
        temp = tile_temperature_c(ft.get("properties") or {})
        if temp is None:
            continue
        geom = ft.get("geometry")
        if not geom:
            continue
        try:
            g = shape(geom)
            if g.is_empty:
                continue
            if not g.is_valid:
                g = make_valid(g)
            c = g.centroid
            samples.append((float(c.x), float(c.y), float(temp)))
        except Exception:
            continue
    return samples


def join_heat_to_tracts(tracts: dict[str, Any], heatmap: dict[str, Any]) -> dict[str, Any]:
    """Spatial join: FortyGuard tile centroids → intersecting SVI tracts."""
    features = list(tracts.get("features") or [])
    if not features:
        return tracts
    samples = _tile_samples(heatmap)
    geoms: list[BaseGeometry] = []
    valid_idx: list[int] = []
    for i, ft in enumerate(features):
        try:
            g = shape(ft.get("geometry"))
            if not g.is_valid:
                g = make_valid(g)
            geoms.append(g)
            valid_idx.append(i)
        except Exception:
            continue
    if not geoms or not samples:
        return {"type": "FeatureCollection", "features": features}

    tree = STRtree(geoms)
    buckets: dict[int, list[float]] = {i: [] for i in valid_idx}
    temps = [t for _, _, t in samples]
    aoi_min = min(temps)
    aoi_max = max(temps)
    span = aoi_max - aoi_min
    ordered = sorted(temps)
    p66_i = min(len(ordered) - 1, max(0, int(math.floor(HOT_THIRD * (len(ordered) - 1)))))
    p66 = ordered[p66_i]

    for x, y, temp in samples:
        pt = Point(x, y)
        hits = tree.query(pt)
        matched = None
        for raw in hits:
            gi = int(raw) if not isinstance(raw, BaseGeometry) else geoms.index(raw)
            if gi < 0 or gi >= len(geoms):
                continue
            try:
                if geoms[gi].covers(pt):
                    matched = valid_idx[gi]
                    break
            except Exception:
                continue
        if matched is None:
            continue
        buckets[matched].append(temp)

    for i, ft in enumerate(features):
        props = dict(ft.get("properties") or {})
        vals = buckets.get(i) or []
        if not vals:
            props.update(
                {
                    "mean_c": None,
                    "max_c": None,
                    "tile_count": 0,
                    "heat_norm": None,
                    "priority": None,
                    "in_hottest_third": False,
                }
            )
            ft["properties"] = props
            continue
        mean_c = sum(vals) / len(vals)
        heat_norm = 1.0 if span <= 1e-9 else max(0.0, min(1.0, (mean_c - aoi_min) / span))
        svi = float(props.get("svi") or 0)
        props.update(
            {
                "mean_c": round(mean_c, 2),
                "max_c": round(max(vals), 2),
                "tile_count": len(vals),
                "heat_norm": round(heat_norm, 4),
                "priority": round(svi * heat_norm, 4),
                "in_hottest_third": mean_c >= p66,
            }
        )
        ft["properties"] = props
    return {"type": "FeatureCollection", "features": features}


def summarize_svi(tracts: dict[str, Any], joined: bool = False) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    features = tracts.get("features") or []
    svis: list[float] = []
    rows: list[dict[str, Any]] = []
    for ft in features:
        props = dict(ft.get("properties") or {})
        svi = props.get("svi")
        if not isinstance(svi, (int, float)):
            continue
        svis.append(float(svi))
        rows.append(props)

    n_overlap = sum(1 for r in rows if r.get("high_svi") and r.get("in_hottest_third"))
    sentence = _planner_sentence(rows, n_overlap, joined)
    highest = max(rows, key=lambda r: r.get("svi") or 0, default=None) if rows else None

    ranked = [r for r in rows if r.get("priority") is not None]
    ranked.sort(key=lambda r: (float(r.get("priority") or 0), float(r.get("svi") or 0)), reverse=True)
    if not ranked:
        ranked = sorted(rows, key=lambda r: float(r.get("svi") or 0), reverse=True)
    top = [_public_tract(r) for r in ranked[:3]]

    summary = {
        "tract_count": len(rows),
        "max_svi": round(max(svis), 4) if svis else None,
        "mean_svi": round(sum(svis) / len(svis), 4) if svis else None,
        "highest_svi_name": None if not highest else highest.get("name"),
        "high_svi_hottest_third": n_overlap,
        "planner_sentence": sentence,
        "priority_formula": PRIORITY_FORMULA,
        "source": SVI_SOURCE,
        "source_url": SVI_SOURCE_URL,
        "joined": joined,
        "year": 2022,
    }
    return summary, top


def _planner_sentence(rows: list[dict[str, Any]], n_overlap: int, joined: bool) -> str:
    if not rows:
        return "No CDC/ATSDR SVI 2022 tracts intersect this box."
    if not joined:
        high = sum(1 for r in rows if r.get("high_svi"))
        if high == 0:
            return f"{len(rows)} census tract{'s' if len(rows) != 1 else ''} in this box. None rank in the highest SVI quartile."
        return (
            f"{high} of {len(rows)} tract{'s' if len(rows) != 1 else ''} in this box "
            "rank in the highest SVI quartile (75th percentile or above)."
        )
    if n_overlap == 0:
        top = max(
            (r for r in rows if r.get("priority") is not None),
            key=lambda r: float(r.get("priority") or 0),
            default=None,
        )
        if top:
            return (
                f"{top.get('name')} has the highest heat×vulnerability score in this box "
                f"(SVI {top.get('svi_pct')}th percentile)."
            )
        return "No tract in this box has both high SVI and heat in the hottest third."
    if n_overlap == 1:
        return "One tract in this box is high SVI and sits in the hottest third."
    if n_overlap == 2:
        return "Two tracts in this box are high SVI and sit in the hottest third."
    return f"{n_overlap} tracts in this box are high SVI and sit in the hottest third."


def _public_tract(props: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "fips",
        "name",
        "location",
        "county",
        "state",
        "svi",
        "svi_pct",
        "theme1",
        "theme2",
        "theme3",
        "theme4",
        "population",
        "high_svi",
        "mean_c",
        "max_c",
        "tile_count",
        "heat_norm",
        "priority",
        "in_hottest_third",
    )
    return {k: props.get(k) for k in keys}
