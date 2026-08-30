"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { Marker, NavigationControl, type MapRef } from "react-map-gl/maplibre";
import type { ExpressionSpecification, Map as MapLibreMap, MapLibreEvent, MapMouseEvent, StyleSpecification, SymbolLayerSpecification } from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import type { AnalyzeResponse, BuildingsResponse, SviResponse, SviTract, CoolingSite } from "@/lib/types";
import { areaMi2, bboxCenter, MAX_AREA_MI2, normalizeBBox, shrinkToMax, type BBox as AoiBBox } from "@/lib/aoi";
import { buildIsolines } from "@/lib/contours";

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

const TEMP_KEYS = ["temperature", "max_temperature", "average_temperature"] as const;
const HOURS_KEYS = ["hours", "hours_above", "value"] as const;

const FILL_ALPHA = 0.42;
const RASTER_OPACITY = 0.75;
const HEAT_IMAGE_ID = "heatcast-image";
const HEAT_RASTER_ID = "heatcast-raster";
const TRANSPORT_LAYER_ID = "esri-transport";
const PLACES_LAYER_ID = "esri-places";
const BUILDING_SOURCE_ID = "heatcast-buildings";
const BUILDING_LAYER_ID = "heatcast-buildings-3d";
const VOLUME_SOURCE_ID = "heatcast-volume";
const VOLUME_LAYER_ID = "heatcast-volume-3d";
const SVI_SOURCE_ID = "heatcast-svi";
const SVI_FILL_ID = "heatcast-svi-fill";
const SVI_LINE_ID = "heatcast-svi-line";
const SVI_HIGHLIGHT_ID = "heatcast-svi-highlight";
const CONTOUR_SOURCE_ID = "heatcast-contours";
const CONTOUR_HALO_ID = "heatcast-contours-halo";
const CONTOUR_LINE_ID = "heatcast-contours-line";
const CONTOUR_LABEL_SOURCE_ID = "heatcast-contour-labels";
const CONTOUR_LABEL_ID = "heatcast-contour-labels-sym";
const MAX_BUILDINGS = 280;
const RASTER_LONG_EDGE = 2048;
const TRANSPARENT_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** Cool → hot: violet/blue → orange → yellow (webinar-style, no near-black crimson). */
const RAMP: [number, [number, number, number]][] = [
  [0, [91, 33, 182]],
  [0.22, [37, 99, 235]],
  [0.48, [249, 115, 22]],
  [0.74, [251, 191, 36]],
  [1, [254, 240, 138]],
];

const DIVERGING_RAMP: [number, [number, number, number]][] = [
  [0, [37, 99, 235]],
  [0.5, [248, 250, 252]],
  [1, [220, 38, 38]],
];

type LngLat = [number, number];
type BBox = [LngLat, LngLat];
type ImageCorners = [LngLat, LngLat, LngLat, LngLat];

type HeatImageSource = {
  updateImage: (opts: { image: HTMLCanvasElement | ImageBitmap | ImageData; coordinates?: ImageCorners }) => void;
};

type RasterCache = {
  key: string;
  image: HTMLCanvasElement;
  coordinates: ImageCorners;
  width: number;
  height: number;
  featureCount: number;
  bbox: BBox;
};

function numProp(props: Record<string, unknown> | null | undefined, keys: readonly string[], depth = 0): number | null {
  if (!props) return null;
  for (const key of keys) {
    const raw = props[key];
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isFinite(n)) return n;
  }
  if (depth >= 1) return null;
  for (const val of Object.values(props)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const nested = numProp(val as Record<string, unknown>, keys, depth + 1);
      if (nested != null) return nested;
    }
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

function closeRing(ring: Position[]): Position[] {
  const pts: Position[] = [];
  for (const pt of ring) {
    const xy = asLonLat(pt);
    if (xy) pts.push(xy);
  }
  if (pts.length < 3) return pts;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) pts.push([first[0], first[1]]);
  return pts;
}

function ringLooksSwapped(ring: Position[]): boolean {
  let votes = 0;
  let n = 0;
  for (const pt of ring) {
    const xy = asLonLat(pt);
    if (!xy) continue;
    n += 1;
    const [x, y] = xy;
    if (Math.abs(x) <= 90 && Math.abs(y) > 90) votes += 1;
  }
  return n > 0 && votes / n > 0.6;
}

function swapRing(ring: Position[]): Position[] {
  return ring.map((pt) => {
    const xy = asLonLat(pt);
    return xy ? [xy[1], xy[0]] : pt;
  });
}

function normalizeGeometry(geom: Geometry, swap: boolean): Geometry | null {
  if (geom.type === "Polygon") {
    const rings = geom.coordinates
      .map((ring) => closeRing(swap ? swapRing(ring) : ring))
      .filter((ring) => ring.length >= 4);
    if (!rings.length) return null;
    return { type: "Polygon", coordinates: rings };
  }
  if (geom.type === "MultiPolygon") {
    const polys = geom.coordinates
      .map((poly) =>
        poly
          .map((ring) => closeRing(swap ? swapRing(ring) : ring))
          .filter((ring) => ring.length >= 4),
      )
      .filter((poly) => poly.length > 0);
    if (!polys.length) return null;
    return { type: "MultiPolygon", coordinates: polys };
  }
  return null;
}

function collectionNeedsSwap(list: unknown[]): boolean {
  let votes = 0;
  let n = 0;
  for (const item of list.slice(0, 40)) {
    if (!item || typeof item !== "object") continue;
    const geom = (item as { geometry?: Geometry }).geometry;
    const ring =
      geom?.type === "Polygon"
        ? geom.coordinates[0]
        : geom?.type === "MultiPolygon"
          ? geom.coordinates[0]?.[0]
          : null;
    if (!ring?.length) continue;
    n += 1;
    if (ringLooksSwapped(ring)) votes += 1;
  }
  return n > 0 && votes / n > 0.5;
}

function asCollection(raw: unknown): FeatureCollection {
  if (!raw || typeof raw !== "object") return EMPTY_FC;
  const obj = raw as { type?: string; features?: unknown; geometry?: unknown };
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(obj.features)
      ? obj.features
      : obj.geometry
        ? [raw]
        : [];
  const swap = collectionNeedsSwap(list);
  const features: Feature[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const ft = item as { geometry?: Geometry; properties?: Record<string, unknown>; id?: string | number };
    if (!ft.geometry) continue;
    const geom = normalizeGeometry(ft.geometry, swap);
    if (!geom) continue;
    const props = { ...(ft.properties || {}) };
    const temp = numProp(props, TEMP_KEYS) ?? numProp(props, ["delta_c"]);
    const hours = numProp(props, ["hours", "hours_above"]);
    const valueOnly = temp == null ? numProp(props, ["value"]) : null;
    if (temp != null) props.temperature = temp;
    if (hours != null) props.hours = hours;
    else if (valueOnly != null) props.hours = valueOnly;
    const tileId = props.tile_id;
    const id =
      ft.id ??
      (typeof tileId === "string" || typeof tileId === "number" ? tileId : features.length);
    features.push({
      type: "Feature",
      id,
      geometry: geom,
      properties: props,
    });
  }
  return { type: "FeatureCollection", features };
}

function divergingDomain(fc: FeatureCollection): { min: number; max: number } | null {
  const vals: number[] = [];
  for (const ft of fc.features) {
    const n =
      numProp(ft.properties as Record<string, unknown>, TEMP_KEYS) ??
      numProp(ft.properties as Record<string, unknown>, ["delta_c"]);
    if (n != null) vals.push(n);
  }
  if (!vals.length) return null;
  const absMax = Math.max(...vals.map((v) => Math.abs(v)), 0.25);
  return { min: -absMax, max: absMax };
}

function domainOf(fc: FeatureCollection, key: "temperature" | "hours"): { min: number; max: number } | null {
  const keys = key === "hours" ? ([...HOURS_KEYS, ...TEMP_KEYS] as const) : TEMP_KEYS;
  const vals: number[] = [];
  for (const ft of fc.features) {
    const n = numProp(ft.properties as Record<string, unknown>, keys);
    if (n != null) vals.push(n);
  }
  if (!vals.length) return null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  if (min === max) return { min: min - 0.25, max: max + 0.25 };
  return { min, max };
}

function boundsOf(fc: FeatureCollection): BBox | null {
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
  for (const ft of fc.features) {
    const geom = ft.geometry;
    if (geom.type === "Polygon") geom.coordinates.forEach((ring) => ring.forEach(walk));
    if (geom.type === "MultiPolygon") geom.coordinates.forEach((poly) => poly.forEach((ring) => ring.forEach(walk)));
  }
  if (!Number.isFinite(minX)) return null;
  if (minX === maxX || minY === maxY) {
    const pad = 0.004;
    return [
      [minX - pad, minY - pad],
      [maxX + pad, maxY + pad],
    ];
  }
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

function padBounds(bounds: BBox, frac = 0.012): BBox {
  const [[west, south], [east, north]] = bounds;
  const dx = (east - west) * frac;
  const dy = (north - south) * frac;
  return [
    [west - dx, south - dy],
    [east + dx, north + dy],
  ];
}

function cornersOf(bounds: BBox): ImageCorners {
  const [[west, south], [east, north]] = bounds;
  return [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];
}

function mercatorY(lat: number): number {
  const clamped = Math.max(-85.051129, Math.min(85.051129, lat));
  const s = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

function rampColor(t: number, ramp: typeof RAMP = RAMP): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  let i = 0;
  while (i < ramp.length - 2 && x > ramp[i + 1][0]) i += 1;
  const [t0, c0] = ramp[i];
  const [t1, c1] = ramp[i + 1];
  const u = (x - t0) / (t1 - t0 || 1);
  return [
    Math.round(c0[0] + (c1[0] - c0[0]) * u),
    Math.round(c0[1] + (c1[1] - c0[1]) * u),
    Math.round(c0[2] + (c1[2] - c0[2]) * u),
  ];
}

/** Public Carto basemap key only. Unkeyed cartocdn tiles 200 with a watermark — never fetch them without a key. */
const CARTO_API_KEY = (process.env.NEXT_PUBLIC_CARTO_API_KEY ?? "").trim();

/** Keyless Esri World Imagery — streets/buildings visible. World Dark Gray is outlines-only and looks blank. */
const ESRI_IMAGERY_TILES = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
];
const ESRI_TRANSPORT_TILES = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
];
const ESRI_PLACES_TILES = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
];
const ESRI_ATTRIBUTION =
  "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community";

