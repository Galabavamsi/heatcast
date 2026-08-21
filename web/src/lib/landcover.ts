/** Hotspot satellite mix for the sidebar stacked bar. Not a district NLCD raster. */

export type MixSlice = { key: string; label: string; pct: number; color: string };

const COLORS = {
  canopy: "#a3e635",
  vegetation: "#2dd4bf",
  impervious: "#94a3b8",
  water: "#22d3ee",
  other: "#3f4a5a",
};

type Buckets = {
  canopy_pct: number;
  vegetation_pct: number;
  impervious_pct: number;
  water_pct: number;
};

function sumMatching(percents: Record<string, number>, tokens: readonly string[]): number {
  let total = 0;
  for (const [name, value] of Object.entries(percents)) {
    const lower = name.toLowerCase();
    if (!tokens.some((tok) => lower.includes(tok))) continue;
    const n = Number(value);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

export function satelliteMixSlices(
  buckets?: Buckets | null,
  classes?: Record<string, number> | null,
): MixSlice[] {
  let canopy = 0;
  let vegetation = 0;
  let impervious = 0;
  let water = 0;
  if (buckets) {
    canopy = buckets.canopy_pct || 0;
    // vegetation_pct is canopy + grass; stack must not double-count trees.
    vegetation = Math.max(0, (buckets.vegetation_pct || 0) - canopy);
    impervious = buckets.impervious_pct || 0;
    water = buckets.water_pct || 0;
  } else if (classes && Object.keys(classes).length) {
    canopy = sumMatching(classes, ["tree", "plant", "canopy"]);
    vegetation = sumMatching(classes, ["grass", "shrub"]);
    impervious = sumMatching(classes, ["building", "road", "route", "sidewalk", "pavement", "asphalt"]);
    water = sumMatching(classes, ["water"]);
  } else {
    return [];
  }
  const slices: MixSlice[] = [
    { key: "canopy", label: "Canopy", pct: canopy, color: COLORS.canopy },
    { key: "vegetation", label: "Vegetation", pct: vegetation, color: COLORS.vegetation },
    { key: "impervious", label: "Impervious", pct: impervious, color: COLORS.impervious },
    { key: "water", label: "Water", pct: water, color: COLORS.water },
  ].filter((s) => s.pct > 0.05);
  if (!slices.length) return [];
  const used = slices.reduce((sum, s) => sum + s.pct, 0);
  if (used < 99.5) {
    slices.push({ key: "other", label: "Other", pct: Math.max(0, 100 - used), color: COLORS.other });
  }
  return slices;
}
