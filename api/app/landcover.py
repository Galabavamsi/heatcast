"""Bucket FortyGuard satellite class percents into planner language."""

from __future__ import annotations

from typing import Any


def bucket_classes(percents: dict[str, float] | None) -> dict[str, Any]:
    percents = percents or {}
    canopy = _sum_matching(percents, ("tree", "plant", "canopy"))
    # plant is already in canopy; vegetation adds grass/shrub without double-counting trees
    grass = _sum_matching(percents, ("grass", "shrub", "vegetation"))
    impervious = _sum_matching(percents, ("building", "road", "route", "sidewalk", "pavement", "asphalt"))
    water = _sum_matching(percents, ("water",))
    return {
        "canopy_pct": round(canopy, 2),
        "vegetation_pct": round(canopy + grass, 2),
        "impervious_pct": round(impervious, 2),
        "water_pct": round(water, 2),
        "classes_percent": percents,
        "note": (
            "Satellite mix at the hotspot centroid. tree/plant ≈ canopy; "
            "building/road/sidewalk ≈ impervious. Not a district-wide NLCD raster."
        ),
    }


def _sum_matching(percents: dict[str, float], tokens: tuple[str, ...]) -> float:
    total = 0.0
    for name, value in percents.items():
        lower = name.lower()
        if any(tok in lower for tok in tokens):
            try:
                total += float(value)
            except (TypeError, ValueError):
                continue
    return total
