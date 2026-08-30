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


def infer_site_hours(
    *,
    times: list[Any],
    temps: list[Any],
    apparent: list[Any] | None = None,
    rh: list[Any] | None = None,
    ghi: list[Any] | None = None,
    threshold_c: float = 35.0,
) -> dict[str, Any]:
    """Hour-by-hour Open-Meteo table. Not a data-center PUE and not tile TCM."""
    apparent = apparent or []
    rh = rh or []
    ghi = ghi or []
    rows: list[dict[str, Any]] = []
    n = max(len(times), len(temps))
    airs: list[float] = []
    apps: list[float] = []
    loads: list[float] = []
    for i in range(n):
        clock = _clock(times[i]) if i < len(times) else f"{i:02d}:00"
        temp = _num(temps[i]) if i < len(temps) else None
        app = _num(apparent[i]) if i < len(apparent) else None
        humid = _num(rh[i]) if i < len(rh) else None
        rad = _num(ghi[i]) if i < len(ghi) else None
        load = heat_load_index(temp, threshold_c)
        if temp is not None:
            airs.append(temp)
        if app is not None:
            apps.append(app)
        loads.append(load)
        rows.append(
            {
                "hour": clock,
                "air_c": None if temp is None else round(temp, 2),
                "apparent_c": None if app is None else round(app, 2),
                "rh_pct": None if humid is None else round(humid, 1),
                "heat_load": load,
                "ghi_wm2": None if rad is None else round(rad, 1),
                "above_threshold": bool(temp is not None and temp >= threshold_c),
            }
        )
    coolest = min((r for r in rows if r["air_c"] is not None), key=lambda r: r["air_c"], default=None)
    hottest = max((r for r in rows if r["air_c"] is not None), key=lambda r: r["air_c"], default=None)
    return {
        "kind": "site_hour_table",
        "metric": "open_meteo_hourly_air",
        "not_used": "data_center_pue_tile_diurnal_tcm",
        "threshold_c": threshold_c,
        "hours": rows,
        "mean_air_c": None if not airs else round(sum(airs) / len(airs), 2),
        "mean_apparent_c": None if not apps else round(sum(apps) / len(apps), 2),
        "hours_above": sum(1 for r in rows if r["above_threshold"]),
        "heat_load_sum": round(sum(loads), 2),
        "coolest": None
        if coolest is None
        else {"hour": coolest["hour"], "air_c": coolest["air_c"]},
        "hottest": None
        if hottest is None
        else {"hour": hottest["hour"], "air_c": hottest["air_c"]},
        "label": (
            "Hour-by-hour Open-Meteo 2 m air, apparent temperature, humidity, "
            "and a cooling-demand proxy (degree-hours above threshold). "
            "Not data-center PUE and not a cached diurnal FortyGuard TCM."
        ),
    }


WINDOW_H = 4
GHI_DAYLIGHT = 20.0


def _row_hour(clock: str) -> int | None:
    try:
        return int(str(clock).split(":")[0])
    except (TypeError, ValueError):
        return None


def _daylight_flags(rows: list[dict[str, Any]]) -> list[bool]:
    has_ghi = any(r.get("ghi_wm2") is not None for r in rows)
    flags: list[bool] = []
    for row in rows:
        if has_ghi:
            ghi = row.get("ghi_wm2")
            flags.append(bool(ghi is not None and ghi >= GHI_DAYLIGHT))
        else:
            hour = _row_hour(str(row.get("hour") or ""))
            flags.append(hour is not None and 7 <= hour <= 18)
    if any(flags):
        return flags
    return [True] * len(rows)


def infer_shift_window(
    *,
    times: list[Any],
    temps: list[Any],
    ghi: list[Any] | None = None,
    threshold_c: float = 35.0,
    window_h: int = WINDOW_H,
) -> dict[str, Any]:
    """Best cool / low-demand daylight hours. Not grid carbon / gCO2/kWh."""
    ghi = ghi or []
    rows: list[dict[str, Any]] = []
    n = max(len(times), len(temps))
    for i in range(n):
        clock = _clock(times[i]) if i < len(times) else f"{i:02d}:00"
        temp = _num(temps[i]) if i < len(temps) else None
        rad = _num(ghi[i]) if i < len(ghi) else None
        rows.append(
            {
                "hour": clock,
                "temp_c": None if temp is None else round(temp, 2),
                "heat_load": heat_load_index(temp, threshold_c),
                "ghi_wm2": None if rad is None else round(rad, 1),
                "above_threshold": bool(temp is not None and temp >= threshold_c),
            }
        )
    daylight = _daylight_flags(rows)
    for row, flag in zip(rows, daylight):
        row["daylight"] = flag
    length = max(1, min(int(window_h or WINDOW_H), len(rows) or 1))

    def _window_stats(start: int) -> dict[str, Any] | None:
        chunk = rows[start : start + length]
        if len(chunk) < length:
            return None
        loads = [c["heat_load"] for c in chunk]
        ghis = [c["ghi_wm2"] for c in chunk if c.get("ghi_wm2") is not None]
        temps_c = [c["temp_c"] for c in chunk if c.get("temp_c") is not None]
        return {
            "start": chunk[0]["hour"],
            "end": chunk[-1]["hour"],
            "hours": [c["hour"] for c in chunk],
            "mean_heat_load": round(sum(loads) / len(loads), 2),
            "mean_temp_c": None if not temps_c else round(sum(temps_c) / len(temps_c), 2),
            "mean_ghi_wm2": None if not ghis else round(sum(ghis) / len(ghis), 1),
            "daylight": all(c["daylight"] for c in chunk),
        }

    recommend: dict[str, Any] | None = None
    avoid: dict[str, Any] | None = None

    def _rank(stats: dict[str, Any]) -> tuple[float, float]:
        load = float(stats["mean_heat_load"])
        temp = stats["mean_temp_c"]
        return (load, 99.0 if temp is None else float(temp))

    for i in range(0, max(0, len(rows) - length + 1)):
        stats = _window_stats(i)
        if stats is None:
            continue
        if stats["daylight"]:
            if recommend is None or _rank(stats) < _rank(recommend):
                recommend = stats
        if avoid is None or _rank(stats) > _rank(avoid):
            avoid = stats
    if recommend is None:
        recommend = _window_stats(0)
    coolest_daylight = sorted(
        (r for r in rows if r["daylight"] and r["temp_c"] is not None),
        key=lambda r: (r["heat_load"], r["temp_c"]),
    )[:length]
    return {
        "kind": "shift_window",
        "metric": "open_meteo_heat_and_ghi",
        "not_used": "grid_carbon_gco2_electricity_maps_eia",
        "threshold_c": threshold_c,
        "window_h": length,
        "hours": rows,
        "recommend": recommend,
        "avoid": avoid,
        "coolest_daylight": [
            {"hour": r["hour"], "temp_c": r["temp_c"], "heat_load": r["heat_load"], "ghi_wm2": r["ghi_wm2"]}
            for r in coolest_daylight
        ],
        "label": (
            "Best cool / low-demand daylight hours from Open-Meteo 2 m air and GHI. "
            "A HeatCast shift window — not grid carbon intensity and not gCO2/kWh."
        ),
        "note": (
            f"Recommend the {length} h daylight block with the lowest mean heat-load, "
            "then the lowest mean air. GHI only marks daylight (not carbon). "
            "The avoid block is the hottest 4 h stretch."
        ),
    }
