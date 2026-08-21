"""Map HeatCast From/To dates onto FortyGuard heatmap ``date_time``.

``create_heatmap`` ``filter_type`` (see ``fortyguard.client.FortyGuardClient``):

* 1 — single hour (TCM snapshot; not this helper)
* 2 — range of hours
* 3 — single day
* 4 — range of days (pass ``end_date``)

Same From/To → ``filter_type=3`` and no ``end_date``, so existing one-day
caches keep hitting. A 2–7 day span uses ``filter_type=4``. The API does not
expose a custom 3-day product; it is one day or a range-of-days window.
Range is capped at 7 inclusive days. From is the snapshot day (never swapped).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import NamedTuple

MAX_DURATION_DAYS = 7


class DurationWindow(NamedTuple):
    start_date: str
    end_date: str | None
    filter_type: int
    days: int
    clamped: bool


def parse_iso_date(value: str) -> date:
    raw = (value or "").strip()[:10]
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Dates must be YYYY-MM-DD, got {value!r}") from exc


def duration_window(start_date: str, end_date: str | None = None) -> DurationWindow:
    """Canonical duration window for exceedance / persistence.

    TCM / shade / comfort still use ``start_date`` + hour. This helper only
    decides how duration heatmaps are requested.
    """
    start = parse_iso_date(start_date)
    end = parse_iso_date(end_date) if end_date else start
    clamped = False
    if end < start:
        end = start
        clamped = True
    span = (end - start).days + 1
    if span > MAX_DURATION_DAYS:
        end = start + timedelta(days=MAX_DURATION_DAYS - 1)
        span = MAX_DURATION_DAYS
        clamped = True
    start_s = start.isoformat()
    if span <= 1:
        return DurationWindow(start_s, None, 3, 1, clamped)
    return DurationWindow(start_s, end.isoformat(), 4, span, clamped)


def duration_note(window: DurationWindow) -> str:
    if window.filter_type == 3:
        return "Duration is one day on this API."
    return (
        f"Duration is a {window.days}-day window on this API "
        "(range-of-days product, not a custom N-day exceedance)."
    )
