/** OSM-building shade at the scored hour. Geometry overlay — not a FortyGuard product. */

import * as SunCalc from "suncalc";
import type { Feature, FeatureCollection, Position } from "geojson";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const MAX_BUILDINGS = 180;
const MAX_SHADOW_M = 160;
const MIN_SUN_DEG = 2;

export type ShadeMeta = {
  altitudeDeg: number;
  azimuthDeg: number;
  night: boolean;
  shadowM: number | null;
  whenIso: string;
  note: string;
};

export type ShadeResult = {
  shadows: FeatureCollection;
  meta: ShadeMeta;
};

export function dateInTimeZone(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wanted = Date.UTC(year, month - 1, day, hour, minute || 0, 0);
  const guess = new Date(wanted);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(fmt.formatToParts(guess).map((p) => [p.type, p.value]));
    const hourVal = parts.hour === "24" ? 0 : Number(parts.hour);
    const asIf = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      hourVal,
      Number(parts.minute),
      Number(parts.second),
    );
    guess.setTime(guess.getTime() + (wanted - asIf));
  }
  return guess;
}

function shiftMeters(lon: number, lat: number, eastM: number, northM: number): Position {
  const dLat = northM / 111_320;
  const dLon = eastM / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return [lon + dLon, lat + dLat];
}

function extrudeRing(ring: Position[], eastM: number, northM: number): Position[][] {
  const shifted = ring.map((pt) => shiftMeters(Number(pt[0]), Number(pt[1]), eastM, northM));
  const quads: Position[][] = [];
  const n = ring.length;
  for (let i = 0; i < n - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    const bp = shifted[i + 1];
    const ap = shifted[i];
    if (!a || !b || !ap || !bp) continue;
    quads.push([a, b, bp, ap, a]);
  }
  return quads;
}

function closedRing(ring: Position[]): Position[] {
  if (ring.length < 3) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) return ring;
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

export function buildingShadows(
  buildings: FeatureCollection | null | undefined,
  date: string,
  time: string,
  timeZone: string,
  lat: number,
  lon: number,
): ShadeResult {
  const when = dateInTimeZone(date, time, timeZone);
  const pos = SunCalc.getPosition(when, lat, lon);
  // SunCalc v2: altitude/azimuth are degrees; azimuth is clockwise from north.
  const altitudeDeg = pos.altitude;
  const azimuthDeg = pos.azimuth;
  const altRad = (altitudeDeg * Math.PI) / 180;
  const azRad = (azimuthDeg * Math.PI) / 180;
  const note =
    "Building shade from OSM footprints + sun position at the scored hour. Geometry overlay, not a FortyGuard run.";
  if (altitudeDeg <= MIN_SUN_DEG) {
    return {
      shadows: EMPTY,
      meta: {
        altitudeDeg,
        azimuthDeg,
        night: true,
        shadowM: null,
        whenIso: when.toISOString(),
        note,
      },
    };
  }
  const typicalH = 9;
  const shadowM = Math.min(typicalH / Math.tan(altRad), MAX_SHADOW_M);
  const features: Feature[] = [];
  const list = (buildings?.features || []).slice(0, MAX_BUILDINGS);
  for (const ft of list) {
    const geom = ft.geometry;
    if (!geom || (geom.type !== "Polygon" && geom.type !== "MultiPolygon")) continue;
    const height = Number((ft.properties as { height?: number } | null)?.height);
    const h = Number.isFinite(height) && height > 1 ? Math.min(height, 80) : 9;
    const length = Math.min(h / Math.tan(altRad), MAX_SHADOW_M);
    const eastM = -Math.sin(azRad) * length;
    const northM = -Math.cos(azRad) * length;
    const rings: Position[][] =
      geom.type === "Polygon" ? [geom.coordinates[0] || []] : geom.coordinates.map((poly) => poly[0] || []);
    const quads: Position[][] = [];
    const umbras: Position[][] = [];
    const masses: Position[][] = [];
    for (const ring of rings) {
      if (ring.length < 4) continue;
      const closed = closedRing(ring);
      masses.push(closed);
      umbras.push(closedRing(closed.map((pt) => shiftMeters(Number(pt[0]), Number(pt[1]), eastM, northM))));
      if (length >= 6) quads.push(...extrudeRing(closed, eastM, northM));
    }
    if (!masses.length) continue;
    features.push({
      type: "Feature",
      properties: { height: h, shadow_m: Math.round(length), kind: "mass" },
      geometry: { type: "MultiPolygon", coordinates: masses.map((q) => [q]) },
    });
    features.push({
      type: "Feature",
      properties: { height: h, shadow_m: Math.round(length), kind: "umbra" },
      geometry: { type: "MultiPolygon", coordinates: [...umbras, ...quads].map((q) => [q]) },
    });
  }
  return {
    shadows: { type: "FeatureCollection", features },
    meta: {
      altitudeDeg,
      azimuthDeg,
      night: false,
      shadowM,
      whenIso: when.toISOString(),
      note,
    },
  };
}
