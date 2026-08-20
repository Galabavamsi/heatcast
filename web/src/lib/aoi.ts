export type BBox = [west: number, south: number, east: number, north: number];

export const MAX_AREA_MI2 = 45;
export const MIN_AREA_MI2 = 0.04;

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

export function areaMi2(b: BBox): number {
  const [west, south, east, north] = normalizeBBox(b);
  const lat = (south + north) / 2;
  const km2 = (east - west) * (north - south) * (111.32 * Math.cos((lat * Math.PI) / 180)) * 110.57;
  return km2 / 2.589988;
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
  const dLat = halfKm / 110.57;
  const dLon = halfKm / (111.32 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}
