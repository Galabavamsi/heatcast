import { bboxCenter, type BBox } from "@/lib/aoi";

export type ToolPreset = {
  id: string;
  name: string;
  city: string;
  bbox: BBox;
  threshold_c: number;
};

export const TOOL_PRESETS: ToolPreset[] = [
  {
    id: "houston-eado",
    name: "Houston EaDo",
    city: "Houston, TX",
    bbox: [-95.358, 29.75, -95.338, 29.762],
    threshold_c: 35,
  },
  {
    id: "houston-museum",
    name: "Houston Museum District",
    city: "Houston, TX",
    bbox: [-95.398, 29.718, -95.38, 29.732],
    threshold_c: 35,
  },
  {
    id: "phoenix-downtown",
    name: "Phoenix Downtown",
    city: "Phoenix, AZ",
    bbox: [-112.09, 33.44, -112.06, 33.46],
    threshold_c: 38,
  },
];

/** Same rule as POST /v1/analyze. */
export function thresholdFor(lon: number, lat: number): number {
  return lat > 32.5 && lon < -110 ? 38 : 35;
}

export function thresholdForBox(bbox: BBox): number {
  const c = bboxCenter(bbox);
  return thresholdFor(c.lon, c.lat);
}

export function presetForBox(bbox: BBox): ToolPreset | null {
  const [w, s, e, n] = bbox;
  return (
    TOOL_PRESETS.find((p) => {
      const [pw, ps, pe, pn] = p.bbox;
      return (
        Math.abs(pw - w) < 0.002 &&
        Math.abs(ps - s) < 0.002 &&
        Math.abs(pe - e) < 0.002 &&
        Math.abs(pn - n) < 0.002
      );
    }) ?? null
  );
}
