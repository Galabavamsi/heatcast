import type {
  AnalyzeResponse,
  BuildingsResponse,
  City,
  CoolingResponse,
  EnrichResponse,
  SviResponse,
  WeatherResponse,
} from "./types";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { detail: text };
  }
  if (!res.ok) {
    const detail =
      typeof body === "object" && body && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : text || res.statusText;
    throw new Error(detail);
  }
  return body as T;
}

export async function getCities() {
  const res = await fetch(`${API_URL}/v1/cities`);
  return parse<{ default_city_id: string; cities: City[] }>(res);
}

export async function getWeather(lat: number, lon: number, date: string, time: string) {
  const qs = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    date,
    time,
  });
  const res = await fetch(`${API_URL}/v1/weather?${qs}`);
  return parse<WeatherResponse>(res);
}

export async function searchPlaces(q: string) {
  const qs = new URLSearchParams({ q, limit: "6" });
  const res = await fetch(`${API_URL}/v1/geocode?${qs}`);
  return parse<{ results: PlaceHit[] }>(res);
}

export type PlaceHit = {
  name: string;
  lat: number;
  lon: number;
  bbox: [number, number, number, number] | null;
  kind?: string;
};

export async function analyzeDistrict(payload: {
  start_date: string;
  start_time: string;
  bbox?: [number, number, number, number];
  name?: string;
  city_id?: string;
  threshold_c?: number;
  include_exceedance?: boolean;
  canopy_delta_pct?: number;
  current_canopy_pct?: number | null;
}) {
  const res = await fetch(`${API_URL}/v1/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parse<AnalyzeResponse>(res);
}

function bboxQuery(bbox: [number, number, number, number]) {
  return new URLSearchParams({
    west: String(bbox[0]),
    south: String(bbox[1]),
    east: String(bbox[2]),
    north: String(bbox[3]),
  });
}

export async function getBuildings(bbox: [number, number, number, number]) {
  const res = await fetch(`${API_URL}/v1/buildings?${bboxQuery(bbox)}`, {
    signal: AbortSignal.timeout(70_000),
  });
  return parse<BuildingsResponse>(res);
}

export async function getCooling(bbox: [number, number, number, number]) {
  const res = await fetch(`${API_URL}/v1/cooling?${bboxQuery(bbox)}`, {
    signal: AbortSignal.timeout(55_000),
  });
  return parse<CoolingResponse>(res);
}

export async function getOsmLayers(bbox: [number, number, number, number]) {
  const res = await fetch(`${API_URL}/v1/osm?${bboxQuery(bbox)}`, {
    signal: AbortSignal.timeout(80_000),
  });
  return parse<{ cooling: CoolingResponse; buildings: BuildingsResponse }>(res);
}

export async function enrichHotspot(
  payload: {
    lat: number;
    lon: number;
    temperature: number;
    date: string;
    time: string;
  },
  opts?: { signal?: AbortSignal },
) {
  const res = await fetch(`${API_URL}/v1/enrich`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: opts?.signal ?? AbortSignal.timeout(80_000),
  });
  return parse<EnrichResponse>(res);
}

export function pdfUrl(path: string) {
  if (path.startsWith("http")) return path;
  return `${API_URL}${path}`;
}

export async function writeBrief(payload: {
  city?: string | null;
  scorecard: AnalyzeResponse["scorecard"];
  rain?: AnalyzeResponse["rain"];
  flood?: AnalyzeResponse["flood"];
  scenario?: AnalyzeResponse["scenario"];
  coverage_miss?: boolean;
  satellite_buckets?: NonNullable<EnrichResponse["satellite"]>["buckets"];
  streetview_classes?: Record<string, number> | null;
  svi?: Record<string, unknown> | null;
  cooling?: { count?: number; note?: string } | null;
  shade?: { altitudeDeg?: number; shadowM?: number | null; night?: boolean } | null;
  activity_ids?: Record<string, unknown> | null;
}) {
  const res = await fetch(`${API_URL}/v1/brief`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(50_000),
  });
  return parse<{ text: string; source: string; model: string | null }>(res);
}

export async function fetchSvi(payload: {
  bbox: [number, number, number, number];
  heatmap?: AnalyzeResponse["heatmap"] | null;
}) {
  const [west, south, east, north] = payload.bbox;
  const res = await fetch(`${API_URL}/v1/svi`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      west,
      south,
      east,
      north,
      heatmap: payload.heatmap ?? undefined,
    }),
  });
  return parse<SviResponse>(res);
}
