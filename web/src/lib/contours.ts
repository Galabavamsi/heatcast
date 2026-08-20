/** Isolines from FortyGuard tile centroids / polygons. Not a MapLibre render-loop job. */

import { contours } from "d3-contour";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";

const TEMP_KEYS = ["temperature", "max_temperature", "average_temperature"] as const;
const HOURS_KEYS = ["hours", "hours_above", "value"] as const;

type LngLat = [number, number];
type BBox = [LngLat, LngLat];

function numProp(props: Record<string, unknown> | null | undefined, keys: readonly string[]): number | null {
  if (!props) return null;
  for (const key of keys) {
    const raw = props[key];
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asLonLat(pt: Position): LngLat | null {
  if (!Array.isArray(pt) || pt.length < 2) return null;
  const a = Number(pt[0]);
  const b = Number(pt[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return [a, b];
}

function geomExtent(geom: Geometry): [number, number, number, number] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const walk = (pt: Position) => {
    const xy = asLonLat(pt);
    if (!xy) return;
    minX = Math.min(minX, xy[0]);
    minY = Math.min(minY, xy[1]);
    maxX = Math.max(maxX, xy[0]);
    maxY = Math.max(maxY, xy[1]);
  };
  if (geom.type === "Polygon") geom.coordinates.forEach((ring) => ring.forEach(walk));
  else if (geom.type === "MultiPolygon") geom.coordinates.forEach((poly) => poly.forEach((ring) => ring.forEach(walk)));
  else return null;
  if (!Number.isFinite(minX) || minX === maxX || minY === maxY) return null;
  return [minX, minY, maxX, maxY];
}

function dedupeLevels(vals: number[], digits: number): number[] {
  const out: number[] = [];
  const gap = 0.5 * 10 ** -digits;
  for (const v of vals) {
    const n = Number(v.toFixed(digits));
    if (!out.length || Math.abs(n - out[out.length - 1]) >= gap) out.push(n);
  }
  return out;
}

export function niceIsolineLevels(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const span = hi - lo;
  if (!(span > 0)) return [Number(lo.toFixed(2))];

  // Tiny domains still need a visible stroke (screenshot was 0.2°C with stacked 36.5/36.6 labels).
  if (span < 0.08) return [Number(((lo + hi) / 2).toFixed(2))];
  if (span < 0.4) {
    const step = span <= 0.25 ? 0.05 : 0.1;
    const digits = step < 0.1 ? 2 : 1;
    const levels: number[] = [];
    const start = Math.ceil((lo + step * 0.02) / step) * step;
    for (let v = start; v < hi - step * 0.02 && levels.length < 6; v += step) {
      const n = Number(v.toFixed(digits));
      if (n > lo && n < hi) levels.push(n);
    }
    const unique = dedupeLevels(levels, digits);
    if (unique.length >= 3) return unique;
    return dedupeLevels([lo + span * 0.25, lo + span * 0.5, lo + span * 0.75], 2);
  }

  const raw = span / Math.max(4, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const nice = [1, 2, 2.5, 5, 10].map((n) => n * mag);
  let step = nice[0];
  let best = Infinity;
  for (const c of nice) {
    const count = Math.floor(span / c);
    const score = count < 4 ? 4 - count + 3 : count > 6 ? count - 6 : Math.abs(count - target) * 0.2;
    if (score < best) {
      best = score;
      step = c;
    }
  }
  const start = Math.ceil((lo + step * 0.18) / step) * step;
  const levels: number[] = [];
  const digits = step < 0.5 ? 2 : step < 1 ? 1 : 0;
  for (let v = start; v < hi - step * 0.12 && levels.length < 6; v += step) {
    const rounded = Math.round(v / step) * step;
    const n = Number(rounded.toFixed(digits));
    if (n > lo && n < hi && (levels.length === 0 || Math.abs(n - levels[levels.length - 1]) > step * 0.4)) {
      levels.push(n);
    }
  }
  return levels.length ? levels : [Number(((lo + hi) / 2).toFixed(Math.min(2, digits || 2)))];
}

function gridSize(featureCount: number, bounds: BBox): { cols: number; rows: number } {
  const [[west, south], [east, north]] = bounds;
  const dx = Math.max(east - west, 1e-9);
  const dy = Math.max(north - south, 1e-9);
  const aspect = dx / dy;
  const long = Math.min(96, Math.max(28, Math.round(Math.sqrt(Math.max(featureCount, 9)) * 2.4)));
  if (aspect >= 1) {
    return { cols: long, rows: Math.max(20, Math.round(long / aspect)) };
  }
  return { rows: long, cols: Math.max(20, Math.round(long * aspect)) };
}

function fillGrid(
  fc: FeatureCollection,
  bounds: BBox,
  cols: number,
  rows: number,
  keys: readonly string[],
): Float64Array {
  const [[west, south], [east, north]] = bounds;
  const lonSpan = east - west || 1e-9;
  const latSpan = north - south || 1e-9;
  const acc = new Float64Array(cols * rows);
  const cnt = new Uint16Array(cols * rows);

  for (const ft of fc.features) {
    const val = numProp(ft.properties as Record<string, unknown>, keys);
    if (val == null) continue;
    const ext = geomExtent(ft.geometry);
    if (!ext) continue;
    const gx0 = Math.max(0, Math.floor(((ext[0] - west) / lonSpan) * cols));
    const gx1 = Math.min(cols - 1, Math.ceil(((ext[2] - west) / lonSpan) * cols));
    const gy0 = Math.max(0, Math.floor(((north - ext[3]) / latSpan) * rows));
    const gy1 = Math.min(rows - 1, Math.ceil(((north - ext[1]) / latSpan) * rows));
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const i = gy * cols + gx;
        acc[i] += val;
        cnt[i] += 1;
      }
    }
  }

  const values = new Float64Array(cols * rows);
  for (let i = 0; i < values.length; i++) {
    values[i] = cnt[i] > 0 ? acc[i] / cnt[i] : Number.NaN;
  }
  return values;
}

function gridToLngLat(x: number, y: number, bounds: BBox, cols: number, rows: number): LngLat {
  const [[west, south], [east, north]] = bounds;
  const lon = west + (x / cols) * (east - west);
  const lat = north - (y / rows) * (north - south);
  return [lon, lat];
}

function ringToLine(ring: Position[], bounds: BBox, cols: number, rows: number): Position[] {
  const line: Position[] = [];
  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    line.push(gridToLngLat(Number(pt[0]), Number(pt[1]), bounds, cols, rows));
  }
  return line;
}

function labelPoint(line: Position[]): Position | null {
  if (line.length < 2) return null;
  const idx = Math.min(line.length - 1, Math.max(1, Math.floor(line.length * 0.38)));
  return line[idx] ?? null;
}

export type IsolineResult = {
  lines: FeatureCollection;
  labels: FeatureCollection;
  levels: number[];
};

const EMPTY: IsolineResult = {
  lines: { type: "FeatureCollection", features: [] },
  labels: { type: "FeatureCollection", features: [] },
  levels: [],
};

let loggedEmptyContours = false;

function logEmptyContours(payload: Record<string, unknown>) {
  if (loggedEmptyContours) return;
  loggedEmptyContours = true;
  console.warn("[contours] contour features length is 0", payload);
}

function replaceNaN(values: Float64Array, below: number): Float64Array {
  const out = values.slice();
  for (let i = 0; i < out.length; i++) {
    if (!Number.isFinite(out[i])) out[i] = below;
  }
  return out;
}

export function buildIsolines(
  fc: FeatureCollection,
  bounds: BBox | null,
  prop: "temperature" | "hours",
  domain: { min: number; max: number } | null,
): IsolineResult {
  if (!fc.features.length || !bounds || !domain) return EMPTY;
  const levels = niceIsolineLevels(domain.min, domain.max, 5);
  if (!levels.length) {
    logEmptyContours({ reason: "no-levels", min: domain.min, max: domain.max, features: fc.features.length });
    return EMPTY;
  }
  const { cols, rows } = gridSize(fc.features.length, bounds);
  const keys = prop === "hours" ? ([...HOURS_KEYS, ...TEMP_KEYS] as const) : TEMP_KEYS;
  const rawValues = fillGrid(fc, bounds, cols, rows, keys);
  let filled = 0;
  for (let i = 0; i < rawValues.length; i++) if (Number.isFinite(rawValues[i])) filled += 1;
  if (filled < 12) {
    logEmptyContours({ reason: "sparse-grid", filled, cols, rows, features: fc.features.length });
    return EMPTY;
  }
  const below = Math.min(...levels) - Math.max(0.05, (domain.max - domain.min) / 8);
  const values = replaceNaN(rawValues, below);

  let generated: Array<{ type: string; value: number; coordinates: Position[][][] }>;
  try {
    generated = contours()
      .size([cols, rows])
      .smooth(true)
      .thresholds(levels)(Array.from(values)) as Array<{
      type: string;
      value: number;
      coordinates: Position[][][];
    }>;
  } catch (err) {
    logEmptyContours({
      reason: "d3-throw",
      error: err instanceof Error ? err.message : String(err),
      levels,
      filled,
    });
    return EMPTY;
  }

  const lines: Feature[] = [];
  const labels: Feature[] = [];
  for (const contour of generated) {
    const value = Number(contour.value);
    if (!Number.isFinite(value)) continue;
    let longest: Position[] | null = null;
    let longestLen = 0;
    for (const poly of contour.coordinates || []) {
      const ring = poly?.[0];
      if (!ring || ring.length < 4) continue;
      const line = ringToLine(ring, bounds, cols, rows);
      if (line.length < 4) continue;
      lines.push({
        type: "Feature",
        properties: { value, iso: value },
        geometry: { type: "LineString", coordinates: line },
      });
      if (line.length > longestLen) {
        longest = line;
        longestLen = line.length;
      }
    }
    if (longest) {
      const pt = labelPoint(longest);
      if (pt) {
        labels.push({
          type: "Feature",
          properties: { value, iso: value },
          geometry: { type: "Point", coordinates: pt },
        });
      }
    }
  }
  if (!lines.length) {
    logEmptyContours({
      reason: "d3-empty",
      levels,
      filled,
      cols,
      rows,
      features: fc.features.length,
      span: domain.max - domain.min,
    });
  }
  return {
    lines: { type: "FeatureCollection", features: lines },
    labels: { type: "FeatureCollection", features: labels },
    levels,
  };
}
