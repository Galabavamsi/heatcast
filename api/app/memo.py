"""Planner brief: LLM if a server key is present, else a cite-only template."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import requests

log = logging.getLogger(__name__)

SYSTEM = (
    "You write a short urban-planning brief for HeatCast, a US neighborhood heat scorecard. "
    "Use ONLY numbers in the JSON. Name layers by what they measure, not by vendor on every clause: "
    "2 m air tiles, total hours above threshold, longest consecutive hot streak, satellite cover, "
    "CDC/ATSDR SVI 2022, Open-Meteo, FEMA, OSM indoor sites, OSM building shade, canopy scenario model. "
    "The tree scenario is a labeled literature overlay, not a new heatmap. "
    "If satellite canopy and impervious percents are present, use them: low canopy + high "
    "impervious supports EPA Heat Island cool pavement and USDA Forest Service i-Tree planting. "
    "If CDC/ATSDR SVI is present, name the highest-SVI tract and whether it sits in the hottest third. "
    "If persistence (streak) hours are present, contrast them with total exceedance hours. "
    "If unrelieved_heat_ratio is present, name it as a HeatCast index (longest streak ÷ total hours, 0–1), not a NIOSH table. "
    "If a field is absent from the JSON, skip it — do not list missing datasets or refuse "
    "recommendations solely because another layer is not in this payload. "
    "Do not invent CFD, sidewalk temperatures, flood depths, dollar savings, or cooling-center registries. "
    "Write 120-180 words as plain paragraphs only — no JSON, no bullet lists, no markdown headings."
)


def compact_context(value: Any) -> Any:
    """Drop null/empty fields so the model cannot obsess over missing layers."""
    if value is None:
        return None
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            compacted = compact_context(item)
            if compacted is None or compacted == "" or compacted == {} or compacted == []:
                continue
            out[key] = compacted
        return out
    if isinstance(value, list):
        return [item for item in (compact_context(v) for v in value) if item is not None]
    return value


def _brief_context(context: dict[str, Any]) -> dict[str, Any]:
    ctx = dict(context)
    flood = ctx.get("flood")
    if isinstance(flood, dict) and not flood.get("zone"):
        ctx.pop("flood", None)
    return compact_context(ctx) or {}


def write_memo(context: dict[str, Any], *, use_llm: bool = True) -> dict[str, Any]:
    compact = _brief_context(context)
    key = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY")
    if use_llm and key:
        text = _llm_memo(key, compact)
        if text:
            return {"text": text, "source": "llm", "model": os.getenv("LLM_MODEL", "deepseek-v4-flash")}
    return {"text": _template_memo(compact), "source": "template", "model": None}


def _llm_memo(api_key: str, context: dict[str, Any]) -> str | None:
    base = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    model = os.getenv("LLM_MODEL", "deepseek-v4-flash")
    try:
        resp = requests.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "temperature": 0.2,
                "thinking": {"type": "disabled"},
                "messages": [
                    {"role": "system", "content": SYSTEM},
                    {"role": "user", "content": json.dumps(context, default=str)[:8000]},
                ],
            },
            timeout=40,
        )
        resp.raise_for_status()
        data = resp.json()
        text = data["choices"][0]["message"]["content"].strip()
        return text or None
    except (requests.RequestException, KeyError, IndexError, TypeError, ValueError) as exc:
        log.warning("Planner LLM brief failed (%s); using template.", exc)
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
            f"{city}: heatmap completed with no tiles. That is a coverage miss, not 0 °C. "
            "Retry a historic summer date such as 2024-07-15 (Phoenix 2026-08-17 is a known empty window)."
        )
    hours = score.get("mean_hours_above")
    mean_c = score.get("mean_c")
    thresh = score.get("threshold_c")
    streak = score.get("mean_streak_hours")
    uhr = score.get("unrelieved_heat_ratio")
    if uhr is None and isinstance(score.get("unrelieved"), dict):
        uhr = score["unrelieved"].get("ratio")
    hour_bit = (
        f"Tiles spend a mean {hours} h at or above {thresh} °C"
        + (f"; longest consecutive streak averages {streak} h." if streak is not None else ".")
        if hours is not None
        else f"Peak-hour mean {mean_c} °C (duration layer pending)."
    )
    if uhr is not None:
        hour_bit += (
            f" Unrelieved-heat ratio {uhr} (HeatCast index: longest streak ÷ total hours above threshold, 0–1)."
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
            f" Satellite at the hotspot: canopy {canopy if canopy is not None else '—'}%, "
            f"impervious {imp if imp is not None else '—'}%."
        )
    delta = scenario.get("estimated_delta_c") or 0
    saved = scenario.get("estimated_hours_saved")
    if scenario.get("canopy_delta_pct"):
        lo = (scenario.get("estimated_delta_c_range") or {}).get("low")
        hi = (scenario.get("estimated_delta_c_range") or {}).get("high")
        scene_bit = (
            f" Canopy scenario (literature overlay, not a new heatmap): +{scenario.get('canopy_delta_pct')}% "
            f"estimates ΔT {delta} °C (range {lo}–{hi} °C)"
            + (f", ~{saved} h fewer above threshold." if saved is not None else ".")
        )
    else:
        scene_bit = (
            " No extra canopy in this run. Use +10% / +20% for a labeled overlay; "
            "the temperature tiles are not recomputed."
        )
    flood = context.get("flood") or {}
    flood_bit = ""
    if flood.get("zone"):
        flood_bit = f" FEMA NFHL centroid zone {flood.get('zone')} (floodplain label only)."
    rec_bit = ""
    if canopy is not None and imp is not None:
        rec_bit = (
            " If canopy is thin and pavement is high, EPA Heat Island cool pavement and USDA "
            "Forest Service i-Tree planting are the next checks."
        )
    svi = context.get("svi") or {}
    svi_bit = ""
    if svi.get("planner_sentence"):
        svi_bit = f" CDC/ATSDR SVI 2022: {svi.get('planner_sentence')}"
    elif svi.get("highest_svi_name"):
        svi_bit = f" CDC/ATSDR SVI 2022 highest tract {svi.get('highest_svi_name')}."
    cooling = context.get("cooling") or {}
    cool_bit = ""
    if cooling.get("count"):
        cool_bit = (
            f" OSM lists {cooling.get('count')} libraries/community centres in the box "
            "(not an official cooling-center registry)."
        )
    return (
        f"{city} snapshot: mean {mean_c} °C, max {score.get('max_c')} °C. "
        f"{hour_bit}{rain_bit}{cover_bit}{svi_bit}{scene_bit}{flood_bit}{rec_bit}{cool_bit} "
        "Tiles are ~100 m neighborhood UHI, not sidewalk CFD. Prioritize street trees and shade "
        "on the hottest tiles, and indoor cool space within a short walk of the hotspot."
    )
