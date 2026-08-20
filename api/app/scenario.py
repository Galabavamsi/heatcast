"""Estimated canopy-cooling overlay. Not a FortyGuard what-if heatmap.

Air-temperature cooling efficiency only. Do not apply LST CE (~0.075 °C per 1% canopy).
"""

from __future__ import annotations

from typing import Any

# Observational 2 m air: ~0.01 °C per 1% canopy (Tacoma sidewalks).
# HeatCast central 0.015 °C per 1% (0.10–0.20 °C per +10 percentage points).
# Du et al. 2024: Europe air CE ~0.006 vs LST ~0.075 per 1% FTC — we stay on air.
# Cap so a slider cannot imply CFD.
C_PER_PCT_LOW = 0.010
C_PER_PCT_CENTRAL = 0.015
C_PER_PCT_HIGH = 0.020
DELTA_C_CAP = 2.0
CANOPY_TOTAL_CAP_PCT = 80.0

CITATIONS = [
    {
        "title": "Du et al., Environ. Res. Lett. (2024) — air vs LST cooling efficiency",
        "url": "https://doi.org/10.1088/1748-9326/ad22e2",
        "note": "Daytime air CE ~0.006 °C vs LST CE ~0.075 °C per 1% tree cover (Europe). HeatCast uses air, not LST.",
    },
    {
        "title": "Street trees and sidewalk air temperature (Scientific Reports, 2024)",
        "url": "https://www.nature.com/articles/s41598-024-51921-y",
        "note": "~0.01 °C air temperature per 1% canopy within 10 m (Tacoma)",
    },
    {
        "title": "Wang et al., ISPRS J. Photogramm. (2019)",
        "url": "https://doi.org/10.1016/j.isprsjprs.2019.02.008",
        "note": "CONUS LST ~0.17 °C per 1% tree cover — not applied; FortyGuard is 2 m air",
    },
    {
        "title": "Yang et al., Environ. Res. Lett. (2022)",
        "url": "https://doi.org/10.1088/1748-9326/ac4d22",
        "note": "Global daytime LST CE ~0.063 °C per 1% FTC — not used for this overlay",
    },
    {
        "title": "Phoenix ENVI-met tree cover (Urban Forestry & Urban Greening, 2015)",
        "url": "https://doi.org/10.1016/j.ufug.2014.09.010",
        "note": "0.14 °C per 1% in a microclimate model — not used as the district overlay slope",
    },
    {
        "title": "HeatCast RESEARCH-SIMULATOR.md",
        "url": None,
        "note": "Conservative air band 0.10–0.20 °C per +10% canopy; overlay is a model",
    },
]

LABEL = (
    "Estimated air-temperature canopy cooling — literature overlay on FortyGuard tiles, "
    "not a new FortyGuard heatmap. LST cooling looks much larger; this slider does not use LST."
)


def clamp_canopy_delta(canopy_delta_pct: float, current_canopy_pct: float | None) -> float:
    extra = max(0.0, float(canopy_delta_pct or 0.0))
    extra = min(extra, 40.0)
    if current_canopy_pct is None:
        return round(extra, 2)
    room = max(0.0, CANOPY_TOTAL_CAP_PCT - float(current_canopy_pct))
    return round(min(extra, room), 2)


def delta_c_for(canopy_delta_pct: float, slope: float) -> float:
    return round(min(DELTA_C_CAP, max(0.0, canopy_delta_pct) * slope), 3)


def hours_saved(
    mean_hours: float | None,
    mean_c: float | None,
    threshold_c: float,
    delta_c: float,
) -> float | None:
    if mean_hours is None or mean_hours <= 0 or delta_c <= 0:
        return 0.0 if mean_hours == 0 else None if mean_hours is None else 0.0
    if mean_c is None:
        return round(min(mean_hours, 2.5 * delta_c), 2)
    denom = max(1.0, (mean_c - threshold_c) + 2.0)
    frac = min(1.0, delta_c / denom)
    return round(mean_hours * frac, 2)


def estimate_scenario(
    *,
    canopy_delta_pct: float,
    current_canopy_pct: float | None,
    mean_c: float | None,
    mean_hours: float | None,
    threshold_c: float,
) -> dict[str, Any]:
    applied = clamp_canopy_delta(canopy_delta_pct, current_canopy_pct)
    low = delta_c_for(applied, C_PER_PCT_LOW)
    central = delta_c_for(applied, C_PER_PCT_CENTRAL)
    high = delta_c_for(applied, C_PER_PCT_HIGH)
    return {
        "kind": "literature_overlay",
        "metric": "air_temperature_c",
        "not_used": "lst_cooling_efficiency",
        "label": LABEL,
        "canopy_delta_pct_requested": round(float(canopy_delta_pct or 0), 2),
        "canopy_delta_pct": applied,
        "current_canopy_pct": None if current_canopy_pct is None else round(float(current_canopy_pct), 2),
        "estimated_delta_c": central,
        "estimated_delta_c_range": {"low": low, "high": high},
        "estimated_hours_saved": hours_saved(mean_hours, mean_c, threshold_c, central),
        "estimated_hours_saved_range": {
            "low": hours_saved(mean_hours, mean_c, threshold_c, low),
            "high": hours_saved(mean_hours, mean_c, threshold_c, high),
        },
        "estimated_mean_c": None if mean_c is None else round(mean_c - central, 2),
        "citations": CITATIONS,
        "formula": {
            "delta_c_c_per_pct": {
                "low": C_PER_PCT_LOW,
                "central": C_PER_PCT_CENTRAL,
                "high": C_PER_PCT_HIGH,
            },
            "air_ce_du_2024_per_pct": 0.006,
            "lst_ce_du_2024_per_pct": 0.075,
            "delta_c_cap": DELTA_C_CAP,
            "canopy_total_cap_pct": CANOPY_TOTAL_CAP_PCT,
            "hours_saved": "H * min(1, dT / max(1, mean_c - threshold + 2))",
        },
    }


def scenario_model_meta() -> dict[str, Any]:
    return {
        "kind": "literature_overlay",
        "metric": "air_temperature_c",
        "not_used": "lst_cooling_efficiency",
        "label": LABEL,
        "c_per_10pct_canopy": {"low": 0.10, "central": 0.15, "high": 0.20},
        "delta_c_cap": DELTA_C_CAP,
        "canopy_total_cap_pct": CANOPY_TOTAL_CAP_PCT,
        "citations": CITATIONS,
        "formula": estimate_scenario(
            canopy_delta_pct=0,
            current_canopy_pct=None,
            mean_c=None,
            mean_hours=None,
            threshold_c=35,
        )["formula"],
    }