function cartoDarkTiles(apiKey: string): string[] {
  const q = `?api_key=${encodeURIComponent(apiKey)}`;
  return [
    `https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png${q}`,
    `https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png${q}`,
    `https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png${q}`,
  ];
}

function rasterStyle(useEsri: boolean): StyleSpecification {
  const useCarto = Boolean(CARTO_API_KEY) && !useEsri;
  const tiles = useCarto ? cartoDarkTiles(CARTO_API_KEY) : ESRI_IMAGERY_TILES;
  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      basemap: {
        type: "raster",
        tiles,
        tileSize: 256,
        maxzoom: 19,
        attribution: useCarto ? "© OpenStreetMap © CARTO" : ESRI_ATTRIBUTION,
      },
      ...(useCarto
        ? {}
        : {
            "esri-transport": {
              type: "raster" as const,
              tiles: ESRI_TRANSPORT_TILES,
              tileSize: 256,
              maxzoom: 19,
              attribution: "Esri",
            },
            "esri-places": {
              type: "raster" as const,
              tiles: ESRI_PLACES_TILES,
              tileSize: 256,
              maxzoom: 19,
              attribution: "Esri",
            },
          }),
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#0b0d10" } },
      {
        id: "basemap",
        type: "raster",
        source: "basemap",
        paint: useCarto
          ? { "raster-saturation": -0.15, "raster-opacity": 0.92 }
          : {
              "raster-saturation": -0.28,
              "raster-brightness-max": 0.7,
              "raster-contrast": 0.08,
              "raster-opacity": 0.9,
            },
      },
      ...(useCarto
        ? []
        : [
            {
              id: TRANSPORT_LAYER_ID,
              type: "raster" as const,
              source: "esri-transport",
              paint: { "raster-opacity": 0.88 },
            },
            {
              id: PLACES_LAYER_ID,
              type: "raster" as const,
              source: "esri-places",
              paint: { "raster-opacity": 1 },
            },
          ]),
    ],
  };
}

function mapFromLoadEvent(e: MapLibreEvent | { target?: unknown; currentTarget?: { getMap?: () => MapLibreMap } }): MapLibreMap | null {
  const target = (e as { target?: unknown }).target as MapLibreMap | undefined;
  if (target && typeof target.addSource === "function" && typeof target.project === "function") return target;
  const via =
    (e as { currentTarget?: { getMap?: () => MapLibreMap } }).currentTarget?.getMap?.() ??
    (e as { target?: { getMap?: () => MapLibreMap } }).target?.getMap?.();
  if (via && typeof via.addSource === "function") return via;
  return null;
}

function imageSizeFor(bounds: BBox): { w: number; h: number } {
  const [[west, south], [east, north]] = bounds;
  const xSpan = Math.max((east - west) / 360, 1e-12);
  const ySpan = Math.max(mercatorY(south) - mercatorY(north), 1e-12);
  const aspect = xSpan / ySpan;
  if (aspect >= 1) {
    const w = RASTER_LONG_EDGE;
    const h = Math.max(512, Math.round(RASTER_LONG_EDGE / aspect));
    return { w, h };
  }
  const h = RASTER_LONG_EDGE;
  const w = Math.max(512, Math.round(RASTER_LONG_EDGE * aspect));
  return { w, h };
}

function projectFactory(bounds: BBox, w: number, h: number) {
  const [[west, south], [east, north]] = bounds;
  const dx = east - west || 1e-9;
  const y0 = mercatorY(north);
  const dy = mercatorY(south) - y0 || 1e-9;
  return (lon: number, lat: number): LngLat => [((lon - west) / dx) * w, ((mercatorY(lat) - y0) / dy) * h];
}

