/** Local copy of api/app/scenario.py — slider must not re-hit FortyGuard. */

export const C_PER_PCT = { low: 0.01, central: 0.015, high: 0.02 };
export const DELTA_C_CAP = 2;
export const CANOPY_TOTAL_CAP = 80;

export const CITATIONS = [
  {
    title: "Du et al., Environ. Res. Lett. (2024) — air vs LST cooling efficiency",
    url: "https://doi.org/10.1088/1748-9326/ad22e2",
    note: "Daytime air CE ~0.006 °C vs LST CE ~0.075 °C per 1% tree cover (Europe). HeatCast uses air, not LST.",
  },
  {
    title: "Street trees and sidewalk air temperature (Scientific Reports, 2024)",
    url: "https://www.nature.com/articles/s41598-024-51921-y",
    note: "~0.01 °C air temperature per 1% canopy within 10 m (Tacoma)",
  },
  {
    title: "Wang et al., ISPRS J. Photogramm. (2019)",
    url: "https://doi.org/10.1016/j.isprsjprs.2019.02.008",
    note: "CONUS LST ~0.17 °C per 1% tree cover — not applied; FortyGuard is 2 m air",
  },
  {
    title: "Yang et al., Environ. Res. Lett. (2022)",
    url: "https://doi.org/10.1088/1748-9326/ac4d22",
    note: "Global daytime LST CE ~0.063 °C per 1% FTC — not used for this overlay",
  },
] as const;

export function clampCanopyDelta(deltaPct: number, currentCanopyPct: number | null | undefined) {
  const extra = Math.min(40, Math.max(0, deltaPct || 0));
  if (currentCanopyPct == null) return extra;
  return Math.min(extra, Math.max(0, CANOPY_TOTAL_CAP - currentCanopyPct));
}

export function deltaC(deltaPct: number, slope: number) {
  return Math.min(DELTA_C_CAP, Math.max(0, deltaPct) * slope);
}

export function hoursSaved(
  meanHours: number | null | undefined,
  meanC: number | null | undefined,
  thresholdC: number,
  dT: number,
) {
  if (meanHours == null) return null;
  if (meanHours <= 0 || dT <= 0) return 0;
  if (meanC == null) return Math.min(meanHours, 2.5 * dT);
  const denom = Math.max(1, meanC - thresholdC + 2);
  return meanHours * Math.min(1, dT / denom);
}

export function incrementDeltaC(deltaPct: number, currentCanopyPct: number | null | undefined) {
  return round3(deltaC(clampCanopyDelta(deltaPct, currentCanopyPct), C_PER_PCT.central));
}

export function estimateScenario(args: {
  canopyDeltaPct: number;
  currentCanopyPct?: number | null;
  meanC?: number | null;
  meanHours?: number | null;
  thresholdC: number;
}) {
  const applied = clampCanopyDelta(args.canopyDeltaPct, args.currentCanopyPct);
  const low = deltaC(applied, C_PER_PCT.low);
  const central = deltaC(applied, C_PER_PCT.central);
  const high = deltaC(applied, C_PER_PCT.high);
  return {
    kind: "literature_overlay" as const,
    metric: "air_temperature_c" as const,
    canopy_delta_pct: applied,
    estimated_delta_c: round3(central),
    estimated_delta_c_range: { low: round3(low), high: round3(high) },
    estimated_hours_saved: round2(hoursSaved(args.meanHours, args.meanC, args.thresholdC, central)),
    estimated_hours_saved_range: {
      low: round2(hoursSaved(args.meanHours, args.meanC, args.thresholdC, low)),
      high: round2(hoursSaved(args.meanHours, args.meanC, args.thresholdC, high)),
    },
    estimated_mean_c: args.meanC == null ? null : round2(args.meanC - central),
    citations: CITATIONS,
  };
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

function round2(n: number | null) {
  if (n == null || Number.isNaN(n)) return null;
  return Math.round(n * 100) / 100;
}
