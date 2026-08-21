/** Bin exceedance hours (or TCM °C fallback) for the sidebar. No charting library. */

const TEMP_KEYS = ["temperature", "max_temperature", "average_temperature"] as const;
const HOURS_KEYS = ["hours", "hours_above"] as const;
/** ~2× a 100 m tile. Farther than this is a slimmed-grid miss, not the hotspot. */
const HOTSPOT_JOIN_M = 200;

export type TileFeature = {
  geometry?: { type: string; coordinates: unknown };
  properties?: Record<string, unknown> | null;
};

export type HistBin = {
  x0: number;
  x1: number;
  count: number;
};

export type HistogramKind = "hours" | "temp";

function asNum(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

function firstNum(props: Record<string, unknown> | null | undefined, keys: readonly string[]): number | null {
  if (!props) return null;
  for (const key of keys) {
    const n = asNum(props[key]);
    if (n != null) return n;
  }
  return null;
}

export function tileHours(props: Record<string, unknown> | null | undefined): number | null {
  const hours = firstNum(props, HOURS_KEYS);
  if (hours != null) return hours;
  const hasTemp = TEMP_KEYS.some((key) => firstNum(props, [key]) != null);
  if (hasTemp) return null;
  return firstNum(props, ["value"]);
}

export function tileTempC(props: Record<string, unknown> | null | undefined): number | null {
  return firstNum(props, TEMP_KEYS);
}

export function extractHours(features: TileFeature[] | null | undefined): number[] {
  if (!features?.length) return [];
  const out: number[] = [];
  for (const ft of features) {
    const n = tileHours(ft.properties);
    if (n != null) out.push(n);
  }
  return out;
}

export function extractTemps(features: TileFeature[] | null | undefined): number[] {
  if (!features?.length) return [];
  const out: number[] = [];
  for (const ft of features) {
    const n = tileTempC(ft.properties);
    if (n != null) out.push(n);
  }
  return out;
}

export function compactNum(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** API `score_aoi` stores share as round(above/n, 3) → 0–1. */
export function shareToPercent(share: number | null | undefined): number | null {
  if (share == null || !Number.isFinite(share) || share < 0) return null;
  if (share <= 1) return Math.round(share * 100);
  if (share <= 100) return Math.round(share);
  return null;
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

export function binValues(values: number[], targetBins = 8): HistBin[] {
  if (!values.length) return [];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (hi - lo < 1e-9) {
    return [{ x0: lo, x1: lo, count: values.length }];
  }
  const n = Math.max(6, Math.min(10, targetBins));
  const width = (hi - lo) / n;
  const bins: HistBin[] = [];
  for (let i = 0; i < n; i++) {
    bins.push({
      x0: lo + i * width,
      x1: i === n - 1 ? hi : lo + (i + 1) * width,
      count: 0,
    });
  }
  for (const v of values) {
    let i = Math.floor((v - lo) / width);
    if (i < 0) i = 0;
    if (i >= n) i = n - 1;
    bins[i].count += 1;
  }
  return bins;
}

export function iqrCaption(values: number[], kind: HistogramKind): string | null {
  const p25 = percentile(values, 0.25);
  const p75 = percentile(values, 0.75);
  if (p25 == null || p75 == null) return null;
  if (kind === "hours") {
    if (Math.abs(p75 - p25) < 0.15) {
      return `Most of this box is ${compactNum(p25)} h above threshold, not one hot pin.`;
    }
    return `Most of this box is ${compactNum(p25)}–${compactNum(p75)} h above threshold, not one hot pin.`;
  }
  if (Math.abs(p75 - p25) < 0.15) {
    return `Most of this box is ${compactNum(p25)} °C, not one hot pin.`;
  }
  return `Most of this box is ${compactNum(p25)}–${compactNum(p75)} °C, not one hot pin.`;
}

function featureCentroid(geometry: TileFeature["geometry"]): { lon: number; lat: number } | null {
  if (!geometry) return null;
  let ring: unknown = null;
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    ring = geometry.coordinates[0];
  } else if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    const first = geometry.coordinates[0];
    ring = Array.isArray(first) ? first[0] : null;
  }
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const pts = ring.filter((p) => Array.isArray(p) && p.length >= 2) as number[][];
  if (pts.length < 3) return null;
  const last = pts[pts.length - 1];
  const first = pts[0];
  const closed = last[0] === first[0] && last[1] === first[1];
  const body = closed ? pts.slice(0, -1) : pts;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const p of body) {
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sx += x;
    sy += y;
    n += 1;
  }
  if (!n) return null;
  return { lon: sx / n, lat: sy / n };
}

function haversineM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function hoursAtHotspot(
  features: TileFeature[] | null | undefined,
  hotspot: { lon: number; lat: number; tile_id?: string | number | null } | null | undefined,
): number | null {
  if (!hotspot || !features?.length) return null;
  const hid = hotspot.tile_id;
  if (hid != null && String(hid) !== "") {
    const match = features.find((ft) => String(ft.properties?.tile_id ?? "") === String(hid));
    const hours = match ? tileHours(match.properties) : null;
    if (hours != null) return hours;
  }
  let best: { d: number; hours: number } | null = null;
  for (const ft of features) {
    const hours = tileHours(ft.properties);
    if (hours == null) continue;
    const c = featureCentroid(ft.geometry);
    if (!c) continue;
    const d = haversineM(c.lon, c.lat, hotspot.lon, hotspot.lat);
    if (!best || d < best.d) best = { d, hours };
  }
  if (!best || best.d > HOTSPOT_JOIN_M) return null;
  return best.hours;
}
