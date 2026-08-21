/** HeatCast From/To window — mirrors api/app/dates.py. */

export const DEMO_DATE = "2024-07-15";
export const MAX_DURATION_DAYS = 7;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type DurationWindow = {
  startDate: string;
  endDate: string | null;
  filterType: 3 | 4;
  days: number;
  clamped: boolean;
};

export function parseIsoDate(value: string): Date | null {
  const raw = (value || "").trim().slice(0, 10);
  if (!DATE_RE.test(raw)) return null;
  const [y, m, d] = raw.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

export function isoFromUtc(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, days: number): string {
  const dt = parseIsoDate(iso);
  if (!dt) return iso;
  dt.setUTCDate(dt.getUTCDate() + days);
  return isoFromUtc(dt);
}

export function durationWindow(startDate: string, endDate?: string | null): DurationWindow {
  const start = parseIsoDate(startDate);
  if (!start) {
    return { startDate: DEMO_DATE, endDate: null, filterType: 3, days: 1, clamped: false };
  }
  let end = parseIsoDate(endDate || startDate) ?? start;
  let clamped = false;
  if (end.getTime() < start.getTime()) {
    end = start;
    clamped = true;
  }
  let span = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (span > MAX_DURATION_DAYS) {
    end = new Date(start);
    end.setUTCDate(end.getUTCDate() + (MAX_DURATION_DAYS - 1));
    span = MAX_DURATION_DAYS;
    clamped = true;
  }
  const startIso = isoFromUtc(start);
  if (span <= 1) {
    return { startDate: startIso, endDate: null, filterType: 3, days: 1, clamped };
  }
  return { startDate: startIso, endDate: isoFromUtc(end), filterType: 4, days: span, clamped };
}

export function clampEndDate(startDate: string, endDate: string): string {
  const w = durationWindow(startDate, endDate);
  return w.endDate ?? w.startDate;
}

export function durationHelper(window: DurationWindow): string {
  if (window.filterType === 3) {
    return "Duration is one day on this API. Air tiles, shade, and comfort use From + Hour.";
  }
  return "Hours/streak use this window (max 7 days). Air tiles use From + Hour.";
}
