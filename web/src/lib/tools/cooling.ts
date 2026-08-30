/** Mirrors api/app/cooling_plan.py — slider must not re-hit FortyGuard. */

import { C_PER_PCT, clampCanopyDelta, deltaC, hoursSaved } from "@/lib/scenario";

export const ROOF_C_PER_PCT = 0.008;
export const ROOF_DELTA_CAP = 1.2;
export const PAVE_C_PER_PCT = 0.005;
export const PAVE_DELTA_CAP = 0.8;
export const LEVER_PCT_CAP = 40;
export const TOTAL_CAP = 2;

export function clampLever(pct: number) {
  return Math.round(Math.min(LEVER_PCT_CAP, Math.max(0, pct || 0)) * 100) / 100;
}

export function roofDeltaC(pct: number) {
  return round3(Math.min(ROOF_DELTA_CAP, clampLever(pct) * ROOF_C_PER_PCT));
}

export function paveDeltaC(pct: number) {
  return round3(Math.min(PAVE_DELTA_CAP, clampLever(pct) * PAVE_C_PER_PCT));
}

export function estimateCoolingPlan(args: {
  canopyDeltaPct: number;
  roofDeltaPct?: number;
  pavementDeltaPct?: number;
  currentCanopyPct?: number | null;
  meanC?: number | null;
  meanHours?: number | null;
  thresholdC: number;
}) {
  const canopyApplied = clampCanopyDelta(args.canopyDeltaPct, args.currentCanopyPct);
  const canopyLow = deltaC(canopyApplied, C_PER_PCT.low);
  const canopyC = deltaC(canopyApplied, C_PER_PCT.central);
  const canopyHigh = deltaC(canopyApplied, C_PER_PCT.high);
  const roofC = roofDeltaC(args.roofDeltaPct || 0);
  const paveC = paveDeltaC(args.pavementDeltaPct || 0);
  const total = round3(Math.min(TOTAL_CAP, canopyC + roofC + paveC));
  return {
    kind: "literature_overlay" as const,
    canopy_delta_pct: canopyApplied,
    roof_delta_pct: clampLever(args.roofDeltaPct || 0),
    pavement_delta_pct: clampLever(args.pavementDeltaPct || 0),
    canopy_c: round3(canopyC),
    roof_c: roofC,
    pave_c: paveC,
    estimated_delta_c: total,
    estimated_delta_c_range: {
      low: round3(Math.min(TOTAL_CAP, canopyLow + roofC + paveC)),
      high: round3(Math.min(TOTAL_CAP, canopyHigh + roofC + paveC)),
    },
    estimated_hours_saved: hoursSaved(args.meanHours, args.meanC, args.thresholdC, total),
    estimated_mean_c: args.meanC == null ? null : round2(args.meanC - total),
    attribution: [
      { lever: "Tree canopy", delta_c: round3(canopyC), tone: "#a3e635" },
      { lever: "Cool roofs", delta_c: roofC, tone: "#67e8f9" },
      { lever: "Cool pavement", delta_c: paveC, tone: "#94a3b8" },
    ],
  };
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
