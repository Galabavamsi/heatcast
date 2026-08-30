import { inUs, normalizeBBox, type BBox } from "./aoi";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export type ShareParams = {
  bbox: BBox | null;
  date: string | null;
  end: string | null;
  time: string | null;
};

function num(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Parse `/app?west=&south=&east=&north=&date=&end=&time=`. `to=` is accepted as an alias for `end`. Invalid boxes are ignored. */
export function parseShareParams(search: string): ShareParams {
  const q = search.startsWith("?") ? search.slice(1) : search;
  const p = new URLSearchParams(q);
  const west = num(p.get("west"));
  const south = num(p.get("south"));
  const east = num(p.get("east"));
  const north = num(p.get("north"));
  let bbox: BBox | null = null;
  if (west != null && south != null && east != null && north != null) {
    const box = normalizeBBox([west, south, east, north]);
    const cx = (box[0] + box[2]) / 2;
    const cy = (box[1] + box[3]) / 2;
    if (box[2] > box[0] && box[3] > box[1] && inUs(cx, cy)) bbox = box;
  }
  const dateRaw = p.get("date");
  const endRaw = p.get("end") ?? p.get("to");
  const timeRaw = p.get("time");
  return {
    bbox,
    date: dateRaw && DATE_RE.test(dateRaw) ? dateRaw : null,
    end: endRaw && DATE_RE.test(endRaw) ? endRaw : null,
    time: timeRaw && TIME_RE.test(timeRaw) ? timeRaw : null,
  };
}

export function shareQuery(bbox: BBox, date: string, time: string, end?: string | null): string {
  const [west, south, east, north] = normalizeBBox(bbox);
  const q = new URLSearchParams({
    west: west.toFixed(5),
    south: south.toFixed(5),
    east: east.toFixed(5),
    north: north.toFixed(5),
    date,
    time,
  });
  if (end) q.set("end", end);
  return `?${q.toString()}`;
}

export function sharePath(bbox: BBox, date: string, time: string, end?: string | null): string {
  return `/app${shareQuery(bbox, date, time, end)}`;
}

export function toolsSharePath(
  bbox: BBox,
  date: string,
  time: string,
  end?: string | null,
  tool?: string | null,
): string {
  const base = tool ? `/tools/${tool}` : "/tools";
  return `${base}${shareQuery(bbox, date, time, end)}`;
}
