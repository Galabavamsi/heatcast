/** Mirrors api/app/district_index.py — 0–100 HeatCast index, not insurance. */

import { unrelievedHeatRatio } from "@/lib/unrelieved";
import type { DistrictIndex } from "@/lib/types";

const INTENSITY_SPAN = 12;
const INTENSITY_BELOW = 6;
const EXCEEDANCE_SPAN = 12;

const WEIGHTS = { intensity: 0.4, exceedance: 0.35, unrelieved: 0.25 };
const WEIGHTS_SVI = { intensity: 0.35, exceedance: 0.28, unrelieved: 0.22, svi: 0.15 };

export const DISTRICT_FORMULA =
  "index = 100 * (wI * clip((mean_c - threshold_c + 6) / 12, 0, 1) + wE * clip(mean_hours_above / 12, 0, 1) + wU * unrelieved_ratio + wS * mean_svi)";

function clip01(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

export function intensityComponent(meanC: number | null | undefined, thresholdC: number): number | null {
  if (meanC == null || !Number.isFinite(meanC)) return null;
  return round3(clip01((meanC - thresholdC + INTENSITY_BELOW) / INTENSITY_SPAN) ?? 0);
}

export function exceedanceComponent(hours: number | null | undefined): number | null {
  if (hours == null || !Number.isFinite(hours)) return null;
  return round3(clip01(hours / EXCEEDANCE_SPAN) ?? 0);
}

export function bandFor(index: number): DistrictIndex["band"] {
  if (index < 25) return "modest";
  if (index < 50) return "elevated";
  if (index < 75) return "high";
  return "extreme";
}

export function districtHeatcastIndex(args: {
  meanC?: number | null;
  thresholdC: number;
  meanHoursAbove?: number | null;
  meanStreakHours?: number | null;
  unrelievedRatio?: number | null;
  meanSvi?: number | null;
  source?: string;
}): DistrictIndex {
  const intensity = intensityComponent(args.meanC ?? null, args.thresholdC);
  const exceedance = exceedanceComponent(args.meanHoursAbove ?? null);
  let ratio = clip01(args.unrelievedRatio ?? null);
  if (ratio == null) {
    ratio = clip01(unrelievedHeatRatio(args.meanStreakHours ?? null, args.meanHoursAbove ?? null));
  }
  const svi = clip01(args.meanSvi ?? null);
  const hasSvi = svi != null;
  const weights = hasSvi ? WEIGHTS_SVI : WEIGHTS;
  const parts: DistrictIndex["components"] = {
    intensity,
    exceedance,
    unrelieved: ratio == null ? null : round3(ratio),
  };
  if (hasSvi) parts.svi = round3(svi ?? 0);
  const usable = Object.entries(parts).filter(([, v]) => v != null) as Array<[keyof typeof parts, number]>;
  if (!usable.length) {
    return {
      ok: false,
      kind: "heatcast_district_index",
      not_used: "insurance_fico_parametric",
      index: null,
      band: null,
      components: parts,
      weights,
      source: args.source || "open-meteo",
      label: "HeatCast district index",
      formula: DISTRICT_FORMULA,
      note: "Need a mean air temperature or exceedance hours.",
      missing: "Need a mean air temperature or exceedance hours.",
    };
  }
  const weightSum = usable.reduce((s, [k]) => s + weights[k as keyof typeof weights], 0);
  const raw = usable.reduce((s, [k, v]) => s + weights[k as keyof typeof weights] * v, 0) / weightSum;
  const index = Math.max(0, Math.min(100, Math.round(100 * raw)));
  return {
    ok: true,
    kind: "heatcast_district_index",
    not_used: "insurance_fico_parametric",
    index,
    band: bandFor(index),
    components: parts,
    weights: Object.fromEntries(usable.map(([k]) => [k, weights[k as keyof typeof weights]])),
    source: args.source || "open-meteo",
    label: "HeatCast district index",
    formula: DISTRICT_FORMULA,
    note: "0–100 HeatCast index from neighborhood mean air, exceedance hours, and unrelieved streak. Optional CDC SVI is a vulnerability overlay, not a risk premium. Not insurance, not a FICO of heat, not parametric payout.",
    mean_c: args.meanC == null ? null : Math.round(args.meanC * 100) / 100,
    threshold_c: args.thresholdC,
    mean_hours_above: args.meanHoursAbove == null ? null : Math.round(args.meanHoursAbove * 100) / 100,
    unrelieved_ratio: parts.unrelieved,
    mean_svi: hasSvi ? parts.svi : null,
  };
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
