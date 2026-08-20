"""Planner brief: LLM if a server key is present, else a cite-only template."""

from __future__ import annotations

import json
import os
from typing import Any

import requests

SYSTEM = (
    "You write a short urban-planning brief for HeatCast. "
    "Use ONLY numbers in the JSON. Every factual clause must name its layer "
    "(FortyGuard TCM, FortyGuard exceedance, FortyGuard satellite, Open-Meteo, FEMA, scenario model). "
    "The tree scenario is an estimated literature overlay, not a FortyGuard measurement. "
    "Do not invent CFD, sidewalk temperatures, flood depths, or dollar savings. "
    "If a field is null, say unknown. 120-180 words."
)


def write_memo(context: dict[str, Any]) -> dict[str, Any]:
    key = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY")
    if key:
        text = _llm_memo(key, context)
        if text:
            return {"text": text, "source": "llm", "model": os.getenv("LLM_MODEL", "gpt-4o-mini")}
    return {"text": _template_memo(context), "source": "template", "model": None}


def _llm_memo(api_key: str, context: dict[str, Any]) -> str | None:
    base = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    model = os.getenv("LLM_MODEL", "gpt-4o-mini")
    try:
        resp = requests.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "temperature": 0.2,
                "messages": [
                    {"role": "system", "content": SYSTEM},
                    {"role": "user", "content": json.dumps(context, default=str)[:8000]},
                ],
            },
            timeout=25,
        )
        resp.raise_for_status()
        data = resp.json()
        text = data["choices"][0]["message"]["content"].strip()
        return text or None
    except (requests.RequestException, KeyError, IndexError, TypeError, ValueError):
        return None


def _template_memo(context: dict[str, Any]) -> str:
    city = context.get("city") or "This district"
    score = context.get("scorecard") or {}
    rain = context.get("rain") or {}
    scenario = context.get("scenario") or {}
    sat = context.get("satellite_buckets") or {}
    coverage = context.get("coverage_miss")
    if coverage:
        return (
            f"{city}: FortyGuard TCM completed with no tiles. That is a coverage miss, not 0 °C. "
            "Retry a historic summer date such as 2024-07-15 (Phoenix 2026-08-17 is a known empty window)."
        )
    hours = score.get("mean_hours_above")
    mean_c = score.get("mean_c")
    thresh = score.get("threshold_c")
    hour_bit = (
        f"FortyGuard exceedance: mean {hours} h at or above {thresh} °C."
        if hours is not None
        else f"FortyGuard TCM peak-hour mean {mean_c} °C (duration layer pending)."
    )
    rain_mm = rain.get("daily_precip_mm")
    rain_bit = (
        f" Open-Meteo daily precip {rain_mm} mm (grid-scale rain context, not a hydro model)."
        if rain_mm is not None
        else " Open-Meteo daily precip unavailable."
    )
    canopy = sat.get("canopy_pct")
    imp = sat.get("impervious_pct")
    cover_bit = ""
    if canopy is not None or imp is not None:
        cover_bit = (
            f" FortyGuard satellite at the hotspot: canopy {canopy if canopy is not None else '—'}%, "
            f"impervious {imp if imp is not None else '—'}%."
        )
    delta = scenario.get("estimated_delta_c") or 0
    saved = scenario.get("estimated_hours_saved")
    if scenario.get("canopy_delta_pct"):
        lo = (scenario.get("estimated_delta_c_range") or {}).get("low")
        hi = (scenario.get("estimated_delta_c_range") or {}).get("high")
        scene_bit = (
            f" Scenario model (not FG): +{scenario.get('canopy_delta_pct')}% canopy estimates "
            f"ΔT {delta} °C (range {lo}–{hi} °C)"
            + (f", ~{saved} h fewer above threshold." if saved is not None else ".")
        )
    else:
        scene_bit = (
            " No extra canopy in this run. Use the +10% / +20% slider for a labeled literature overlay; "
            "FortyGuard will not recompute a heatmap."
        )
    flood = context.get("flood") or {}
    flood_bit = ""
    if flood.get("zone"):
        flood_bit = f" FEMA NFHL centroid zone {flood.get('zone')} (floodplain label only)."
    return (
        f"{city} snapshot: FortyGuard TCM mean {mean_c} °C, max {score.get('max_c')} °C. "
        f"{hour_bit}{rain_bit}{cover_bit}{scene_bit}{flood_bit} "
        "Tiles are ~100 m neighborhood UHI, not sidewalk CFD. Prioritize street trees and shade "
        "on the hottest tiles; confirm with the satellite mix before paving more pad. "
        "OSM libraries and community centres in the box can serve as cooling sites — not an official registry."
    )
