"""0–100 HeatCast district index from scorecard math. Not insurance / FICO."""

from __future__ import annotations

from typing import Any

from .unrelieved import unrelieved_heat_ratio

INTENSITY_SPAN_C = 12.0
INTENSITY_BELOW_C = 6.0
EXCEEDANCE_SPAN_H = 12.0

WEIGHTS = {"intensity": 0.40, "exceedance": 0.35, "unrelieved": 0.25}
WEIGHTS_SVI = {"intensity": 0.35, "exceedance": 0.28, "unrelieved": 0.22, "svi": 0.15}

LABEL = "HeatCast district index"
NOTE = (
    "0–100 HeatCast index from neighborhood mean air, exceedance hours, "
    "and unrelieved streak. Optional CDC SVI is a vulnerability overlay, not a "
    "risk premium. Not insurance, not a FICO of heat, not parametric payout."
)
FORMULA = (
    "index = 100 * (wI * clip((mean_c - threshold_c + 6) / 12, 0, 1) "
    "+ wE * clip(mean_hours_above / 12, 0, 1) "
    "+ wU * unrelieved_ratio "
    "+ wS * mean_svi)"
)


def _clip01(value: float | None) -> float | None:
    if value is None:
        return None
    if value < 0:
        return 0.0
    if value > 1:
        return 1.0
    return float(value)


def _finite(value: Any) -> float | None:
    if value is None:
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if num != num or num in (float("inf"), float("-inf")):
        return None
    return num


def intensity_component(mean_c: float | None, threshold_c: float) -> float | None:
    """0 at threshold−6 °C, 0.5 at threshold, 1 at threshold+6 °C."""
    mean = _finite(mean_c)
    if mean is None:
        return None
    raw = (mean - float(threshold_c) + INTENSITY_BELOW_C) / INTENSITY_SPAN_C
    clipped = _clip01(raw)
    return None if clipped is None else round(clipped, 3)


def exceedance_component(mean_hours_above: float | None) -> float | None:
    hours = _finite(mean_hours_above)
    if hours is None:
        return None
    return round(_clip01(hours / EXCEEDANCE_SPAN_H) or 0.0, 3)


def band_for(index: int) -> str:
    if index < 25:
        return "modest"
    if index < 50:
        return "elevated"
    if index < 75:
        return "high"
    return "extreme"


def district_heatcast_index(
    *,
    mean_c: float | None,
    threshold_c: float = 35.0,
    mean_hours_above: float | None = None,
    mean_streak_hours: float | None = None,
    unrelieved_ratio: float | None = None,
    mean_svi: float | None = None,
    source: str = "open-meteo",
) -> dict[str, Any]:
    intensity = intensity_component(mean_c, threshold_c)
    exceedance = exceedance_component(mean_hours_above)
    ratio = _clip01(_finite(unrelieved_ratio))
    if ratio is None:
        computed = unrelieved_heat_ratio(mean_streak_hours, mean_hours_above)
        ratio = _clip01(computed)
    svi = _clip01(_finite(mean_svi))
    has_svi = svi is not None
    weights = dict(WEIGHTS_SVI if has_svi else WEIGHTS)
    parts = {
        "intensity": intensity,
        "exceedance": exceedance,
        "unrelieved": None if ratio is None else round(ratio, 3),
    }
    if has_svi:
        parts["svi"] = round(svi or 0.0, 3)
    usable = {key: value for key, value in parts.items() if value is not None}
    if not usable:
        return {
            "ok": False,
            "kind": "heatcast_district_index",
            "not_used": "insurance_fico_parametric",
            "index": None,
            "band": None,
            "components": parts,
            "weights": weights,
            "source": source,
            "label": LABEL,
            "formula": FORMULA,
            "note": NOTE,
            "missing": "Need a mean air temperature or exceedance hours.",
        }
    weight_sum = sum(weights[key] for key in usable)
    raw = sum(weights[key] * usable[key] for key in usable) / weight_sum
    index = int(round(100.0 * raw))
    index = max(0, min(100, index))
    return {
        "ok": True,
        "kind": "heatcast_district_index",
        "not_used": "insurance_fico_parametric",
        "index": index,
        "band": band_for(index),
        "components": parts,
        "weights": {key: weights[key] for key in usable},
        "source": source,
        "label": LABEL,
        "formula": FORMULA,
        "note": NOTE,
        "mean_c": None if _finite(mean_c) is None else round(float(mean_c), 2),
        "threshold_c": threshold_c,
        "mean_hours_above": None
        if _finite(mean_hours_above) is None
        else round(float(mean_hours_above), 2),
        "unrelieved_ratio": parts["unrelieved"],
        "mean_svi": None if not has_svi else parts["svi"],
    }
