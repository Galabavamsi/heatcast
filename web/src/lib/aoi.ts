export type BBox = [west: number, south: number, east: number, north: number];

export const MAX_AREA_MI2 = 45;
export const MIN_AREA_MI2 = 0.04;
/** International mile (exact). Keep in sync with api/app/geo.py. */
const M_PER_MI = 1609.344;

export function normalizeBBox(b: BBox): BBox {
  const west = Math.min(b[0], b[2]);
  const east = Math.max(b[0], b[2]);
  const south = Math.min(b[1], b[3]);
  const north = Math.max(b[1], b[3]);
  return [west, south, east, north];
}

export function inUs(lon: number, lat: number): boolean {
  if (lon >= -125 && lon <= -66.5 && lat >= 24.4 && lat <= 49.5) return true;
  if (lon >= -170 && lon <= -129 && lat >= 51 && lat <= 72) return true;
  if (lon >= -161 && lon <= -154 && lat >= 18.5 && lat <= 22.5) return true;
  return false;
}

/** WGS84 metres per degree at geodetic latitude. Must match api/app/geo.py. */
function metersPerDegree(latDeg: number): { mLat: number; mLon: number } {
  const phi = (latDeg * Math.PI) / 180;
  const mLat = 111132.954 - 559.822 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
  const mLon = 111320 * Math.cos(phi);
  return { mLat, mLon };
}

/** Local WGS84 rectangle in mi² (not Web Mercator). Longitude is scaled by cos(φ). */
export function areaMi2(b: BBox): number {
  const [west, south, east, north] = normalizeBBox(b);
  const lat = (south + north) / 2;
  const { mLat, mLon } = metersPerDegree(lat);
  const m2 = (east - west) * mLon * (north - south) * mLat;
  return m2 / (M_PER_MI * M_PER_MI);
}

export function expandBBox(b: BBox, factor: number): BBox {
  const [west, south, east, north] = normalizeBBox(b);
  const cx = (west + east) / 2;
  const cy = (south + north) / 2;
  const hx = ((east - west) / 2) * factor;
  const hy = ((north - south) / 2) * factor;
  return [cx - hx, cy - hy, cx + hx, cy + hy];
}

export function shrinkToMax(b: BBox, maxMi2 = MAX_AREA_MI2): BBox {
  const box = normalizeBBox(b);
  const area = areaMi2(box);
  if (area <= maxMi2 || area <= 0) return box;
  return expandBBox(box, Math.sqrt(maxMi2 / area));
}

export function aoiFeature(b: BBox): GeoJSON.FeatureCollection {
  const [west, south, east, north] = normalizeBBox(b);
  const ring: GeoJSON.Position[] = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [ring] },
      },
    ],
  };
}

export function bboxCenter(b: BBox): { lon: number; lat: number } {
  const [west, south, east, north] = normalizeBBox(b);
  return { lon: (west + east) / 2, lat: (south + north) / 2 };
}

export function bboxFromCenter(lon: number, lat: number, halfKm = 1.1): BBox {
  const { mLat, mLon } = metersPerDegree(lat);
  const dLat = (halfKm * 1000) / mLat;
  const dLon = (halfKm * 1000) / Math.max(0.2 * 111320, mLon);
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

/** Fit zoom for a restored box. Does not fly on every drag — callers set view once. */
export function zoomForBBox(b: BBox): number {
  const [west, south, east, north] = normalizeBBox(b);
  const span = Math.max(east - west, north - south);
  if (span > 1.2) return 9;
  if (span > 0.45) return 11;
  if (span > 0.12) return 13;
  if (span > 0.04) return 14;
  return 15;
}