type Heat2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function traceRings(
  ctx: Heat2D,
  rings: Position[][],
  project: (lon: number, lat: number) => LngLat,
) {
  ctx.beginPath();
  for (const ring of rings) {
    let started = false;
    for (const pt of ring) {
      const xy = asLonLat(pt);
      if (!xy) continue;
      const [x, y] = project(xy[0], xy[1]);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    if (started) ctx.closePath();
  }
}

function drawFeaturePath(
  ctx: Heat2D,
  geom: Geometry,
  project: (lon: number, lat: number) => LngLat,
) {
  if (geom.type === "Polygon") {
    traceRings(ctx, geom.coordinates, project);
    return true;
  }
  if (geom.type === "MultiPolygon") {
    ctx.beginPath();
    for (const poly of geom.coordinates) {
      for (const ring of poly) {
        let started = false;
        for (const pt of ring) {
          const xy = asLonLat(pt);
          if (!xy) continue;
          const [x, y] = project(xy[0], xy[1]);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        if (started) ctx.closePath();
      }
    }
    return true;
  }
  return false;
}

function paintIsolines(
  ctx: Heat2D,
  lines: FeatureCollection,
  project: (lon: number, lat: number) => LngLat,
  w: number,
  h: number,
) {
  if (!lines.features.length) return;
  const halo = Math.max(1.2, Math.min(w, h) / 480);
  const core = Math.max(0.55, halo * 0.38);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const stroke = (color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    for (const ft of lines.features) {
      const geom = ft.geometry;
      const rings =
        geom.type === "LineString"
          ? [geom.coordinates]
          : geom.type === "MultiLineString"
            ? geom.coordinates
            : [];
      for (const ring of rings) {
        ctx.beginPath();
        let started = false;
        for (const pt of ring) {
          const xy = asLonLat(pt);
          if (!xy) continue;
          const [x, y] = project(xy[0], xy[1]);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        if (started) ctx.stroke();
      }
    }
  };
  stroke("rgba(248,250,252,0.28)", halo);
  stroke("rgba(241,245,249,0.18)", core);
}

function paintHeatTiles(
  ctx: Heat2D,
  fc: FeatureCollection,
  bounds: BBox,
  prop: "temperature" | "hours",
  domain: { min: number; max: number },
  w: number,
  h: number,
  isolines?: FeatureCollection | null,
  ramp: typeof RAMP = RAMP,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = "blur(1px)";
  const project = projectFactory(bounds, w, h);
  const keys = prop === "hours" ? ([...HOURS_KEYS, ...TEMP_KEYS] as const) : TEMP_KEYS;
  const span = domain.max - domain.min || 1;

  for (const ft of fc.features) {
    const val = numProp(ft.properties as Record<string, unknown>, keys);
    const t = val == null ? 0.5 : (val - domain.min) / span;
    const [r, g, b] = rampColor(t, ramp);
    ctx.fillStyle = `rgba(${r},${g},${b},${FILL_ALPHA})`;
    ctx.strokeStyle = `rgba(${r},${g},${b},${FILL_ALPHA * 0.45})`;
    ctx.lineWidth = 1.15;
    ctx.lineJoin = "round";
    if (!drawFeaturePath(ctx, ft.geometry, project)) continue;
    ctx.fill("evenodd");
    ctx.stroke();
  }
  ctx.filter = "none";
  if (isolines?.features.length) paintIsolines(ctx, isolines, project, w, h);
}

function rasterizeHeat(
  fc: FeatureCollection,
  bounds: BBox,
  prop: "temperature" | "hours",
  domain: { min: number; max: number },
  reuse?: HTMLCanvasElement | null,
  isolines?: FeatureCollection | null,
  ramp: typeof RAMP = RAMP,
): { canvas: HTMLCanvasElement; width: number; height: number } {
  const { w, h } = imageSizeFor(bounds);
  const canvas = reuse && reuse.width === w && reuse.height === h ? reuse : document.createElement("canvas");
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;

  if (typeof OffscreenCanvas !== "undefined") {
    const offscreen = new OffscreenCanvas(w, h);
    const offCtx = offscreen.getContext("2d");
    if (offCtx) {
      paintHeatTiles(offCtx, fc, bounds, prop, domain, w, h, isolines, ramp);
      const dst = canvas.getContext("2d", { alpha: true });
      if (dst) {
        dst.clearRect(0, 0, w, h);
        dst.drawImage(offscreen, 0, 0);
        return { canvas, width: w, height: h };
      }
    }
  }

  const ctx = canvas.getContext("2d", { alpha: true });
  if (ctx) paintHeatTiles(ctx, fc, bounds, prop, domain, w, h, isolines, ramp);
  return { canvas, width: w, height: h };
}

let applyingHeat = false;

function applyHeatRaster(
  map: MapLibreMap,
  cache: RasterCache | null,
  logOnce: (payload: Record<string, unknown>) => void,
  rasterOpacity = RASTER_OPACITY,
) {
  if (applyingHeat) return;
  applyingHeat = true;
  try {
    if (!cache) {
      if (map.getLayer(HEAT_RASTER_ID)) map.setLayoutProperty(HEAT_RASTER_ID, "visibility", "none");
      return;
    }
    if (!map.getSource(HEAT_IMAGE_ID)) {
      map.addSource(HEAT_IMAGE_ID, {
        type: "image",
        url: TRANSPARENT_PIXEL,
        coordinates: cache.coordinates,
      });
    }
    const src = map.getSource(HEAT_IMAGE_ID) as HeatImageSource | undefined;
    src?.updateImage({ image: cache.image, coordinates: cache.coordinates });
    if (!map.getLayer(HEAT_RASTER_ID)) {
      const heatLayer = {
        id: HEAT_RASTER_ID,
        type: "raster" as const,
        source: HEAT_IMAGE_ID,
        paint: {
          "raster-fade-duration": 280,
          "raster-opacity": rasterOpacity,
          "raster-resampling": "linear" as const,
        },
      };
      if (map.getLayer(PLACES_LAYER_ID)) map.addLayer(heatLayer, PLACES_LAYER_ID);
      else map.addLayer(heatLayer);
    } else {
      map.setPaintProperty(HEAT_RASTER_ID, "raster-opacity", rasterOpacity);
    }
    map.setLayoutProperty(HEAT_RASTER_ID, "visibility", "visible");
    restackOverlayLayers(map);
    map.triggerRepaint();
    logOnce({
      bbox: cache.bbox,
      features: cache.featureCount,
      imageSize: { width: cache.width, height: cache.height },
      "map.getLayer('heatcast-raster')": Boolean(map.getLayer(HEAT_RASTER_ID)),
    });
  } finally {
    applyingHeat = false;
  }
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function volumeFeatures(
  fc: FeatureCollection,
  prop: "temperature" | "hours",
  domain: { min: number; max: number },
  ramp: typeof RAMP = RAMP,
): FeatureCollection {
  const keys = prop === "hours" ? ([...HOURS_KEYS, ...TEMP_KEYS] as const) : TEMP_KEYS;
  const span = domain.max - domain.min || 1;
  return {
    type: "FeatureCollection",
    features: fc.features.map((ft, i) => {
      const val = numProp(ft.properties as Record<string, unknown>, keys);
      const t = val == null ? 0.5 : (val - domain.min) / span;
      const rgb = rampColor(t, ramp);
      return {
        ...ft,
        id: ft.id ?? i,
        properties: {
          ...ft.properties,
          heat_h: Math.round(6 + t * 64),
          heat_color: rgbToHex(rgb),
        },
      };
    }),
  };
}

function syncVolumeLayers(map: MapLibreMap, fc: FeatureCollection, visible: boolean) {
  const src = map.getSource(VOLUME_SOURCE_ID) as { setData?: (data: FeatureCollection) => void } | undefined;
  if (!src) {
    map.addSource(VOLUME_SOURCE_ID, { type: "geojson", data: fc, tolerance: 0 });
  } else {
    src.setData?.(fc);
  }
  if (!map.getLayer(VOLUME_LAYER_ID)) {
    map.addLayer({
      id: VOLUME_LAYER_ID,
      type: "fill-extrusion",
      source: VOLUME_SOURCE_ID,
      paint: {
        "fill-extrusion-color": ["coalesce", ["get", "heat_color"], "#ea580c"],
        "fill-extrusion-height": ["coalesce", ["to-number", ["get", "heat_h"]], 12],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.36,
        "fill-extrusion-vertical-gradient": true,
      },
      layout: { visibility: visible ? "visible" : "none" },
    });
  } else {
    map.setLayoutProperty(VOLUME_LAYER_ID, "visibility", visible ? "visible" : "none");
    map.setPaintProperty(VOLUME_LAYER_ID, "fill-extrusion-opacity", 0.36);
  }
  restackOverlayLayers(map);
}

function boxQuad(map: MapLibreMap, bbox: AoiBBox) {
  const [west, south, east, north] = normalizeBBox(bbox);
  const corners = [
    map.project([west, north]),
    map.project([east, north]),
    map.project([east, south]),
    map.project([west, south]),
  ];
  const label = map.project([(west + east) / 2, north]);
  return {
    points: corners.map((p) => `${p.x},${p.y}`).join(" "),
    label: { x: label.x, y: label.y },
  };
}

type SvgSviPath = { d: string; fill: string; opacity: number; fips: string; selected: boolean };
type SvgLinePath = { d: string };
type SvgWalk = {
  points: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
};

function isSportsCentre(site: CoolingSite) {
  return /sport/i.test(site.kind) || /sport/i.test(site.kindKey ?? "");
}

function amenityKey(site: CoolingSite) {
  return `${site.lon}:${site.lat}:${site.name}`;
}

function sviFillRgb(svi: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, svi));
  const stops: [number, [number, number, number]][] = [
    [0, [165, 180, 252]],
    [0.45, [129, 140, 248]],
    [0.75, [79, 70, 229]],
    [1, [76, 29, 149]],
  ];
  let i = 1;
  while (i < stops.length && t > stops[i][0]) i += 1;
  const [t0, c0] = stops[i - 1];
  const [t1, c1] = stops[Math.min(i, stops.length - 1)];
  const u = (t - t0) / (t1 - t0 || 1);
  return [
    Math.round(c0[0] + (c1[0] - c0[0]) * u),
    Math.round(c0[1] + (c1[1] - c0[1]) * u),
    Math.round(c0[2] + (c1[2] - c0[2]) * u),
  ];
}

function projectRingPath(map: MapLibreMap, ring: Position[], close: boolean): string {
  const step = ring.length > 160 ? Math.ceil(ring.length / 96) : 1;
  const parts: string[] = [];
  for (let i = 0; i < ring.length; i += step) {
    const xy = asLonLat(ring[i]);
    if (!xy) continue;
    const p = map.project(xy);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    parts.push(`${parts.length ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
  }
  if (close && parts.length >= 3) parts.push("Z");
  return parts.length >= 2 ? parts.join("") : "";
}

function geometryScreenPaths(map: MapLibreMap, geom: Geometry, close: boolean): string[] {
  if (geom.type === "Polygon") {
    const d = projectRingPath(map, geom.coordinates[0] || [], close);
    return d ? [d] : [];
  }
  if (geom.type === "MultiPolygon") {
    return geom.coordinates
      .map((poly) => projectRingPath(map, poly[0] || [], close))
      .filter(Boolean);
  }
  if (geom.type === "LineString") {
    const d = projectRingPath(map, geom.coordinates, false);
    return d ? [d] : [];
  }
  if (geom.type === "MultiLineString") {
    return geom.coordinates.map((line) => projectRingPath(map, line, false)).filter(Boolean);
  }
  return [];
}

function projectSviOverlay(map: MapLibreMap, fc: FeatureCollection, selectedFips: string | null): SvgSviPath[] {
  const out: SvgSviPath[] = [];
  for (const ft of fc.features) {
    const props = (ft.properties || {}) as Record<string, unknown>;
    const svi = Number(props.svi);
    const fips = String(props.fips || ft.id || "");
    const [r, g, b] = sviFillRgb(Number.isFinite(svi) ? svi : 0.5);
    const selected = Boolean(selectedFips && fips === selectedFips);
    for (const d of geometryScreenPaths(map, ft.geometry, true)) {
      out.push({
        d,
        fill: `rgb(${r},${g},${b})`,
        opacity: selected ? 0.5 : 0.38 + (Number.isFinite(svi) ? svi * 0.18 : 0),
        fips,
        selected,
      });
    }
  }
  return out;
}

function projectWalkLine(map: MapLibreMap, coords: [number, number][]): SvgWalk | null {
  const pts = coords.slice(0, 120).map(([lon, lat]) => {
    const p = map.project([lon, lat]);
    return { x: p.x, y: p.y };
  });
  if (pts.length < 2 || !pts[0] || !pts[pts.length - 1]) return null;
  return {
    points: pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "),
    start: pts[0],
    end: pts[pts.length - 1],
  };
}

function projectShadeOverlay(map: MapLibreMap, fc: FeatureCollection): SvgLinePath[] {
  const out: SvgLinePath[] = [];
  for (const ft of fc.features) {
    for (const d of geometryScreenPaths(map, ft.geometry, true)) out.push({ d });
  }
  return out;
}

function ringContains(lon: number, lat: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = asLonLat(ring[i]);
    const b = asLonLat(ring[j]);
    if (!a || !b) continue;
    const [xi, yi] = a;
    const [xj, yj] = b;
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function geometryContains(geom: Geometry, lon: number, lat: number): boolean {
  const polygonHit = (rings: Position[][]) => {
    if (!rings[0] || !ringContains(lon, lat, rings[0])) return false;
    for (let i = 1; i < rings.length; i++) {
      if (ringContains(lon, lat, rings[i])) return false;
    }
    return true;
  };
  if (geom.type === "Polygon") return polygonHit(geom.coordinates);
  if (geom.type === "MultiPolygon") return geom.coordinates.some(polygonHit);
  return false;
}

function pickSviFeature(fc: FeatureCollection, lon: number, lat: number): Feature | null {
  for (const ft of fc.features) {
    if (geometryContains(ft.geometry, lon, lat)) return ft;
  }
  return null;
}

function restackOverlayLayers(map: MapLibreMap) {
  // Ground: buildings → heat raster → 3D volume → Esri place names (city labels win).
  // Transportation stays in the style under heat. Overlays stay above places.
  const order = [
    BUILDING_LAYER_ID,
    HEAT_RASTER_ID,
    VOLUME_LAYER_ID,
    PLACES_LAYER_ID,
    SVI_FILL_ID,
    SVI_LINE_ID,
    SVI_HIGHLIGHT_ID,
    CONTOUR_HALO_ID,
    CONTOUR_LINE_ID,
    CONTOUR_LABEL_ID,
  ];
  for (const id of order) {
    if (!map.getLayer(id)) continue;
    try {
      map.moveLayer(id);
    } catch {
      /* layer not movable yet */
    }
  }
}

function sviCollection(svi: SviResponse | null): FeatureCollection {
  if (!svi?.features?.length) return EMPTY_FC;
  return {
    type: "FeatureCollection",
    features: svi.features.map((ft, i) => ({
      ...ft,
      id: ft.properties?.fips || ft.id || i,
    })),
  };
}

function sviFillColor(): ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["coalesce", ["to-number", ["get", "svi"]], 0],
    0,
    "#c7d2fe",
    0.5,
    "#818cf8",
    0.75,
    "#6366f1",
    1,
    "#4c1d95",
  ];
}

function sviFillOpacity(): ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["coalesce", ["to-number", ["get", "svi"]], 0],
    0,
    0.34,
    0.5,
    0.42,
    0.75,
    0.48,
    1,
    0.55,
  ];
}

function syncSviLayers(map: MapLibreMap, fc: FeatureCollection, visible: boolean, selectedFips: string | null) {
  const src = map.getSource(SVI_SOURCE_ID) as { setData?: (data: FeatureCollection) => void } | undefined;
  if (!src) {
    map.addSource(SVI_SOURCE_ID, { type: "geojson", data: fc });
  } else {
    src.setData?.(fc);
  }
  const vis = visible && fc.features.length > 0 ? "visible" : "none";
  const fillColor = sviFillColor();
  const fillOpacity = sviFillOpacity();
  if (!map.getLayer(SVI_FILL_ID)) {
    map.addLayer({
      id: SVI_FILL_ID,
      type: "fill",
      source: SVI_SOURCE_ID,
      paint: {
        "fill-color": fillColor,
        "fill-opacity": fillOpacity,
        "fill-antialias": true,
      },
      layout: { visibility: vis },
    });
  } else {
    map.setLayoutProperty(SVI_FILL_ID, "visibility", vis);
    map.setPaintProperty(SVI_FILL_ID, "fill-color", fillColor);
    map.setPaintProperty(SVI_FILL_ID, "fill-opacity", fillOpacity);
  }
  if (!map.getLayer(SVI_LINE_ID)) {
    map.addLayer({
      id: SVI_LINE_ID,
      type: "line",
      source: SVI_SOURCE_ID,
      paint: {
        "line-color": "#22d3ee",
        "line-width": 2.15,
        "line-opacity": 0.95,
      },
      layout: { visibility: vis },
    });
  } else {
    map.setLayoutProperty(SVI_LINE_ID, "visibility", vis);
    map.setPaintProperty(SVI_LINE_ID, "line-color", "#22d3ee");
    map.setPaintProperty(SVI_LINE_ID, "line-width", 2.15);
    map.setPaintProperty(SVI_LINE_ID, "line-opacity", 0.95);
  }
  if (!map.getLayer(SVI_HIGHLIGHT_ID)) {
    map.addLayer({
      id: SVI_HIGHLIGHT_ID,
      type: "line",
      source: SVI_SOURCE_ID,
      filter: ["==", ["get", "fips"], selectedFips || ""],
      paint: {
        "line-color": "#f5f3ff",
        "line-width": 3.1,
        "line-opacity": 0.98,
      },
      layout: { visibility: vis },
    });
  } else {
    map.setLayoutProperty(SVI_HIGHLIGHT_ID, "visibility", vis);
    map.setFilter(SVI_HIGHLIGHT_ID, ["==", ["get", "fips"], selectedFips || ""]);
    map.setPaintProperty(SVI_HIGHLIGHT_ID, "line-width", 3.1);
  }
  restackOverlayLayers(map);
}

function syncContourLayers(
  map: MapLibreMap,
  lines: FeatureCollection,
  labels: FeatureCollection,
  visible: boolean,
  unit: string,
) {
  const vis = visible && lines.features.length > 0 ? "visible" : "none";
  const lineSrc = map.getSource(CONTOUR_SOURCE_ID) as { setData?: (data: FeatureCollection) => void } | undefined;
  if (!lineSrc) {
    map.addSource(CONTOUR_SOURCE_ID, { type: "geojson", data: lines });
  } else {
    lineSrc.setData?.(lines);
  }
  const labelSrc = map.getSource(CONTOUR_LABEL_SOURCE_ID) as { setData?: (data: FeatureCollection) => void } | undefined;
  if (!labelSrc) {
    map.addSource(CONTOUR_LABEL_SOURCE_ID, { type: "geojson", data: labels });
  } else {
    labelSrc.setData?.(labels);
  }
  if (!map.getLayer(CONTOUR_HALO_ID)) {
    map.addLayer({
      id: CONTOUR_HALO_ID,
      type: "line",
      source: CONTOUR_SOURCE_ID,
      paint: {
        "line-color": "#f8fafc",
        "line-width": 2.1,
        "line-opacity": 0.38,
        "line-blur": 0.2,
      },
      layout: { visibility: vis, "line-join": "round", "line-cap": "round" },
    });
  } else {
    map.setLayoutProperty(CONTOUR_HALO_ID, "visibility", vis);
    map.setPaintProperty(CONTOUR_HALO_ID, "line-color", "#f8fafc");
    map.setPaintProperty(CONTOUR_HALO_ID, "line-width", 2.1);
    map.setPaintProperty(CONTOUR_HALO_ID, "line-opacity", 0.38);
  }
  if (!map.getLayer(CONTOUR_LINE_ID)) {
    map.addLayer({
      id: CONTOUR_LINE_ID,
      type: "line",
      source: CONTOUR_SOURCE_ID,
      paint: {
        "line-color": "#e2e8f0",
        "line-width": 0.95,
        "line-opacity": 0.42,
      },
      layout: { visibility: vis, "line-join": "round", "line-cap": "round" },
    });
  } else {
    map.setLayoutProperty(CONTOUR_LINE_ID, "visibility", vis);
    map.setPaintProperty(CONTOUR_LINE_ID, "line-color", "#e2e8f0");
    map.setPaintProperty(CONTOUR_LINE_ID, "line-width", 0.95);
    map.setPaintProperty(CONTOUR_LINE_ID, "line-opacity", 0.42);
  }
  const textField: ExpressionSpecification = [
    "concat",
    ["number-format", ["get", "value"], { "max-fraction-digits": 2 }],
    unit,
  ];
  if (!map.getLayer(CONTOUR_LABEL_ID)) {
    const labelLayer: SymbolLayerSpecification = {
      id: CONTOUR_LABEL_ID,
      type: "symbol",
      source: CONTOUR_LABEL_SOURCE_ID,
      layout: {
        visibility: vis,
        "text-field": textField,
        "text-size": 11,
        "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "text-optional": true,
        "text-anchor": "center",
      },
      paint: {
        "text-color": "#ecfeff",
        "text-halo-color": "#0f172a",
        "text-halo-width": 1.4,
        "text-halo-blur": 0.15,
        "text-opacity": 0.95,
      },
    };
    map.addLayer(labelLayer);
  } else {
    map.setLayoutProperty(CONTOUR_LABEL_ID, "visibility", vis);
    map.setLayoutProperty(CONTOUR_LABEL_ID, "text-field", textField);
    map.setLayoutProperty(CONTOUR_LABEL_ID, "text-allow-overlap", true);
    map.setLayoutProperty(CONTOUR_LABEL_ID, "text-ignore-placement", true);
  }
  restackOverlayLayers(map);
}

function tractFromProps(props: Record<string, unknown>): SviTract | null {
  const fips = String(props.fips || "");
  const name = String(props.name || "");
  const svi = Number(props.svi);
  if (!fips && !name) return null;
  if (!Number.isFinite(svi)) return null;
  const numOrNull = (v: unknown) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const boolish = (v: unknown) => v === true || v === "true" || v === 1 || v === "1";
  return {
    fips,
    name: name || `Tract ${fips}`,
    location: props.location == null ? null : String(props.location),
    county: props.county == null ? null : String(props.county),
    state: props.state == null ? null : String(props.state),
    svi,
    svi_pct: Number(props.svi_pct) || Math.round(svi * 100),
    theme1: numOrNull(props.theme1),
    theme2: numOrNull(props.theme2),
    theme3: numOrNull(props.theme3),
    theme4: numOrNull(props.theme4),
    mean_c: numOrNull(props.mean_c),
    max_c: numOrNull(props.max_c),
    tile_count: numOrNull(props.tile_count),
    heat_norm: numOrNull(props.heat_norm),
    priority: numOrNull(props.priority),
    high_svi: boolish(props.high_svi),
    in_hottest_third: boolish(props.in_hottest_third),
  };
}

function syncBuildingLayers(map: MapLibreMap, fc: FeatureCollection, visible: boolean) {
  const src = map.getSource(BUILDING_SOURCE_ID) as { setData?: (data: FeatureCollection) => void } | undefined;
  if (!fc.features.length) {
    if (map.getLayer(BUILDING_LAYER_ID)) map.setLayoutProperty(BUILDING_LAYER_ID, "visibility", "none");
    return;
  }
  if (!src) {
    map.addSource(BUILDING_SOURCE_ID, { type: "geojson", data: fc });
  } else {
    src.setData?.(fc);
  }
  if (!map.getLayer(BUILDING_LAYER_ID)) {
    const spec = {
      id: BUILDING_LAYER_ID,
      type: "fill-extrusion" as const,
      source: BUILDING_SOURCE_ID,
      paint: {
        "fill-extrusion-color": "#57534e",
        "fill-extrusion-height": ["coalesce", ["to-number", ["get", "height"]], 9] as ExpressionSpecification,
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.38,
      },
      layout: { visibility: (visible ? "visible" : "none") as "visible" | "none" },
    };
    if (map.getLayer(HEAT_RASTER_ID)) map.addLayer(spec, HEAT_RASTER_ID);
    else map.addLayer(spec);
  } else {
    map.setLayoutProperty(BUILDING_LAYER_ID, "visibility", visible ? "visible" : "none");
  }
}

function boundsKey(bounds: BBox | null): string {
  if (!bounds) return "";
  return bounds.flat().map((n) => n.toFixed(5)).join(":");
}

type HeatMode = "temp" | "hours" | "streak" | "delta" | "delta-edges";

type Interaction = "pan" | "draw" | "orbit";

const ORBIT_PITCH_MIN = 12;
const ORBIT_PITCH_MAX = 72;
const ORBIT_BEARING_SENS = 0.15;
const ORBIT_PITCH_SENS = 0.11;
const ORBIT_DEADZONE = 1.5;
const ORBIT_FOLLOW = 0.34;
const ORBIT_MIN_VEL = 0.045;
const RESET_PITCH = 58;
const RESET_BEARING = -18;

function isMapControlTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(".maplibregl-ctrl, .maplibregl-ctrl-attrib"));
}

function clampOrbitPitch(pitch: number, allowFlat: boolean) {
  const min = allowFlat ? 0 : ORBIT_PITCH_MIN;
  return Math.max(min, Math.min(ORBIT_PITCH_MAX, pitch));
}

function orbitTargetLngLat(aoi: AoiBBox | null, heat: BBox | null, map: MapLibreMap): LngLat {
  if (aoi) {
    const c = bboxCenter(aoi);
    return [c.lon, c.lat];
  }
  if (heat) {
    return [(heat[0][0] + heat[1][0]) / 2, (heat[0][1] + heat[1][1]) / 2];
  }
  const c = map.getCenter();
  return [c.lng, c.lat];
}

function easeOrbit(
  map: MapLibreMap,
  bearing: number,
  pitch: number,
  around: LngLat,
  duration = 0,
  allowFlat = false,
) {
  // jumpTo ignores `around`; easeTo keeps the geographic target on screen.
  map.easeTo({
    bearing,
    pitch: clampOrbitPitch(pitch, allowFlat),
    around,
    duration,
    easing: duration === 0 ? (t) => t : undefined,
    essential: true,
    easeId: "heatcast-orbit",
  });
}

function wantsOrbitDrag(ev: MouseEvent, mode: Interaction, spaceDown: boolean) {
  if (isMapControlTarget(ev.target)) return false;
  const chord = ev.ctrlKey || ev.metaKey;
  if (mode === "draw") return ev.button === 2;
  if (ev.button === 2) return true;
  if (ev.button !== 0) return false;
  if (mode === "orbit") return !spaceDown;
  return chord;
}

type Props = {
  longitude: number;
  latitude: number;
  zoom: number;
  pitched: boolean;
  volume: boolean;
  interaction: Interaction;
  aoi: AoiBBox | null;
  analysis: AnalyzeResponse | null;
  buildings: BuildingsResponse | null;
  svi?: SviResponse | null;
  sviVisible?: boolean;
  selectedSviFips?: string | null;
  overlayDeltaC?: number;
  resetViewTick?: number;
  flattenTick?: number;
  contoursVisible?: boolean;
  shadeVisible?: boolean;
  shadeFc?: FeatureCollection | null;
  coolingVisible?: boolean;
  coolingSites?: CoolingSite[];
  walkCoords?: [number, number][] | null;
  walkVisible?: boolean;
  walkDest?: CoolingSite | null;
  plantedTrees?: Array<{ lon: number; lat: number }>;
  plantMode?: boolean;
  panelOpen?: boolean;
  showDeltaLayers?: boolean;
  onAoiChange?: (bbox: AoiBBox) => void;
  onMapClick?: (pt: { lon: number; lat: number }) => void;
  onSviSelect?: (tract: SviTract | null) => void;
};

export default function HeatMap({
  longitude,
  latitude,
  zoom,
  pitched,
  volume,
  interaction,
  aoi,
  analysis,
  buildings,
  svi = null,
  sviVisible = true,
  selectedSviFips = null,
  overlayDeltaC = 0,
  resetViewTick = 0,
  flattenTick = 0,
  contoursVisible = true,
  shadeVisible = true,
  shadeFc = null,
  coolingVisible = true,
  coolingSites = [],
  walkCoords = null,
  walkVisible = true,
  walkDest = null,
  plantedTrees = [],
  plantMode = false,
  panelOpen = true,
  showDeltaLayers = false,
  onAoiChange,
  onMapClick,
  onSviSelect,
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const mapLibreRef = useRef<MapLibreMap | null>(null);
  const heatRef = useRef<FeatureCollection>(EMPTY_FC);
  const rasterCacheRef = useRef<RasterCache | null>(null);
  const loggedRasterKey = useRef("");
  const fittedKey = useRef("");
  const [useEsri, setUseEsri] = useState(!CARTO_API_KEY);
  const [styleReady, setStyleReady] = useState(0);
  const [heatMode, setHeatMode] = useState<HeatMode>("temp");
  const [gpuReset, setGpuReset] = useState(false);
  const [draftAoi, setDraftAoi] = useState<AoiBBox | null>(null);
  const [boxPx, setBoxPx] = useState<{ points: string; label: { x: number; y: number } } | null>(null);
  const [overlaySvg, setOverlaySvg] = useState<{
    svi: SvgSviPath[];
    contours: SvgLinePath[];
    shade: SvgLinePath[];
    walk: SvgWalk | null;
    amenityShift: string[];
  }>({
    svi: [],
    contours: [],
    shade: [],
    walk: null,
    amenityShift: [],
  });
  const shadeFcRef = useRef<FeatureCollection>(EMPTY_FC);
  shadeFcRef.current = shadeFc ?? EMPTY_FC;
  const walkCoordsRef = useRef<[number, number][] | null>(null);
  walkCoordsRef.current = walkVisible ? walkCoords : null;
  const coolingSitesRef = useRef(coolingSites);
  coolingSitesRef.current = coolingSites;
  const hotspotRef = useRef(analysis?.hotspot);
  const coolingVisibleRef = useRef(coolingVisible);
  coolingVisibleRef.current = coolingVisible;
  const plantModeRef = useRef(plantMode);
  plantModeRef.current = plantMode;
  const [sviPopup, setSviPopup] = useState<{
    lon: number;
    lat: number;
    x: number;
    y: number;
    name: string;
    sviPct: number;
    meanC: number | null;
  } | null>(null);
  const visibleAoi = draftAoi ?? aoi;

  useEffect(() => {
    const map = mapLibreRef.current;
    if (!map || !styleReady) return;
    const update = () => {
      const box = draftAoi ?? aoi;
      setBoxPx(box ? boxQuad(map, box) : null);
      const hot = hotspotRef.current;
      const amenityShift: string[] = [];
      if (hot && coolingVisibleRef.current) {
        const hp = map.project([hot.lon, hot.lat]);
        for (const site of coolingSitesRef.current) {
          const p = map.project([site.lon, site.lat]);
          if (Math.hypot(p.x - hp.x, p.y - hp.y) < 40) amenityShift.push(amenityKey(site));
        }
      }
      setOverlaySvg({
        shade:
          shadeVisible && shadeFcRef.current.features.length
            ? projectShadeOverlay(map, shadeFcRef.current)
            : [],
        svi: sviVisible && sviFcRef.current.features.length ? projectSviOverlay(map, sviFcRef.current, selectedSviFipsRef.current) : [],
        contours: [],
        walk: walkCoordsRef.current?.length ? projectWalkLine(map, walkCoordsRef.current) : null,
        amenityShift,
      });
    };
    update();
    map.on("move", update);
    map.on("resize", update);
    return () => {
      map.off("move", update);
      map.off("resize", update);
    };
  }, [styleReady, aoi, draftAoi, sviVisible, svi, selectedSviFips, shadeVisible, shadeFc, walkCoords, walkVisible, coolingSites, coolingVisible, analysis?.hotspot]);

  useEffect(() => {
    if (!sviVisible) setSviPopup(null);
  }, [sviVisible]);

  useEffect(() => {
    const map = mapLibreRef.current;
    if (!map || !styleReady || !sviPopup) return;
    const update = () => {
      const p = map.project([sviPopup.lon, sviPopup.lat]);
      setSviPopup((cur) => (cur ? { ...cur, x: p.x, y: p.y } : cur));
    };
    map.on("move", update);
    map.on("resize", update);
    return () => {
      map.off("move", update);
      map.off("resize", update);
    };
  }, [styleReady, sviPopup?.lon, sviPopup?.lat]);
  const interactionRef = useRef(interaction);
  interactionRef.current = interaction;
  const onAoiRef = useRef(onAoiChange);
  onAoiRef.current = onAoiChange;
  const onSviSelectRef = useRef(onSviSelect);
  onSviSelectRef.current = onSviSelect;
  const sviVisibleRef = useRef(sviVisible);
  sviVisibleRef.current = sviVisible;
  const sviFcRef = useRef<FeatureCollection>(EMPTY_FC);
  const selectedSviFipsRef = useRef(selectedSviFips);
  selectedSviFipsRef.current = selectedSviFips;
  const visibleAoiRef = useRef(visibleAoi);
  visibleAoiRef.current = visibleAoi;
  const orbitingRef = useRef(false);
  const flattenLockRef = useRef(false);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const contoursVisibleRef = useRef(contoursVisible);
  contoursVisibleRef.current = contoursVisible;
  const suppressClickRef = useRef(false);
  const resetTickSeen = useRef(0);
  const hotspot = analysis?.hotspot;
  hotspotRef.current = hotspot;

  const mapStyle = useMemo(() => rasterStyle(useEsri), [useEsri]);

  const tcmHeat = useMemo(() => asCollection(analysis?.heatmap), [analysis]);
  const hoursHeat = useMemo(() => asCollection(analysis?.exceedance?.heatmap), [analysis]);
  const streakHeat = useMemo(() => asCollection(analysis?.persistence?.heatmap), [analysis]);
  const deltaHeat = useMemo(() => asCollection(analysis?.delta?.heatmap), [analysis]);
  const hasHours = hoursHeat.features.length > 0;
  const hasStreak = streakHeat.features.length > 0;
  const hasDelta = showDeltaLayers && deltaHeat.features.length > 0;
  const edgesHeat = useMemo(() => {
    if (!deltaHeat.features.length) return EMPTY_FC;
    return {
      type: "FeatureCollection" as const,
      features: deltaHeat.features.map((ft) => {
        const g = numProp(ft.properties as Record<string, unknown>, ["grad"]);
        return { ...ft, properties: { ...ft.properties, temperature: g } };
      }),
    };
  }, [deltaHeat]);

  useEffect(() => {
    if (hasDelta) return;
    setHeatMode((mode) => (mode === "delta" || mode === "delta-edges" ? "temp" : mode));
  }, [hasDelta]);

  const activeHeat =
    heatMode === "hours" && hasHours
      ? hoursHeat
      : heatMode === "streak" && hasStreak
        ? streakHeat
        : heatMode === "delta" && hasDelta
          ? deltaHeat
          : heatMode === "delta-edges" && hasDelta
            ? edgesHeat
            : tcmHeat;
  const overlayHeat = useMemo(() => {
    if (!overlayDeltaC || !tcmHeat.features.length) return EMPTY_FC;
    return {
      type: "FeatureCollection" as const,
      features: tcmHeat.features.map((ft) => {
        const temp = numProp(ft.properties as Record<string, unknown>, TEMP_KEYS);
        const next = temp == null ? temp : Math.round((temp - overlayDeltaC) * 100) / 100;
        return {
          ...ft,
          properties: { ...ft.properties, measured_c: temp, temperature: next, overlay: true },
        };
      }),
    };
  }, [tcmHeat, overlayDeltaC]);

  const displayHeat = heatMode === "temp" && overlayDeltaC ? overlayHeat : activeHeat;
  const hoursMode = (heatMode === "hours" && hasHours) || (heatMode === "streak" && hasStreak);
  const deltaMode = heatMode === "delta" && hasDelta;
  const edgesMode = heatMode === "delta-edges" && hasDelta;
  const heatRamp = deltaMode ? DIVERGING_RAMP : RAMP;
  const valueKey: "temperature" | "hours" = hoursMode ? "hours" : "temperature";
  const domain = useMemo(
    () => (deltaMode ? divergingDomain(displayHeat) : domainOf(displayHeat, valueKey)),
    [displayHeat, valueKey, deltaMode],
  );
  const heatBounds = useMemo(() => boundsOf(displayHeat), [displayHeat]);
  heatRef.current = displayHeat;
  const heatBoundsRef = useRef(heatBounds);
  heatBoundsRef.current = heatBounds;
  const isolines = useMemo(
    () => buildIsolines(displayHeat, heatBounds, valueKey, domain),
    [displayHeat, heatBounds, valueKey, domain],
  );
  const isolinesRef = useRef(isolines);
  isolinesRef.current = isolines;
  const contourUnit = hoursMode ? " h" : "°";

  const buildingFc = useMemo(() => {
    if (!buildings?.features?.length) return EMPTY_FC;
    return {
      type: "FeatureCollection" as const,
      features: buildings.features.slice(0, MAX_BUILDINGS),
    };
  }, [buildings]);
  const sviFc = useMemo(() => sviCollection(svi), [svi]);
  sviFcRef.current = sviFc;

  const viewKey = useRef(`${longitude.toFixed(4)}:${latitude.toFixed(4)}:${zoom.toFixed(2)}`);
  const spaceHeld = useRef(false);

  const logRasterOnce = useCallback((payload: Record<string, unknown>) => {
    const key = `${payload.features}:${JSON.stringify(payload.bbox)}:${JSON.stringify(payload.imageSize)}`;
    if (loggedRasterKey.current === key) return;
    loggedRasterKey.current = key;
    console.log("[HeatMap] raster", payload);
  }, []);

  const buildRaster = useCallback((): RasterCache | null => {
    const fc = heatRef.current;
    const bounds = boundsOf(fc);
    if (!fc.features.length || !bounds || !domain) {
      rasterCacheRef.current = null;
      return null;
    }
    const padded = padBounds(bounds);
    const key = `${fc.features.length}:${valueKey}:${heatMode}:${domain.min.toFixed(4)}:${domain.max.toFixed(4)}:${boundsKey(padded)}:${overlayDeltaC}:${contoursVisible ? isolines.lines.features.length : 0}`;
    const prev = rasterCacheRef.current;
    if (prev?.key === key) return prev;
    const iso = contoursVisible ? isolines.lines : EMPTY_FC;
    const { canvas, width, height } = rasterizeHeat(fc, padded, valueKey, domain, prev?.image ?? null, iso, heatRamp);
    const next: RasterCache = {
      key,
      image: canvas,
      coordinates: cornersOf(padded),
      width,
      height,
      featureCount: fc.features.length,
      bbox: padded,
    };
    rasterCacheRef.current = next;
    return next;
  }, [domain, overlayDeltaC, valueKey, displayHeat, isolines, contoursVisible, heatRamp, heatMode]);

  const fitToHeat = useCallback(
    (map: MapLibreMap) => {
      const bounds = heatBounds;
      const key = boundsKey(bounds);
      if (!bounds || !key) return;
      if (fittedKey.current === key) return;
      fittedKey.current = key;
      map.fitBounds(bounds, {
        padding: 56,
        duration: 700,
        maxZoom: 16,
      });
    },
    [heatBounds],
  );

  useEffect(() => {
    const map = mapLibreRef.current ?? mapRef.current?.getMap() ?? null;
    if (!map || !styleReady) return;
    try {
      const cache = buildRaster();
      syncBuildingLayers(map, buildingFc, volume);
      applyHeatRaster(map, cache, logRasterOnce, sviVisible ? 0.55 : RASTER_OPACITY);
      syncSviLayers(map, sviFc, sviVisible, selectedSviFips);
      syncContourLayers(
        map,
        isolines.lines,
        isolines.labels,
        contoursVisible && isolines.lines.features.length > 0,
        contourUnit,
      );
      const volumeOn = Boolean(volume && displayHeat.features.length > 0 && displayHeat.features.length <= 900);
      syncVolumeLayers(
        map,
        volumeOn && domain ? volumeFeatures(displayHeat, valueKey, domain, heatRamp) : EMPTY_FC,
        volumeOn,
      );
      restackOverlayLayers(map);
    } catch (err) {
      console.warn("[HeatMap] layer sync failed", err);
    }
  }, [displayHeat, buildingFc, sviFc, sviVisible, selectedSviFips, pitched, volume, valueKey, domain, buildRaster, styleReady, logRasterOnce, isolines, contoursVisible, contourUnit, heatRamp]);

  useEffect(() => {
    const map = mapLibreRef.current ?? mapRef.current?.getMap() ?? null;
    if (!map || !styleReady) return;
    if (!displayHeat.features.length) return;
    fitToHeat(map);
  }, [displayHeat.features.length, fitToHeat, styleReady]);

  useEffect(() => {
    const map = mapLibreRef.current ?? mapRef.current?.getMap() ?? null;
    if (!map || !styleReady) return;
    const key = `${longitude.toFixed(4)}:${latitude.toFixed(4)}:${zoom.toFixed(2)}`;
    if (viewKey.current === key) return;
    viewKey.current = key;
    map.flyTo({ center: [longitude, latitude], zoom, duration: 700 });
  }, [longitude, latitude, zoom, styleReady]);

  useEffect(() => {
    const map = mapLibreRef.current ?? mapRef.current?.getMap() ?? null;
    if (!map || !styleReady) return;
    const around = orbitTargetLngLat(visibleAoiRef.current, heatBoundsRef.current, map);
    map.stop();
    if (volume) {
      flattenLockRef.current = false;
      if (orbitingRef.current) return;
      const bearing = Math.abs(map.getBearing()) < 1 ? RESET_BEARING : map.getBearing();
      map.easeTo({
        pitch: Math.max(map.getPitch(), RESET_PITCH),
        bearing,
        around,
        duration: 480,
        essential: true,
      });
      return;
    }
    flattenLockRef.current = true;
    orbitingRef.current = false;
    map.easeTo({
      pitch: 0,
      around,
      duration: 420,
      essential: true,
    });
  }, [volume, flattenTick, styleReady]);

  useEffect(() => {
    const map = mapLibreRef.current;
    if (!map || !styleReady || !sviVisible || !map.getLayer(SVI_FILL_ID)) return;
    const el = map.getCanvasContainer();
    const onEnter = () => {
      if (interactionRef.current === "draw") return;
      el.style.cursor = "pointer";
    };
    const onLeave = () => {
      el.style.cursor =
        interactionRef.current === "draw" ? "crosshair" : interactionRef.current === "orbit" ? "grab" : "";
    };
    map.on("mouseenter", SVI_FILL_ID, onEnter);
    map.on("mouseleave", SVI_FILL_ID, onLeave);
    return () => {
      map.off("mouseenter", SVI_FILL_ID, onEnter);
      map.off("mouseleave", SVI_FILL_ID, onLeave);
    };
  }, [styleReady, sviVisible, sviFc.features.length]);

  useEffect(() => {
    const map = mapLibreRef.current;
    if (!map || !styleReady) return;

    const canvas = map.getCanvas();
    const onLost = (ev: Event) => {
      ev.preventDefault();
      setGpuReset(true);
      console.warn("[HeatMap] webglcontextlost — restoring");
    };
    const onRestored = () => {
      setGpuReset(false);
      try {
        applyHeatRaster(map, rasterCacheRef.current, logRasterOnce);
        syncSviLayers(map, sviFcRef.current, sviVisibleRef.current, selectedSviFipsRef.current);
        const iso = isolinesRef.current;
        syncContourLayers(
          map,
          iso.lines,
          iso.labels,
          contoursVisibleRef.current && iso.lines.features.length > 0,
          "°",
        );
        restackOverlayLayers(map);
      } catch (err) {
        console.warn("[HeatMap] restore sync failed", err);
      }
    };
    const onStyleData = () => {
      const needHeat = Boolean(rasterCacheRef.current) && !map.getLayer(HEAT_RASTER_ID);
      const needSvi =
        sviVisibleRef.current && sviFcRef.current.features.length > 0 && !map.getLayer(SVI_FILL_ID);
      const needContours =
        contoursVisibleRef.current &&
        isolinesRef.current.lines.features.length > 0 &&
        !map.getLayer(CONTOUR_LINE_ID);
      if (!needHeat && !needSvi && !needContours) return;
      try {
        if (rasterCacheRef.current) applyHeatRaster(map, rasterCacheRef.current, logRasterOnce);
        syncSviLayers(map, sviFcRef.current, sviVisibleRef.current, selectedSviFipsRef.current);
        const iso = isolinesRef.current;
        syncContourLayers(
          map,
          iso.lines,
          iso.labels,
          contoursVisibleRef.current && iso.lines.features.length > 0,
          "°",
        );
        restackOverlayLayers(map);
      } catch (err) {
        console.warn("[HeatMap] restyle sync failed", err);
      }
    };

    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    map.on("styledata", onStyleData);

    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      map.off("styledata", onStyleData);
    };
  }, [styleReady, logRasterOnce]);

  useEffect(() => {
    const map = mapLibreRef.current;
    if (!map || !styleReady) return;

    const enableZoom = () => {
      map.scrollZoom.enable();
      map.touchZoomRotate.enable();
      map.keyboard.enable();
    };
    enableZoom();

    const isControl = (target: EventTarget | null) => isMapControlTarget(target);

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.code !== "Space" || ev.repeat) return;
      ev.preventDefault();
      spaceHeld.current = true;
      map.dragPan.enable();
      map.getCanvasContainer().style.cursor = "grab";
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.code !== "Space") return;
      spaceHeld.current = false;
      if (interactionRef.current === "draw" || interactionRef.current === "orbit") {
        map.dragPan.disable();
      }
      map.getCanvasContainer().style.cursor =
        interactionRef.current === "draw" ? "crosshair" : interactionRef.current === "orbit" ? "grab" : "";
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    if (interaction === "draw") {
      map.dragPan.disable();
      map.dragRotate.disable();
      map.boxZoom.disable();
      map.doubleClickZoom.disable();
      map.getCanvasContainer().style.cursor = "crosshair";
    } else if (interaction === "orbit") {
      map.dragPan.disable();
      map.dragRotate.disable();
      map.boxZoom.disable();
      map.getCanvasContainer().style.cursor = "grab";
    } else {
      map.dragPan.enable();
      map.dragRotate.disable();
      map.boxZoom.enable();
      map.doubleClickZoom.enable();
      map.getCanvasContainer().style.cursor = "";
    }

    const onDrawDown = (e: MapMouseEvent) => {
      if (interactionRef.current !== "draw") return;
      if (e.originalEvent.button !== 0) return;
      if (spaceHeld.current) return;
      if (isControl(e.originalEvent.target)) return;
      e.originalEvent.preventDefault();
      map.dragPan.disable();
      const origin = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      const canvas = map.getCanvas();
      const onMove = (move: MouseEvent) => {
        const r = canvas.getBoundingClientRect();
        const ll = map.unproject([move.clientX - r.left, move.clientY - r.top]);
        setDraftAoi(normalizeBBox([origin.lng, origin.lat, ll.lng, ll.lat]));
      };
      const onUp = (up: MouseEvent) => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        const r = canvas.getBoundingClientRect();
        const ll = map.unproject([up.clientX - r.left, up.clientY - r.top]);
        const raw = normalizeBBox([origin.lng, origin.lat, ll.lng, ll.lat]);
        setDraftAoi(null);
        enableZoom();
        if (areaMi2(raw) < 0.02) return;
        const box = shrinkToMax(raw);
        onAoiRef.current?.(box);
        map.fitBounds(
          [
            [box[0], box[1]],
            [box[2], box[3]],
          ],
          { padding: 72, duration: 450, maxZoom: 16 },
        );
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };

    map.on("mousedown", onDrawDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      map.off("mousedown", onDrawDown);
      map.dragPan.enable();
      map.dragRotate.disable();
      map.boxZoom.enable();
      map.doubleClickZoom.enable();
      map.getCanvasContainer().style.cursor = "";
    };
  }, [styleReady, interaction]);

  useEffect(() => {
    const map = mapLibreRef.current;
    if (!map || !styleReady) return;

    const el = map.getCanvasContainer();
    let mode: "orbit" | "pan" | null = null;
    let last = { x: 0, y: 0 };
    let pendingB = 0;
    let pendingP = 0;
    let raf = 0;

    const aroundNow = () => orbitTargetLngLat(visibleAoiRef.current, heatBoundsRef.current, map);

    const stopRaf = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const tick = () => {
      raf = 0;
      if (flattenLockRef.current) {
        pendingB = 0;
        pendingP = 0;
        return;
      }
      const applyB = pendingB * ORBIT_FOLLOW;
      const applyP = pendingP * ORBIT_FOLLOW;
      pendingB -= applyB;
      pendingP -= applyP;
      if (Math.abs(applyB) > 0.008 || Math.abs(applyP) > 0.008) {
        easeOrbit(
          map,
          map.getBearing() + applyB,
          map.getPitch() + applyP,
          aroundNow(),
          0,
          !volumeRef.current,
        );
      }
      if (Math.abs(pendingB) > ORBIT_MIN_VEL || Math.abs(pendingP) > ORBIT_MIN_VEL) {
        raf = requestAnimationFrame(tick);
      }
    };

    const ensureTick = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const onDown = (ev: MouseEvent) => {
      if (isMapControlTarget(ev.target)) return;
      if (ev.button === 1) {
        ev.preventDefault();
        pendingB = 0;
        pendingP = 0;
        stopRaf();
        map.stop();
        mode = "pan";
        last = { x: ev.clientX, y: ev.clientY };
        el.style.cursor = "grabbing";
        return;
      }
      if (!wantsOrbitDrag(ev, interactionRef.current, spaceHeld.current)) return;
      ev.preventDefault();
      map.stop();
      flattenLockRef.current = false;
      orbitingRef.current = true;
      suppressClickRef.current = false;
      mode = "orbit";
      last = { x: ev.clientX, y: ev.clientY };
      pendingB = 0;
      pendingP = 0;
      el.style.cursor = "grabbing";
    };

    const onMove = (ev: MouseEvent) => {
      if (!mode) return;
      const dx = ev.clientX - last.x;
      const dy = ev.clientY - last.y;
      last = { x: ev.clientX, y: ev.clientY };
      if (mode === "pan") {
        map.panBy([-dx, -dy], { duration: 0 });
        return;
      }
      if (Math.hypot(dx, dy) < ORBIT_DEADZONE) return;
      suppressClickRef.current = true;
      pendingB += dx * ORBIT_BEARING_SENS;
      pendingP += -dy * ORBIT_PITCH_SENS;
      ensureTick();
    };

    const onUp = () => {
      if (!mode) return;
      const wasOrbit = mode === "orbit";
      mode = null;
      orbitingRef.current = false;
      el.style.cursor = interactionRef.current === "orbit" ? "grab" : interactionRef.current === "draw" ? "crosshair" : "";
      if (wasOrbit) {
        pendingB *= 1.85;
        pendingP *= 1.85;
        ensureTick();
      }
    };

    const onContextMenu = (ev: MouseEvent) => {
      if (isMapControlTarget(ev.target)) return;
      ev.preventDefault();
    };

    const onAuxClick = (ev: MouseEvent) => {
      if (ev.button === 1) ev.preventDefault();
    };

    el.addEventListener("mousedown", onDown);
    el.addEventListener("contextmenu", onContextMenu);
    el.addEventListener("auxclick", onAuxClick);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      stopRaf();
      orbitingRef.current = false;
      el.removeEventListener("mousedown", onDown);
      el.removeEventListener("contextmenu", onContextMenu);
      el.removeEventListener("auxclick", onAuxClick);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [styleReady]);

  useEffect(() => {
    if (!resetViewTick) return;
    const map = mapLibreRef.current;
    if (!map || !styleReady) return;
    if (resetTickSeen.current === resetViewTick) return;
    resetTickSeen.current = resetViewTick;
    const aoiBox = visibleAoiRef.current;
    const hb = heatBoundsRef.current;
    const wantPitch = volume ? RESET_PITCH : 0;
    const wantBearing = volume ? RESET_BEARING : 0;
    if (!volume) {
      flattenLockRef.current = true;
      orbitingRef.current = false;
    }
    map.stop();
    if (aoiBox) {
      const [west, south, east, north] = normalizeBBox(aoiBox);
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        {
          padding: 64,
          duration: 700,
          maxZoom: 16,
          pitch: wantPitch,
          bearing: wantBearing,
          linear: true,
        },
      );
      return;
    }
    if (hb) {
      map.fitBounds(hb, {
        padding: 64,
        duration: 700,
        maxZoom: 16,
        pitch: wantPitch,
        bearing: wantBearing,
        linear: true,
      });
      return;
    }
    map.easeTo({
      pitch: wantPitch,
      bearing: wantBearing,
      around: orbitTargetLngLat(null, null, map),
      duration: 600,
      essential: true,
    });
  }, [resetViewTick, styleReady, volume]);

  const onMapError = useCallback(
    (e: { error?: Error; sourceId?: string }) => {
      const msg = e.error?.message ?? String(e.error ?? e);
      console.warn("[HeatMap] map error", msg);
      const cartoFailed = e.sourceId === "basemap" || e.sourceId === "carto" || /cartocdn|basemaps\.carto/i.test(msg);
      if (!useEsri && cartoFailed) setUseEsri(true);
    },
    [useEsri],
  );

  const legendMin = domain?.min;
  const legendMax = domain?.max;
  const unit = hoursMode ? "h" : "°C";
  const deltaHour = analysis?.delta?.hour ?? "";
  const deltaFrom = analysis?.delta?.start_date ?? "";
  const deltaTo = analysis?.delta?.end_date ?? "";
  const legendTitle =
    heatMode === "hours" && hasHours
      ? "Hours above threshold"
      : heatMode === "streak" && hasStreak
        ? "Longest hot streak"
        : deltaMode
          ? `Change at ${deltaHour}, ${deltaFrom} → ${deltaTo}`
          : edgesMode
            ? "Where change is uneven (100 m, noisy)"
            : "Air temperature";
  const legendRamp = deltaMode
    ? "linear-gradient(to right, #2563eb, #f8fafc, #dc2626)"
    : "linear-gradient(to right, #5b21b6, #2563eb, #f97316, #fbbf24, #fef08a)";
  const isoDigits = legendMin != null && legendMax != null && legendMax - legendMin < 1 ? 2 : 1;

  return (
    <div className={`absolute inset-0 ${panelOpen ? "lg:[&_.maplibregl-ctrl-top-right]:right-[22.5rem]" : ""}`}>
      <Map
        ref={mapRef}
        initialViewState={{
          longitude,
          latitude,
          zoom,
          pitch: pitched ? 55 : 0,
          bearing: pitched ? -18 : 0,
        }}
        maxPitch={85}
        scrollZoom
        keyboard
        boxZoom={interaction === "pan"}
        doubleClickZoom={interaction === "pan"}
        dragPan={interaction === "pan"}
        dragRotate={false}
        touchZoomRotate
        touchPitch={interaction !== "draw"}
        mapStyle={mapStyle}
        style={{ width: "100%", height: "100%", background: "#0b0d10" }}
        onLoad={(e) => {
          const map = mapFromLoadEvent(e) ?? mapRef.current?.getMap() ?? null;
          if (!map) {
            console.warn("[HeatMap] onLoad: no MapLibre instance");
            return;
          }
          mapLibreRef.current = map;
          try {
            applyHeatRaster(map, buildRaster(), logRasterOnce);
          } catch (err) {
            console.warn("[HeatMap] onLoad sync failed", err);
          }
          setStyleReady((n) => n + 1);
        }}
        onClick={(e) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          const map = mapLibreRef.current;
          if (plantModeRef.current) {
            setSviPopup(null);
            onSviSelectRef.current?.(null);
            onMapClick?.({ lon: e.lngLat.lng, lat: e.lngLat.lat });
            return;
          }
          if (map && sviVisibleRef.current && interactionRef.current !== "draw") {
            let tract: SviTract | null = null;
            if (map.getLayer(SVI_FILL_ID)) {
              const hit = map.queryRenderedFeatures(e.point, { layers: [SVI_FILL_ID] })[0];
              if (hit?.properties) tract = tractFromProps(hit.properties as Record<string, unknown>);
            }
            if (!tract) {
              const ft = pickSviFeature(sviFcRef.current, e.lngLat.lng, e.lngLat.lat);
              if (ft?.properties) tract = tractFromProps(ft.properties as Record<string, unknown>);
            }
            if (tract) {
              setSviPopup({
                lon: e.lngLat.lng,
                lat: e.lngLat.lat,
                x: e.point.x,
                y: e.point.y,
                name: tract.name,
                sviPct: tract.svi_pct,
                meanC: tract.mean_c ?? null,
              });
              onSviSelectRef.current?.(tract);
              return;
            }
          }
          setSviPopup(null);
          onSviSelectRef.current?.(null);
          onMapClick?.({ lon: e.lngLat.lng, lat: e.lngLat.lat });
        }}
        onError={onMapError}
      >
        {hotspot && hotspot.temperature_c != null && (
          <Marker longitude={hotspot.lon} latitude={hotspot.lat} anchor="center" style={{ zIndex: 24 }}>
            <div className="pointer-events-none rounded-full border border-cyan-200/40 bg-rose-700/95 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
              {hotspot.temperature_c.toFixed(1)}°C
            </div>
          </Marker>
        )}
        {coolingVisible &&
          coolingSites.map((site) => {
            const dest =
              walkDest &&
              Math.abs(walkDest.lon - site.lon) < 1e-5 &&
              Math.abs(walkDest.lat - site.lat) < 1e-5;
            const sports = isSportsCentre(site);
            const nudged = overlaySvg.amenityShift.includes(amenityKey(site));
            const title = `${site.name} · ${site.kind}${dest ? " · walk destination" : ""}`;
            return (
              <Marker
                key={amenityKey(site)}
                longitude={site.lon}
                latitude={site.lat}
                anchor="center"
                style={{ zIndex: dest ? 12 : sports ? 4 : 8 }}
              >
                <div
                  title={title}
                  className={`flex flex-col items-center ${sports ? "opacity-45" : ""}`}
                  style={nudged ? { marginTop: 12 } : undefined}
                >
                  {dest && !nudged && (
                    <span className="mb-0.5 max-w-[7.5rem] truncate rounded-md border border-cyan-100 bg-cyan-300 px-1.5 py-0.5 text-[9px] font-semibold text-[#0b0d10] shadow">
                      {site.name}
                    </span>
                  )}
                  <span
                    className={`block rounded-full border shadow ${
                      dest
                        ? "h-3 w-3 border-cyan-100 bg-cyan-300"
                        : sports
                          ? "h-2 w-2 border-teal-700/50 bg-teal-800"
                          : "h-2.5 w-2.5 border-teal-200/50 bg-teal-500"
                    }`}
                  />
                </div>
              </Marker>
            );
          })}
        {plantedTrees.map((tree, i) => (
          <Marker key={`tree-${i}-${tree.lon.toFixed(5)}-${tree.lat.toFixed(5)}`} longitude={tree.lon} latitude={tree.lat} anchor="bottom">
            <div className="pointer-events-none flex flex-col items-center" title="Scenario tree">
              <span className="h-3.5 w-3.5 rounded-full border border-lime-200/70 bg-lime-500 shadow" />
              <span className="h-2 w-0.5 bg-lime-800/90" />
            </div>
          </Marker>
        ))}
        <NavigationControl position="top-right" visualizePitch showCompass={false} />
      </Map>
      {sviPopup && (
        <div
          className="pointer-events-none absolute z-[8] w-44 -translate-x-1/2 -translate-y-full rounded-md border border-indigo-300/25 bg-[#161a20]/94 px-2.5 py-1.5 text-[11px] text-slate-100 shadow"
          style={{ left: sviPopup.x, top: sviPopup.y - 8 }}
        >
          <p className="font-medium leading-snug text-indigo-100">{sviPopup.name}</p>
          <p className="mt-0.5 font-mono text-[10px] text-slate-300">
            SVI {sviPopup.sviPct}
            {sviPopup.meanC != null ? ` · ${sviPopup.meanC.toFixed(1)}°C` : ""}
          </p>
        </div>
      )}
      {(boxPx || overlaySvg.svi.length > 0 || overlaySvg.shade.length > 0 || overlaySvg.walk) && (
        <svg className="pointer-events-none absolute inset-0 z-[7] h-full w-full overflow-visible">
          {overlaySvg.svi.map((path, i) => (
            <path
              key={`${path.fips}-${i}`}
              d={path.d}
              fill={path.fill}
              fillOpacity={path.opacity}
              stroke={path.selected ? "#f8fafc" : "#67e8f9"}
              strokeWidth={path.selected ? 3 : 2.4}
              strokeLinejoin="round"
            />
          ))}
          {overlaySvg.shade.map((path, i) => (
            <path
              key={`sh-${i}`}
              d={path.d}
              fill="rgba(2, 8, 20, 0.58)"
              stroke="rgba(148, 163, 184, 0.4)"
              strokeWidth="0.7"
            />
          ))}
          {overlaySvg.walk && (
            <g>
              <polyline
                points={overlaySvg.walk.points}
                fill="none"
                stroke="#042f2e"
                strokeWidth="6.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.55"
              />
              <polyline
                points={overlaySvg.walk.points}
                fill="none"
                stroke="#5eead4"
                strokeWidth="3.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="9 6"
              />
              <circle
                cx={overlaySvg.walk.start.x}
                cy={overlaySvg.walk.start.y}
                r="4.8"
                fill="#fb7185"
                stroke="#fff"
                strokeWidth="1.4"
              />
              <circle
                cx={overlaySvg.walk.end.x}
                cy={overlaySvg.walk.end.y}
                r="5.4"
                fill="#5eead4"
                stroke="#042f2e"
                strokeWidth="1.6"
              />
            </g>
          )}
          {boxPx && (
            <polygon
              points={boxPx.points}
              fill="rgba(61, 214, 198, 0.06)"
              stroke="#5eead4"
              strokeWidth="2.25"
              strokeLinejoin="round"
            />
          )}
        </svg>
      )}
      {gpuReset && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-md border border-cyan-700/40 bg-[#161a20]/92 px-3 py-1.5 text-[11px] text-cyan-100 shadow">
          Map GPU reset — restoring…
        </div>
      )}
      {(hasHours || hasStreak || hasDelta) && (
        <div className="absolute left-4 top-4 z-10 flex max-w-[28rem] flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setHeatMode("temp")}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
              heatMode === "temp" ? "bg-cyan-400 text-[#0b0d10]" : "bg-[#161a20]/80 text-slate-200"
            }`}
          >
            Air temperature
          </button>
          {hasHours && (
            <button
              type="button"
              onClick={() => setHeatMode("hours")}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
                heatMode === "hours" ? "bg-cyan-400 text-[#0b0d10]" : "bg-[#161a20]/80 text-slate-200"
              }`}
            >
              Hours above
            </button>
          )}
          {hasStreak && (
            <button
              type="button"
              onClick={() => setHeatMode("streak")}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
                heatMode === "streak" ? "bg-cyan-400 text-[#0b0d10]" : "bg-[#161a20]/80 text-slate-200"
              }`}
            >
              Longest streak
            </button>
          )}
          {hasDelta && (
            <button
              type="button"
              onClick={() => setHeatMode("delta")}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
                heatMode === "delta" ? "bg-cyan-400 text-[#0b0d10]" : "bg-[#161a20]/80 text-slate-200"
              }`}
            >
              ΔT (range)
            </button>
          )}
          {hasDelta && (
            <button
              type="button"
              onClick={() => setHeatMode("delta-edges")}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
                heatMode === "delta-edges" ? "bg-cyan-400 text-[#0b0d10]" : "bg-[#161a20]/80 text-slate-200"
              }`}
            >
              ΔT edges
            </button>
          )}
        </div>
      )}
      <div className={`absolute bottom-4 z-10 flex flex-col items-end gap-2 ${panelOpen ? "right-4 lg:right-[23rem]" : "right-4"}`}>
        {sviVisible && sviFc.features.length > 0 && (
          <div className="min-w-[148px] rounded-md border border-indigo-300/20 bg-[#161a20]/88 px-3 py-2 text-[11px] text-slate-200 backdrop-blur-sm">
            <p className="mb-0.5 text-[10px] font-medium tracking-wide text-indigo-200">SVI 2022</p>
            <p className="mb-1.5 text-[10px] text-slate-500">{sviFc.features.length} tracts · CDC/ATSDR</p>
            <div
              className="h-1.5 w-full rounded-full"
              style={{
                background: "linear-gradient(to right, #c7d2fe, #818cf8, #6366f1, #4c1d95)",
              }}
            />
            <div className="mt-1 flex justify-between font-mono text-[10px] text-stone-400">
              <span>Low</span>
              <span>High</span>
            </div>
          </div>
        )}
        {displayHeat.features.length > 0 && legendMin != null && legendMax != null && (
          <div className="min-w-[148px] rounded-md border border-white/10 bg-[#161a20]/88 px-3 py-2 text-[11px] text-slate-200 backdrop-blur-sm">
            <p className="mb-0.5 text-[10px] font-medium tracking-wide text-slate-300">{legendTitle}</p>
            <p className="mb-1.5 text-[10px] text-slate-500">{displayHeat.features.length} tiles</p>
            <div
              className="h-1.5 w-full rounded-full"
              style={{
                background: legendRamp,
              }}
            />
            <div className="mt-1 flex justify-between font-mono text-[10px] text-stone-400">
              <span>
                {legendMin.toFixed(1)}
                {unit}
              </span>
              <span>
                {legendMax.toFixed(1)}
                {unit}
              </span>
            </div>
            {overlayDeltaC > 0 && (
              <p className="mt-1 text-[10px] text-lime-300/90">Canopy sketch on — not a new satellite run</p>
            )}
            {contoursVisible && isolines.lines.features.length > 0 && isolines.levels.length > 0 && (
              <p className="mt-1 text-[10px] text-slate-500">
                Isolines {isolines.levels.map((n) => n.toFixed(isoDigits)).join(", ")}
                {unit}
              </p>
            )}
          </div>
        )}
      </div>
      {draftAoi && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-cyan-400/30 bg-[#161a20]/90 px-3 py-1 text-[11px] text-cyan-100">
          {(() => {
            const mi = areaMi2(draftAoi);
            const over = mi > MAX_AREA_MI2;
            return `${mi.toFixed(2)} mi²${over ? ` · over ${MAX_AREA_MI2} mi² limit` : " · release to set"}`;
          })()}
        </div>
      )}
    </div>
  );
}
