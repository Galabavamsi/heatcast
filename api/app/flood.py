"""Optional FEMA NFHL flood-zone chip. Fail-open. Not a rainfall model."""

from __future__ import annotations

from typing import Any

import requests

from . import cache

NFHL_ZONES = (
    "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query"
)


def fetch_flood_zone(lat: float, lon: float) -> dict[str, Any] | None:
    key = cache.cache_key("fema_nfhl", round(lat, 4), round(lon, 4))
    hit = cache.load(key)
    if hit is not None:
        hit["cached"] = True
        return hit
    params = {
        "geometry": f"{lon},{lat}",
        "geometryType": "esriGeometryPoint",
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "FLD_ZONE,ZONE_SUBTY,SFHA_TF",
        "returnGeometry": "false",
        "f": "json",
    }
    try:
        resp = requests.get(
            NFHL_ZONES,
            params=params,
            timeout=4,
            headers={"User-Agent": "HeatCast/0.3 (FortyGuard hackathon FG-141)"},
        )
        resp.raise_for_status()
        data = resp.json()
    except (requests.RequestException, ValueError):
        return None
    feats = data.get("features") or []
    attrs = (feats[0].get("attributes") if feats else None) or {}
    zone = attrs.get("FLD_ZONE")
    stored = {
        "source": "fema-nfhl",
        "zone": zone,
        "subtype": attrs.get("ZONE_SUBTY"),
        "sfha": attrs.get("SFHA_TF"),
        "cached": False,
        "caveat": "FEMA floodplain designation at the centroid — not a hydrology or rainfall-runoff model.",
    }
    cache.save(key, stored)
    return stored
