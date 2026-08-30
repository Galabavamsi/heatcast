"""Neighborhood cooling-plan levers. Literature air estimates, not a new heatmap.

Canopy uses the same air CE as scenario.py (~0.015 °C per 1%).
Cool-roof and pavement are smaller district-scale air estimates, labeled as
literature — FortyGuard is not re-run.
"""

from __future__ import annotations

from typing import Any

from .scenario import (
    C_PER_PCT_CENTRAL,
    C_PER_PCT_HIGH,
    C_PER_PCT_LOW,
    CITATIONS as CANOPY_CITATIONS,
    DELTA_C_CAP,
    clamp_canopy_delta,
    delta_c_for,
    hours_saved,
)

# District-scale 2 m air, not LST. Santamouris reviews ~0.1–0.3 K for large
# cool-roof adoption; we stay conservative so a slider cannot imply CFD.
ROOF_C_PER_PCT = 0.008
ROOF_DELTA_CAP = 1.2
PAVE_C_PER_PCT = 0.005
PAVE_DELTA_CAP = 0.8
LEVER_PCT_CAP = 40.0

ROOF_CITATIONS = [
    {
        "title": "Santamouris, Solar Energy (2014) — cooling the cities",
        "url": "https://doi.org/10.1016/j.solener.2012.06.003",
        "note": "Reflective roofs: neighborhood air cooling is much smaller than surface ΔT. HeatCast uses ~0.08 °C air per +10% cool-roof cover.",
    },
    {
        "title": "EPA Heat Island Compendium — Cool Roofs",
        "url": "https://www.epa.gov/heatislands/heat-island-compendium",
        "note": "Guidance, not a FortyGuard product. Overlay only.",
    },
]

PAVE_CITATIONS = [
    {
        "title": "EPA Heat Island Compendium — Cool Pavements",
        "url": "https://www.epa.gov/heatislands/heat-island-compendium",
        "note": "Cool/permeable pavement air effect at district scale is smaller than canopy. HeatCast uses ~0.05 °C air per +10% cover.",
    },
]

LABEL = (
    "Literature air-temperature overlay on existing FortyGuard tiles. "
    "Not a new FortyGuard heatmap. Cool-roof and pavement are labeled estimates, "
    "not satellite re-segmentation."
)


def _clamp_lever(pct: float) -> float:
    return round(min(LEVER_PCT_CAP, max(0.0, float(pct or 0.0))), 2)


def _roof_delta(pct: float) -> float:
    return round(min(ROOF_DELTA_CAP, _clamp_lever(pct) * ROOF_C_PER_PCT), 3)


def _pave_delta(pct: float) -> float:
    return round(min(PAVE_DELTA_CAP, _clamp_lever(pct) * PAVE_C_PER_PCT), 3)


def estimate_cooling_plan(
    *,
    canopy_delta_pct: float,
    roof_delta_pct: float = 0.0,
    pavement_delta_pct: float = 0.0,
    current_canopy_pct: float | None = None,
    mean_c: float | None = None,
    mean_hours: float | None = None,
    threshold_c: float = 35.0,
) -> dict[str, Any]:
    canopy_applied = clamp_canopy_delta(canopy_delta_pct, current_canopy_pct)
    canopy_low = delta_c_for(canopy_applied, C_PER_PCT_LOW)
    canopy_c = delta_c_for(canopy_applied, C_PER_PCT_CENTRAL)
    canopy_high = delta_c_for(canopy_applied, C_PER_PCT_HIGH)
    roof_c = _roof_delta(roof_delta_pct)
    pave_c = _pave_delta(pavement_delta_pct)
    total = round(min(DELTA_C_CAP, canopy_c + roof_c + pave_c), 3)
    total_low = round(min(DELTA_C_CAP, canopy_low + roof_c + pave_c), 3)
    total_high = round(min(DELTA_C_CAP, canopy_high + roof_c + pave_c), 3)
    return {
        "kind": "literature_overlay",
        "metric": "air_temperature_c",
        "not_used": "lst_cooling_efficiency",
        "label": LABEL,
        "canopy": {
            "delta_pct": canopy_applied,
            "estimated_delta_c": canopy_c,
            "range": {"low": canopy_low, "high": canopy_high},
            "source": "literature_air_ce",
        },
        "cool_roof": {
            "delta_pct": _clamp_lever(roof_delta_pct),
            "estimated_delta_c": roof_c,
            "source": "literature_estimate",
            "note": "Not a FortyGuard re-run. District-scale air, not roof LST.",
        },
        "pavement": {
            "delta_pct": _clamp_lever(pavement_delta_pct),
            "estimated_delta_c": pave_c,
            "source": "literature_estimate",
            "note": "Not a FortyGuard re-run. Cool/permeable pavement air proxy.",
        },
        "attribution": [
            {"lever": "canopy", "delta_c": canopy_c},
            {"lever": "cool_roof", "delta_c": roof_c},
            {"lever": "pavement", "delta_c": pave_c},
        ],
        "estimated_delta_c": total,
        "estimated_delta_c_range": {"low": total_low, "high": total_high},
        "estimated_hours_saved": hours_saved(mean_hours, mean_c, threshold_c, total),
        "estimated_mean_c": None if mean_c is None else round(mean_c - total, 2),
        "citations": list(CANOPY_CITATIONS) + ROOF_CITATIONS + PAVE_CITATIONS,
        "formula": {
            "canopy_c_per_pct": {
                "low": C_PER_PCT_LOW,
                "central": C_PER_PCT_CENTRAL,
                "high": C_PER_PCT_HIGH,
            },
            "roof_c_per_pct": ROOF_C_PER_PCT,
            "pavement_c_per_pct": PAVE_C_PER_PCT,
            "delta_c_cap": DELTA_C_CAP,
            "note": "total = min(cap, canopy + roof + pavement)",
        },
    }
