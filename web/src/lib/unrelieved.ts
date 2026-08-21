/** Unrelieved-heat ratio — HeatCast duration index (mirrors api/app/unrelieved.py). */

export const UNRELIEVED_FORMULA =
  "unrelieved_heat_ratio = min(1, max(0, mean_streak_hours / mean_hours_above))";

export const UNRELIEVED_CITATION_URL =
  "https://www.cdc.gov/niosh/docs/2017-127/pdfs/2017-127.pdf";

export const UNRELIEVED_CITATION_TITLE = "NIOSH Heat Stress: Work/Rest Schedules (2017-127)";

export const UNRELIEVED_OSHA_URL = "https://www.osha.gov/heat-exposure/rulemaking/";

export const UNRELIEVED_METHOD_BLURB =
  "Unrelieved-heat ratio is a HeatCast index: mean longest consecutive streak ÷ mean total hours above threshold, clipped to 0–1. Near 1 means those hours arrived as one unbroken run (no below-threshold recovery window in the scored period). It is not a NIOSH work/rest table or WBGT limit. NIOSH states that continuous work in the heat is not advisable and rest breaks let the body cool; OSHA’s proposed high-heat trigger would require a 15-minute paid rest at least every two hours.";

export type UnrelievedPayload = {
  ratio: number;
  label?: string;
  formula?: string;
  citation_title?: string;
  citation_url?: string;
  osha_nprm_url?: string;
  note?: string;
};

export type ScorecardHours = {
  threshold_c?: number;
  mean_hours_above?: number | null;
  mean_streak_hours?: number | null;
  unrelieved_heat_ratio?: number | null;
  unrelieved?: UnrelievedPayload | null;
};

function asFinite(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function unrelievedHeatRatio(
  meanStreakHours: number | null | undefined,
  meanHoursAbove: number | null | undefined,
): number | null {
  const hours = asFinite(meanHoursAbove);
  const streakRaw = asFinite(meanStreakHours);
  if (hours == null || streakRaw == null || hours <= 0) return null;
  const streak = streakRaw < 0 ? 0 : streakRaw;
  const ratio = streak / hours;
  if (ratio < 0) return 0;
  if (ratio > 1) return 1;
  return Math.round(ratio * 1000) / 1000;
}

export function resolveUnrelieved(scorecard: ScorecardHours): UnrelievedPayload | null {
  const nested = scorecard.unrelieved;
  if (nested && Number.isFinite(nested.ratio)) {
    return {
      ...nested,
      ratio: Math.min(1, Math.max(0, nested.ratio)),
      formula: nested.formula || UNRELIEVED_FORMULA,
      citation_url: nested.citation_url || UNRELIEVED_CITATION_URL,
      citation_title: nested.citation_title || UNRELIEVED_CITATION_TITLE,
    };
  }
  const fromField = asFinite(scorecard.unrelieved_heat_ratio);
  const ratio =
    fromField != null
      ? Math.min(1, Math.max(0, fromField))
      : unrelievedHeatRatio(scorecard.mean_streak_hours, scorecard.mean_hours_above);
  if (ratio == null) return null;
  return {
    ratio,
    label: "Unrelieved-heat ratio",
    formula: UNRELIEVED_FORMULA,
    citation_title: UNRELIEVED_CITATION_TITLE,
    citation_url: UNRELIEVED_CITATION_URL,
    note: "HeatCast index: longest consecutive hours ÷ total hours above threshold.",
  };
}

export function unrelievedSentence(
  ratio: number,
  meanStreakHours: number | null | undefined,
  meanHoursAbove: number | null | undefined,
  thresholdC: number | null | undefined,
): string {
  const pct = Math.round(ratio * 100);
  const thresh = asFinite(thresholdC);
  const hours = asFinite(meanHoursAbove);
  const streak = asFinite(meanStreakHours);
  const threshBit = thresh != null ? ` ≥ ${trimNum(thresh)}°C` : " above threshold";
  if (hours != null && streak != null) {
    return `${pct}% of hours${threshBit} arrived in the longest run (${trimNum(streak)} h of ${trimNum(hours)} h). Outdoor crews cannot wait for a cool hour inside that window.`;
  }
  return `${pct}% of exceedance hours sit in the longest consecutive run. High values mean unbroken heat, not scattered hours.`;
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(n < 10 ? 2 : 1).replace(/\.?0+$/, "");
}
