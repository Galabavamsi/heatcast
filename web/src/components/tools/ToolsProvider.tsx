"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  analyzeDistrict,
  enrichHotspot,
  getCooling,
  getHoursContext,
  getWalk,
  postWalkExposure,
  searchPlaces,
  type PlaceHit,
} from "@/lib/api";
import {
  areaMi2,
  bboxCenter,
  bboxFromCenter,
  inUs,
  MAX_AREA_MI2,
  MIN_AREA_MI2,
  shrinkToMax,
  type BBox,
} from "@/lib/aoi";
import { DEMO_DATE } from "@/lib/dates";
import { parseShareParams, shareQuery, sharePath, toolsSharePath } from "@/lib/share";
import { SiteFooter, SiteNav } from "@/components/SiteNav";
import { presetForBox, thresholdForBox, TOOL_PRESETS } from "@/lib/tools/presets";
import type {
  AnalyzeResponse,
  CoolingResponse,
  CoolingSite,
  EnrichResponse,
  HoursResponse,
  WalkExposure,
  WalkRoute,
} from "@/lib/types";

const HOURS = ["07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];

export type ToolId = "cooling" | "walk" | "peak" | "compound";

type ToolsState = {
  bbox: BBox;
  date: string;
  time: string;
  placeName: string;
  threshold: number;
  query: string;
  hours: HoursResponse | null;
  analysis: AnalyzeResponse | null;
  enrichment: EnrichResponse | null;
  cooling: CoolingResponse | null;
  walkDest: CoolingSite | null;
  walkRoute: WalkRoute | null;
  walkExposure: WalkExposure | null;
  hoursBusy: boolean;
  scoreBusy: boolean;
  ready: boolean;
  error: string | null;
  shareQ: string;
  scoreHref: string;
  setDate: (v: string) => void;
  setTime: (v: string) => void;
  applyPreset: (id: string) => void;
  applyPlace: (hit: PlaceHit) => void;
  runHours: () => Promise<void>;
  runScore: () => Promise<void>;
};

const ToolsCtx = createContext<ToolsState | null>(null);

export function useTools() {
  const ctx = useContext(ToolsCtx);
  if (!ctx) throw new Error("useTools must be used under ToolsProvider");
  return ctx;
}

function toolFromPath(pathname: string): string | null {
  const part = pathname.split("/").filter(Boolean)[1];
  return part || null;
}

export function ToolsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const tool = toolFromPath(pathname);
  const [bbox, setBbox] = useState<BBox>(TOOL_PRESETS[0].bbox);
  const [date, setDate] = useState(DEMO_DATE);
  const [time, setTime] = useState("15:00");
  const [placeName, setPlaceName] = useState(TOOL_PRESETS[0].name);
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [hours, setHours] = useState<HoursResponse | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [enrichment, setEnrichment] = useState<EnrichResponse | null>(null);
  const [cooling, setCooling] = useState<CoolingResponse | null>(null);
  const [walkDest, setWalkDest] = useState<CoolingSite | null>(null);
  const [walkRoute, setWalkRoute] = useState<WalkRoute | null>(null);
  const [walkExposure, setWalkExposure] = useState<WalkExposure | null>(null);
  const [hoursBusy, setHoursBusy] = useState(false);
  const [scoreBusy, setScoreBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipGeocode = useRef(false);
  const hoursKey = useRef<string | null>(null);
  const scoreKey = useRef<string | null>(null);

  const threshold = thresholdForBox(bbox);
  const shareQ = shareQuery(bbox, date, time);
  const scoreHref = sharePath(bbox, date, time);
  const area = areaMi2(bbox);
  const areaOk = area >= MIN_AREA_MI2 && area <= MAX_AREA_MI2;

  useEffect(() => {
    const parsed = parseShareParams(window.location.search);
    if (parsed.date) setDate(parsed.date);
    if (parsed.time && HOURS.includes(parsed.time)) setTime(parsed.time);
    if (parsed.bbox) {
      const box = shrinkToMax(parsed.bbox);
      const c = bboxCenter(box);
      if (inUs(c.lon, c.lat)) {
        setBbox(box);
        const preset = presetForBox(box);
        setPlaceName(preset?.name || "Shared area");
      }
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const next = toolsSharePath(bbox, date, time, null, tool);
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== next) window.history.replaceState(null, "", next);
  }, [bbox, date, time, tool]);

  const clearDerived = useCallback(() => {
    setHours(null);
    setAnalysis(null);
    setEnrichment(null);
    setCooling(null);
    setWalkDest(null);
    setWalkRoute(null);
    setWalkExposure(null);
    hoursKey.current = null;
    scoreKey.current = null;
    setError(null);
  }, []);

  const applyPreset = useCallback(
    (id: string) => {
      const preset = TOOL_PRESETS.find((p) => p.id === id);
      if (!preset) return;
      setBbox(preset.bbox);
      setPlaceName(preset.name);
      setSearch("");
      setHits([]);
      clearDerived();
    },
    [clearDerived],
  );

  const applyPlace = useCallback(
    (hit: PlaceHit) => {
      skipGeocode.current = true;
      setHits([]);
      const name = hit.name.split(",")[0] || hit.name;
      setPlaceName(name);
      setSearch(name);
      const next = hit.bbox ? shrinkToMax(hit.bbox) : bboxFromCenter(hit.lon, hit.lat, 1.15);
      const c = bboxCenter(next);
      if (!inUs(c.lon, c.lat)) {
        setError("Tools are US-only.");
        return;
      }
      setBbox(next);
      clearDerived();
    },
    [clearDerived],
  );

  useEffect(() => {
    if (skipGeocode.current) {
      skipGeocode.current = false;
      return;
    }
    const q = search.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      searchPlaces(q)
        .then((res) => setHits(res.results || []))
        .catch(() => setHits([]));
    }, 280);
    return () => window.clearTimeout(t);
  }, [search]);

  const runHours = useCallback(async () => {
    const c = bboxCenter(bbox);
    const key = `${bbox.join(",")}|${date}|${time}|${threshold}`;
    if (hoursKey.current === key && hours) return;
    setHoursBusy(true);
    setError(null);
    try {
      const doc = await getHoursContext({
        lat: c.lat,
        lon: c.lon,
        date,
        time,
        threshold_c: threshold,
      });
      hoursKey.current = key;
      setHours(doc);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hourly context failed");
    } finally {
      setHoursBusy(false);
    }
  }, [bbox, date, hours, threshold, time]);

  const runScore = useCallback(async () => {
    if (!areaOk) {
      setError(`Draw or pick a US box between ${MIN_AREA_MI2} and ${MAX_AREA_MI2} mi².`);
      return;
    }
    const key = `${bbox.join(",")}|${date}|${time}|${threshold}`;
    if (scoreKey.current === key && analysis) {
      if (!hours) await runHours();
      return;
    }
    setScoreBusy(true);
    setError(null);
    try {
      const [scored] = await Promise.all([
        analyzeDistrict({
          start_date: date,
          start_time: time,
          bbox,
          name: placeName,
          threshold_c: threshold,
          include_exceedance: true,
          include_persistence: true,
        }),
        runHours(),
      ]);
      scoreKey.current = key;
      setAnalysis(scored);
      const cool = await getCooling(bbox);
      setCooling(cool);
      const sites = coolingSitesFrom(cool);
      const dest = scored.hotspot ? nearestIndoor(scored.hotspot, sites) : null;
      setWalkDest(dest);
      if (scored.hotspot && dest) {
        const route = await getWalk(scored.hotspot.lon, scored.hotspot.lat, dest.lon, dest.lat);
        const okRoute = route.ok ? route : null;
        setWalkRoute(okRoute);
        if (okRoute?.coordinates?.length && scored.heatmap) {
          const exposure = await postWalkExposure({
            coordinates: okRoute.coordinates as [number, number][],
            heatmap: scored.heatmap,
            threshold_c: threshold,
          });
          setWalkExposure(exposure);
        } else {
          setWalkExposure(null);
        }
      } else {
        setWalkRoute(null);
        setWalkExposure(null);
      }
      if (scored.hotspot) {
        enrichHotspot({
          lat: scored.hotspot.lat,
          lon: scored.hotspot.lon,
          temperature: scored.hotspot.temperature_c ?? scored.scorecard.mean_c ?? 35,
          date,
          time,
        }).then(setEnrichment).catch(() => setEnrichment(null));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Neighborhood score failed");
    } finally {
      setScoreBusy(false);
    }
  }, [analysis, areaOk, bbox, date, hours, placeName, runHours, threshold, time]);

  const value = useMemo<ToolsState>(
    () => ({
      bbox,
      date,
      time,
      placeName,
      threshold,
      query: search,
      hours,
      analysis,
      enrichment,
      cooling,
      walkDest,
      walkRoute,
      walkExposure,
      hoursBusy,
      scoreBusy,
      ready,
      error,
      shareQ,
      scoreHref,
      setDate: (v) => {
        setDate(v);
        clearDerived();
      },
      setTime: (v) => {
        setTime(v);
        clearDerived();
      },
      applyPreset,
      applyPlace,
      runHours,
      runScore,
    }),
    [
      analysis,
      applyPlace,
      applyPreset,
      bbox,
      clearDerived,
      cooling,
      date,
      enrichment,
      error,
      hours,
      hoursBusy,
      placeName,
      ready,
      runHours,
      runScore,
      scoreBusy,
      scoreHref,
      search,
      shareQ,
      threshold,
      time,
      walkDest,
      walkExposure,
      walkRoute,
    ],
  );

  const activePreset = presetForBox(bbox)?.id ?? null;

  return (
    <ToolsCtx.Provider value={value}>
      <div className="flex min-h-dvh flex-col bg-[#0b0d10] text-[#e8edf4]">
        <header className="border-b border-[#2a313c] px-4 py-4 sm:px-6">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SiteNav active="tools" query={shareQ} />
              <Link
                href={scoreHref}
                className="text-[11px] uppercase tracking-wide text-cyan-400 hover:text-cyan-200"
              >
                Open Score →
              </Link>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              {TOOL_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.id)}
                  className={
                    activePreset === preset.id
                      ? "rounded-md bg-cyan-400/15 px-2.5 py-1 text-[11px] text-cyan-100"
                      : "rounded-md border border-[#2a313c] px-2.5 py-1 text-[11px] text-slate-400 hover:text-slate-200"
                  }
                >
                  {preset.name}
                </button>
              ))}
              <div className="relative min-w-[12rem] flex-1">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search a US neighborhood"
                  className="w-full rounded-lg border border-[#2a313c] bg-[#0b0d10] px-3 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400/60"
                />
                {hits.length > 0 && (
                  <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-[#2a313c] bg-[#161a20] py-1 text-sm">
                    {hits.map((hit) => (
                      <li key={`${hit.lat}:${hit.lon}:${hit.name}`}>
                        <button
                          type="button"
                          onClick={() => applyPlace(hit)}
                          className="w-full px-3 py-2 text-left text-slate-200 hover:bg-cyan-400/10"
                        >
                          {hit.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <label className="text-[11px] text-slate-400">
                Date
                <input
                  type="date"
                  value={date}
                  onChange={(e) => value.setDate(e.target.value)}
                  className="ml-2 rounded-md border border-[#2a313c] bg-[#0b0d10] px-2 py-1 text-slate-100"
                />
              </label>
              <label className="text-[11px] text-slate-400">
                Hour
                <select
                  value={time}
                  onChange={(e) => value.setTime(e.target.value)}
                  className="ml-2 rounded-md border border-[#2a313c] bg-[#0b0d10] px-2 py-1 text-slate-100"
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
              <span className="text-[11px] text-slate-500">
                {placeName} · {area.toFixed(2)} mi² · {threshold} °C
              </span>
            </div>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6">{children}</main>
        <SiteFooter />
      </div>
    </ToolsCtx.Provider>
  );
}

function coolingSitesFrom(cooling: CoolingResponse): CoolingSite[] {
  const out: CoolingSite[] = [];
  for (const ft of cooling.features || []) {
    const g = ft.geometry;
    if (!g || g.type !== "Point" || !Array.isArray(g.coordinates)) continue;
    const [lon, lat] = g.coordinates as [number, number];
    const props = (ft.properties || {}) as {
      name?: string;
      kind?: string;
      kind_key?: string;
      walk_ok?: boolean;
    };
    const kind = props.kind || "Site";
    out.push({
      name: props.name || "Indoor site",
      kind,
      kindKey: props.kind_key,
      walkOk:
        typeof props.walk_ok === "boolean"
          ? props.walk_ok
          : ["Library", "Community centre", "Social facility", "Town hall"].includes(kind),
      lon,
      lat,
    });
  }
  return out;
}

function nearestIndoor(from: { lon: number; lat: number }, sites: CoolingSite[]) {
  const indoor = sites.filter((s) => s.walkOk);
  const pool = indoor.length ? indoor : sites;
  let best: CoolingSite | null = null;
  let bestD = Infinity;
  for (const site of pool) {
    const d = haversineM(from, site);
    if (d < bestD) {
      bestD = d;
      best = site;
    }
  }
  return best;
}

function haversineM(a: { lon: number; lat: number }, b: { lon: number; lat: number }) {
  const r = 6371000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
