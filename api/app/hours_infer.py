"""Hour-by-hour neighborhood heat-load and compound hours.

Uses Open-Meteo km-scale series (and optional US AQI), not FortyGuard 100 m
tiles and not transformer MW / duck-curve / CO2 / methane.
"""

from __future__ import annotations

from typing import Any


def _num(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _clock(stamp: Any) -> str:
    text = str(stamp or "")
    if "T" in text:
        return text.split("T", 1)[1][:5]
    return text[:5] if text else ""


def heat_load_index(temp_c: float | None, threshold_c: float) -> float:
    """Cooling-demand PROXY: degree-hours above threshold. Not MW."""
    if temp_c is None:
        return 0.0
    return round(max(0.0, float(temp_c) - float(threshold_c)), 2)


def unrelieved_streak(temps: list[Any], threshold_c: float) -> dict[str, Any]:
    """Longest consecutive hours at/above threshold in a 24 h series."""
    best = 0
    cur = 0
    best_end = -1
    for i, raw in enumerate(temps):
        t = _num(raw)
        if t is not None and t >= threshold_c:
            cur += 1
            if cur > best:
                best = cur
                best_end = i
        else:
            cur = 0
    start = best_end - best + 1 if best else None
    return {
        "hours": best,
        "start_index": start,
        "end_index": best_end if best else None,
    }


def infer_peak_hours(
    *,
    times: list[Any],
    temps: list[Any],
    ghi: list[Any] | None = None,
    threshold_c: float = 35.0,
) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    n = max(len(times), len(temps))
    ghi = ghi or []
    load_sum = 0.0
    hottest: dict[str, Any] | None = None
    for i in range(n):
        clock = _clock(times[i]) if i < len(times) else f"{i:02d}:00"
        temp = _num(temps[i]) if i < len(temps) else None
        load = heat_load_index(temp, threshold_c)
        load_sum += load
        rad = _num(ghi[i]) if i < len(ghi) else None
        row = {
            "hour": clock,
            "temp_c": None if temp is None else round(temp, 2),
            "heat_load": load,
            "ghi_wm2": None if rad is None else round(rad, 1),
            "above_threshold": bool(temp is not None and temp >= threshold_c),
        }
        rows.append(row)
        if temp is not None and (hottest is None or temp > hottest["temp_c"]):
            hottest = {"hour": clock, "temp_c": round(temp, 2), "index": i}
    streak = unrelieved_streak(temps, threshold_c)
    start = streak["start_index"]
    end = streak["end_index"]
    return {
        "kind": "neighborhood_heat_load",
        "metric": "degree_hours_above_threshold",
        "not_used": "transformer_mw_duck_curve_eia",
        "threshold_c": threshold_c,
        "hours": rows,
        "heat_load_sum": round(load_sum, 2),
        "hours_above": sum(1 for r in rows if r["above_threshold"]),
        "hottest": hottest,
        "unrelieved_streak_h": streak["hours"],
        "unrelieved_window": None
        if start is None or end is None
        else {
            "start": rows[start]["hour"] if start < len(rows) else None,
            "end": rows[end]["hour"] if end < len(rows) else None,
        },
        "solar_peak": _solar_peak(rows),
        "label": (
            "Neighborhood heat-load hours from Open-Meteo 2 m air (km-scale), "
            "not FortyGuard 100 m tiles and not transformer overload."
        ),
    }


def _solar_peak(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    best: dict[str, Any] | None = None
    for row in rows:
        ghi = row.get("ghi_wm2")
        if ghi is None:
            continue
        if best is None or ghi > best["ghi_wm2"]:
            best = {"hour": row["hour"], "ghi_wm2": ghi, "temp_c": row.get("temp_c")}
    return best


def infer_compound_hours(
    *,
    times: list[Any],
    temps: list[Any],
    rh: list[Any] | None = None,
    us_aqi: list[Any] | None = None,
    threshold_c: float = 35.0,
    rh_cut: float = 60.0,
    aqi_cut: float = 100.0,
) -> dict[str, Any]:
    rh = rh or []
    us_aqi = us_aqi or []
    has_aqi = any(_num(v) is not None for v in us_aqi)
    has_rh = any(_num(v) is not None for v in rh)
    rows: list[dict[str, Any]] = []
    n = max(len(times), len(temps))
    for i in range(n):
        clock = _clock(times[i]) if i < len(times) else f"{i:02d}:00"
        temp = _num(temps[i]) if i < len(temps) else None
        humid = _num(rh[i]) if i < len(rh) else None
        aqi = _num(us_aqi[i]) if i < len(us_aqi) else None
        hot = temp is not None and temp >= threshold_c
        humid_stress = humid is not None and humid >= rh_cut
        aqi_stress = aqi is not None and aqi >= aqi_cut
        compound = bool(hot and (aqi_stress or (not has_aqi and humid_stress)))
        humidity_compound = bool(hot and humid_stress)
        rows.append(
            {
                "hour": clock,
                "temp_c": None if temp is None else round(temp, 2),
                "rh_pct": None if humid is None else round(humid, 1),
                "us_aqi": None if aqi is None else round(aqi, 1),
                "hot": hot,
                "humidity_compound": humidity_compound,
                "aqi_compound": bool(hot and aqi_stress),
                "compound": compound,
            }
        )
    return {
        "kind": "heat_humidity_air_compound",
        "not_used": "co2_methane_fortyguard_aqi",
        "threshold_c": threshold_c,
        "rh_cut": rh_cut,
        "aqi_cut": aqi_cut,
        "has_us_aqi": has_aqi,
        "has_humidity": has_rh,
        "hours": rows,
        "compound_hours": sum(1 for r in rows if r["compound"]),
        "humidity_compound_hours": sum(1 for r in rows if r["humidity_compound"]),
        "aqi_compound_hours": sum(1 for r in rows if r["aqi_compound"]),
        "label": (
            "Hours when Open-Meteo heat coincides with high humidity and/or US AQI. "
            "Not FortyGuard env AQI. Not CO2 or methane."
        ),
        "aqi_note": None
        if has_aqi
        else "US AQI unavailable for this point. Showing heat + humidity hours only.",
    }
