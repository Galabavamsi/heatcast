"""Unrelieved-heat ratio — HeatCast duration index (not a FortyGuard product).

    UHR = clip(mean_streak_hours / mean_hours_above, 0, 1)

when mean_hours_above > 0. Near 1 means exceedance hours arrived as one unbroken
run (no below-threshold recovery window in the scored period). Lower values mean
the same total hours were broken into shorter bursts.

Labeled HeatCast index, not a NIOSH work/rest table, WBGT limit, or OSHA
prescription. Occupational heat guidance treats continuous work in heat as
higher strain than work with rest (NIOSH 2017-127; OSHA proposed high-heat
trigger rest breaks). FortyGuard supplies the two duration layers; HeatCast
forms the ratio.
"""

from __future__ import annotations

from typing import Any

NIOSH_WORK_REST_URL = "https://www.cdc.gov/niosh/docs/2017-127/pdfs/2017-127.pdf"
NIOSH_WORK_REST_TITLE = "NIOSH Heat Stress: Work/Rest Schedules (2017-127)"
OSHA_NPRM_URL = "https://www.osha.gov/heat-exposure/rulemaking/"
FORMULA = "unrelieved_heat_ratio = min(1, max(0, mean_streak_hours / mean_hours_above))"
LABEL = "Unrelieved-heat ratio"
NOTE = (
    "HeatCast index: longest consecutive hours ÷ total hours above threshold. "
    "Not a NIOSH work/rest prescription or WBGT limit."
)


def _as_finite(val: Any) -> float | None:
    if val is None:
        return None
    try:
        num = float(val)
    except (TypeError, ValueError):
        return None
    if num != num or num in (float("inf"), float("-inf")):
        return None
    return num


def unrelieved_heat_ratio(
    mean_streak_hours: float | int | None,
    mean_hours_above: float | int | None,
) -> float | None:
    """District UHR from already-scored means. None when hours are missing or ≤ 0."""
    hours = _as_finite(mean_hours_above)
    streak = _as_finite(mean_streak_hours)
    if hours is None or streak is None or hours <= 0:
        return None
    if streak < 0:
        streak = 0.0
    ratio = streak / hours
    if ratio < 0:
        return 0.0
    if ratio > 1:
        return 1.0
    return round(ratio, 3)


def unrelieved_scorecard(
    mean_streak_hours: float | int | None,
    mean_hours_above: float | int | None,
) -> dict[str, Any] | None:
    ratio = unrelieved_heat_ratio(mean_streak_hours, mean_hours_above)
    if ratio is None:
        return None
    return {
        "ratio": ratio,
        "label": LABEL,
        "formula": FORMULA,
        "citation_title": NIOSH_WORK_REST_TITLE,
        "citation_url": NIOSH_WORK_REST_URL,
        "osha_nprm_url": OSHA_NPRM_URL,
        "note": NOTE,
    }
