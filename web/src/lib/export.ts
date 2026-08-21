import { aoiFeature, type BBox } from "./aoi";
import type { AnalyzeResponse, CoolingSite, EnrichResponse, WalkRoute } from "./types";

export type ExportBundle = {
  placeName: string;
  bbox: BBox;
  date: string;
  endDate?: string | null;
  time: string;
  analysis: AnalyzeResponse;
  enrichment: EnrichResponse | null;
  walk: WalkRoute | null;
  walkDest: CoolingSite | null;
  coolingCount: number;
};

function slugPlace(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "aoi";
}

export function exportBasename(placeName: string, date: string): string {
  return `heatcast-${slugPlace(placeName)}-${date}`;
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadText(filename: string, text: string, mime: string) {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

export function buildScorecardJson(bundle: ExportBundle): Record<string, unknown> {
  const { analysis, enrichment, walk, walkDest, coolingCount } = bundle;
  const sat = enrichment?.satellite?.buckets ?? null;
  const walkSummary =
    walk?.ok && (walk.distance_m != null || walk.duration_s != null || walkDest)
      ? {
          ok: true,
          distance_m: walk.distance_m ?? null,
          duration_s: walk.duration_s ?? null,
          dest_name: walkDest?.name ?? null,
          dest_kind: walkDest?.kind ?? null,
        }
      : null;
  return {
    product: "HeatCast",
    place: bundle.placeName,
    bbox: bundle.bbox,
    date: bundle.date,
    ...(bundle.endDate && bundle.endDate !== bundle.date ? { end_date: bundle.endDate } : {}),
    time: bundle.time,
    aoi_area_mi2: analysis.aoi_area_mi2,
    scorecard: analysis.scorecard,
    unrelieved_heat_ratio: analysis.scorecard.unrelieved_heat_ratio ?? analysis.scorecard.unrelieved?.ratio ?? null,
    hotspot: analysis.hotspot,
    activity_ids: analysis.activity_ids,
    coverage_miss: analysis.coverage_miss,
    warning: analysis.warning,
    walk: walkSummary,
    cooling_count: coolingCount,
    ...(sat ? { satellite: sat } : {}),
  };
}

export function downloadScorecardJson(bundle: ExportBundle) {
  const body = JSON.stringify(buildScorecardJson(bundle), null, 2);
  downloadText(`${exportBasename(bundle.placeName, bundle.date)}.json`, body, "application/json");
}

export function buildAoiGeoJson(bundle: ExportBundle): GeoJSON.FeatureCollection {
  const fc = aoiFeature(bundle.bbox);
  const aoi = fc.features[0];
  if (aoi) {
    aoi.properties = {
      kind: "aoi",
      name: bundle.placeName,
      date: bundle.date,
      time: bundle.time,
      area_mi2: bundle.analysis.aoi_area_mi2,
    };
  }
  const features: GeoJSON.Feature[] = aoi ? [aoi] : [];
  const hot = bundle.analysis.hotspot;
  if (hot) {
    features.push({
      type: "Feature",
      properties: {
        kind: "hotspot",
        name: bundle.placeName,
        temperature_c: hot.temperature_c,
        tile_id: hot.tile_id ?? null,
      },
      geometry: { type: "Point", coordinates: [hot.lon, hot.lat] },
    });
  }
  return { type: "FeatureCollection", features };
}

export function downloadAoiGeoJson(bundle: ExportBundle) {
  const body = JSON.stringify(buildAoiGeoJson(bundle));
  downloadText(
    `${exportBasename(bundle.placeName, bundle.date)}.geojson`,
    body,
    "application/geo+json",
  );
}

export function downloadPlannerBrief(bundle: ExportBundle) {
  const memo = bundle.analysis.memo?.trim() || "No planner brief yet.";
  downloadText(`${exportBasename(bundle.placeName, bundle.date)}-brief.txt`, `${memo}\n`, "text/plain");
}

export function tilesFeatureCollection(analysis: AnalyzeResponse): GeoJSON.FeatureCollection | null {
  const hours = analysis.exceedance?.heatmap;
  if (hours?.features?.length) {
    return {
      type: "FeatureCollection",
      features: hours.features as GeoJSON.Feature[],
    };
  }
  if (analysis.heatmap?.features?.length) {
    return {
      type: "FeatureCollection",
      features: analysis.heatmap.features as GeoJSON.Feature[],
    };
  }
  return null;
}

export function downloadTilesGeoJson(bundle: ExportBundle) {
  const fc = tilesFeatureCollection(bundle.analysis);
  if (!fc) return;
  const kind = bundle.analysis.exceedance?.heatmap?.features?.length ? "exceedance" : "tcm";
  downloadText(
    `${exportBasename(bundle.placeName, bundle.date)}-${kind}.geojson`,
    JSON.stringify(fc),
    "application/geo+json",
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
