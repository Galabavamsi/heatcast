"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  analyzeDistrict,
  enrichHotspot,
  fetchSvi,
  getBuildings,
  getCooling,
  getWalk,
  getWeather,
  pdfUrl,
  searchPlaces,
  writeBrief,
  type PlaceHit,
} from "@/lib/api";
import {
  areaMi2,
  bboxCenter,
  bboxFromCenter,
  expandBBox,
  inUs,
  MAX_AREA_MI2,
  shrinkToMax,
  zoomForBBox,
  type BBox,
} from "@/lib/aoi";
import {
  copyText,
  downloadAoiGeoJson,
  downloadPlannerBrief,
  downloadScorecardJson,
  downloadTilesGeoJson,
  tilesFeatureCollection,
} from "@/lib/export";
import { parseShareParams, sharePath, shareQuery } from "@/lib/share";
import ExportMenu from "@/components/ExportMenu";
import { SiteNav } from "@/components/SiteNav";
import {
  DEMO_DATE,
  addDays,
  clampEndDate,
  durationHelper,
  durationWindow,
} from "@/lib/dates";
import {
  binValues,
  compactNum,
  extractHours,
  extractTemps,
  hoursAtHotspot,
  iqrCaption,
  shareToPercent,
} from "@/lib/histogram";
import { satelliteMixSlices } from "@/lib/landcover";
import UnrelievedChip from "@/components/UnrelievedChip";
import { CITATIONS, estimateScenario, incrementDeltaC } from "@/lib/scenario";
import { buildingShadows, type ShadeMeta } from "@/lib/shade";
import type {
  AnalyzeResponse,
  BuildingsResponse,
  ComfortContext,
  CoolingResponse,
  CoolingSite,
  EnrichResponse,
  RainContext,
  SviResponse,
  SviTract,
  WalkRoute,
  WeatherResponse,
} from "@/lib/types";

const HeatMap = dynamic(() => import("@/components/HeatMap"), { ssr: false });

const HOURS = ["07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];
const CANOPY_STEPS = [0, 10, 20];
const ANALYZE_STEPS = [
  { at: 0, label: "Contacting satellite…", pct: 20 },
  { at: 2800, label: "Building 100 m tiles…", pct: 48 },
  { at: 8000, label: "Scoring area…", pct: 72 },
  { at: 18000, label: "Finishing scorecard…", pct: 88 },
];

const GUIDE_STEPS = [
  {
    title: "Find a neighborhood",
    body: "Search any US city, then zoom with the scroll wheel or +/−. Coverage is the United States only.",
  },
  {
    title: "Draw the area",
    body: "Click Draw area, then drag a box on the map. Scroll still zooms. Hold Space to pan. Stay under 45 mi².",
  },
  {
    title: "Score the heat",
    body: "Press Score area. You get ~100 m air tiles, hours above threshold, and the longest consecutive hot streak.",
  },
  {
    title: "Inspect in 3D",
    body: "Turn on 3D heat. Right-drag or Ctrl-drag to orbit. Plant trees on the hottest tiles, or follow the walk to the nearest indoor site.",
  },
];

type Interaction = "pan" | "draw" | "orbit";
type DateMode = "day" | "range";
type DockTab = "range" | "duration" | "place" | "brief";

export default function ScoreApp() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [placeName, setPlaceName] = useState("United States");
  const [aoi, setAoi] = useState<BBox | null>(null);
  const [view, setView] = useState({ longitude: -98.35, latitude: 39.5, zoom: 4.1 });
  const [startDate, setStartDate] = useState(DEMO_DATE);
  const [endDate, setEndDate] = useState(DEMO_DATE);
  const [dateMode, setDateMode] = useState<DateMode>("day");
  const [startTime, setStartTime] = useState("15:00");
  const [hourPlaying, setHourPlaying] = useState(false);
  const [interaction, setInteraction] = useState<Interaction>("pan");
  const [volume, setVolume] = useState(false);
  const [resetViewTick, setResetViewTick] = useState(0);
  const [flattenTick, setFlattenTick] = useState(0);
  const [canopyDelta, setCanopyDelta] = useState(0);
  const [contoursOn, setContoursOn] = useState(true);
  const [busy, setBusy] = useState<"analyze" | null>(null);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [enrichment, setEnrichment] = useState<EnrichResponse | null>(null);
  const [buildings, setBuildings] = useState<BuildingsResponse | null>(null);
  const [svi, setSvi] = useState<SviResponse | null>(null);
  const [sviBusy, setSviBusy] = useState(false);
  const [sviOn, setSviOn] = useState(true);
  const [shadeOn, setShadeOn] = useState(true);
  const [coolingOn, setCoolingOn] = useState(true);
  const [cooling, setCooling] = useState<CoolingResponse | null>(null);
  const [coolingBusy, setCoolingBusy] = useState(false);
  const [walkRoute, setWalkRoute] = useState<WalkRoute | null>(null);
  const [walkDest, setWalkDest] = useState<CoolingSite | null>(null);
  const [walkBusy, setWalkBusy] = useState(false);
  const [walkOn, setWalkOn] = useState(true);
  const [plantMode, setPlantMode] = useState(false);
  const [plantedTrees, setPlantedTrees] = useState<Array<{ lon: number; lat: number }>>([]);
  const [buildingsBusy, setBuildingsBusy] = useState(false);
  const [osmError, setOsmError] = useState<string | null>(null);
  const [selectedSvi, setSelectedSvi] = useState<SviTract | null>(null);
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [dockOpen, setDockOpen] = useState(true);
  const [dockTab, setDockTab] = useState<DockTab>("duration");
  const [mobileTab, setMobileTab] = useState<DockTab>("duration");
  const [sheetOpen, setSheetOpen] = useState(true);
  const [guideStep, setGuideStep] = useState<number | null>(0);
  const [memoBusy, setMemoBusy] = useState(false);
  const [plantHint, setPlantHint] = useState(true);
  const [copied, setCopied] = useState<"brief" | "link" | null>(null);
  const skipGeocode = useRef(false);
  const briefSeq = useRef(0);
  const hourPlayRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      if (window.localStorage.getItem("heatcast-guide-v1") === "done") setGuideStep(null);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const parsed = parseShareParams(window.location.search);
    if (parsed.date) {
      setStartDate(parsed.date);
      if (parsed.end) {
        setEndDate(clampEndDate(parsed.date, parsed.end));
        setDateMode("range");
      } else {
        setEndDate(parsed.date);
        setDateMode("day");
      }
    }
    if (parsed.time && HOURS.includes(parsed.time)) setStartTime(parsed.time);
    if (parsed.bbox) {
      const box = shrinkToMax(parsed.bbox);
      const c = bboxCenter(box);
      if (!inUs(c.lon, c.lat)) return;
      setAoi(box);
      setPlaceName("Shared area");
      setView({ longitude: c.lon, latitude: c.lat, zoom: zoomForBBox(box) });
      setGuideStep(null);
    }
  }, []);

  useEffect(() => {
    if (!aoi) return;
    const next = sharePath(aoi, startDate, startTime, dateMode === "range" ? endDate : null);
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== next) window.history.replaceState(null, "", next);
  }, [aoi, startDate, endDate, startTime, dateMode]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setHits([]);
      setPlantMode(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const stopHourPlay = useCallback(() => {
    if (hourPlayRef.current != null) {
      window.clearInterval(hourPlayRef.current);
      hourPlayRef.current = null;
    }
    setHourPlaying(false);
  }, []);

  useEffect(() => () => stopHourPlay(), [stopHourPlay]);

  const currentCanopy = enrichment?.satellite?.buckets?.canopy_pct ?? null;
  const liveScenario = useMemo(() => {
    if (!analysis) return null;
    return estimateScenario({
      canopyDeltaPct: canopyDelta,
      currentCanopyPct: currentCanopy,
      meanC: analysis.scorecard.mean_c,
      meanHours: analysis.scorecard.mean_hours_above,
      thresholdC: analysis.scorecard.threshold_c,
    });
  }, [analysis, canopyDelta, currentCanopy]);

  const shade = useMemo(() => {
    if (!buildings?.features?.length || !aoi) return null;
    const c = bboxCenter(aoi);
    return buildingShadows(
      buildings,
      startDate,
      startTime,
      weather?.timezone || "America/Chicago",
      c.lat,
      c.lon,
    );
  }, [buildings, aoi, startDate, startTime, weather?.timezone]);

  const coolingSites: CoolingSite[] = useMemo(() => {
    if (!cooling?.features?.length) return [];
    const out: CoolingSite[] = [];
    for (const ft of cooling.features) {
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
      const kindKey = props.kind_key || "";
      out.push({
        name: props.name || "Cooling site",
        kind,
        kindKey,
        walkOk:
          typeof props.walk_ok === "boolean"
            ? props.walk_ok
            : ["Library", "Community centre", "Social facility", "Town hall"].includes(kind),
        lon,
        lat,
      });
    }
    return out;
  }, [cooling]);

  useEffect(() => {
    if (!analysis?.hotspot || !coolingSites.length) {
      setWalkRoute(null);
      setWalkDest(null);
      setWalkBusy(false);
      return;
    }
    const dest = nearestCoolingSite(analysis.hotspot, coolingSites);
    if (!dest) {
      setWalkRoute(null);
      setWalkDest(null);
      setWalkBusy(false);
      return;
    }
    let cancelled = false;
    setWalkDest(dest);
    setWalkBusy(true);
    getWalk(analysis.hotspot.lon, analysis.hotspot.lat, dest.lon, dest.lat)
      .then((route) => {
        if (!cancelled) setWalkRoute(route.ok ? route : null);
      })
      .catch(() => {
        if (!cancelled) setWalkRoute(null);
      })
      .finally(() => {
        if (!cancelled) setWalkBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [analysis?.hotspot, coolingSites]);

  useEffect(() => {
    if (!analysis?.heatmap?.features?.length || canopyDelta <= 0) return;
    setPlantedTrees((cur) =>
      cur.length ? cur : hottestTreeSeeds(analysis.heatmap, canopyDelta >= 20 ? 10 : 6),
    );
  }, [analysis, canopyDelta]);

  const briefInputs = useRef({ analysis, enrichment, svi, cooling, shade });
  briefInputs.current = { analysis, enrichment, svi, cooling, shade };
  const activityId = analysis?.confidence?.activity_id ?? null;
  const satKey = enrichment?.satellite?.buckets
    ? `${enrichment.satellite.buckets.canopy_pct}:${enrichment.satellite.buckets.impervious_pct}`
    : enrichment
      ? "empty"
      : "pending";
  const sviKey = svi?.summary
    ? `${svi.summary.tract_count}:${svi.summary.max_svi}`
    : sviBusy
      ? "pending"
      : "none";
  const coolKey = String(cooling?.meta?.count ?? (coolingBusy ? "pending" : "none"));
  const shadeKey = shade?.meta
    ? `${Math.round(shade.meta.altitudeDeg)}:${shade.meta.shadowM ?? "n"}`
    : "none";

  useEffect(() => {
    if (!activityId || enrichBusy || sviBusy) return;
    const current = briefInputs.current.analysis;
    const enrich = briefInputs.current.enrichment;
    const sviData = briefInputs.current.svi;
    const cool = briefInputs.current.cooling;
    const shadeData = briefInputs.current.shade;
    if (!current) return;
    const seq = ++briefSeq.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        setMemoBusy(true);
        try {
          const doc = await writeBrief({
            city: current.place_name || current.city?.name,
            scorecard: current.scorecard,
            rain: current.rain,
            flood: current.flood,
            scenario: current.scenario,
            coverage_miss: current.coverage_miss,
            satellite_buckets: enrich?.satellite?.buckets,
            streetview_classes: enrich?.streetview?.classes_percent ?? null,
            svi: sviData?.summary
              ? {
                  tract_count: sviData.summary.tract_count,
                  max_svi: sviData.summary.max_svi,
                  mean_svi: sviData.summary.mean_svi,
                  highest_svi_name: sviData.summary.highest_svi_name,
                  high_svi_hottest_third: sviData.summary.high_svi_hottest_third,
                  planner_sentence: sviData.summary.planner_sentence,
                }
              : null,
            cooling: cool?.meta?.count
              ? { count: cool.meta.count, note: cool.meta.note }
              : null,
            shade: shadeData?.meta
              ? {
                  altitudeDeg: shadeData.meta.altitudeDeg,
                  shadowM: shadeData.meta.shadowM,
                  night: shadeData.meta.night,
                }
              : null,
            activity_ids: current.activity_ids,
          });
          if (seq !== briefSeq.current) return;
          setAnalysis((prev) =>
            prev && prev.confidence?.activity_id === activityId
              ? { ...prev, memo: doc.text, memo_meta: { source: doc.source, model: doc.model } }
              : prev,
          );
        } catch {
          /* keep the template snapshot from analyze */
        } finally {
          if (seq === briefSeq.current) setMemoBusy(false);
        }
      })();
    }, 700);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activityId, enrichBusy, sviBusy, satKey, sviKey, coolKey, shadeKey]);

  const comfort = analysis?.comfort ?? weather?.comfort ?? null;
  const dateWindow = useMemo(() => durationWindow(startDate, endDate), [startDate, endDate]);
  const rangeScored = Boolean(
    analysis &&
      ((analysis.confidence.duration_days ?? 1) > 1 || analysis.confidence.duration_filter_type === 4),
  );
  const showRangeTab = dateMode === "range" && rangeScored;
  const scoredHour = analysis ? hourFromDatetime(analysis.confidence.datetime) : null;
  const hourStale = Boolean(analysis && scoredHour && scoredHour !== startTime);

  useEffect(() => {
    if (showRangeTab) return;
    setDockTab((tab) => (tab === "range" ? "duration" : tab));
    setMobileTab((tab) => (tab === "range" ? "duration" : tab));
  }, [showRangeTab]);

  const area = aoi ? areaMi2(aoi) : 0;
  const areaOk = aoi != null && area >= 0.04 && area <= MAX_AREA_MI2;

  useEffect(() => {
    const q = query.trim();
    if (skipGeocode.current) {
      skipGeocode.current = false;
      setHits([]);
      return;
    }
    if (q.length < 3) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      void searchPlaces(q)
        .then((data) => setHits(data.results))
        .catch(() => setHits([]));
    }, 280);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!aoi) return;
    const { lon, lat } = bboxCenter(aoi);
    getWeather(lat, lon, startDate, startTime)
      .then(setWeather)
      .catch(() => setWeather(null));
  }, [aoi, startDate, startTime]);

  const applyPlace = useCallback((hit: PlaceHit) => {
    skipGeocode.current = true;
    setHits([]);
    setPlaceName(hit.name.split(",")[0] || hit.name);
    setQuery(hit.name.split(",")[0] || hit.name);
    setAnalysis(null);
    setEnrichment(null);
    setBuildings(null);
    setSvi(null);
    setSelectedSvi(null);
    setCooling(null);
    setCanopyDelta(0);
    setMobileTab("duration");
    setDockTab("duration");
    const next = hit.bbox
      ? shrinkToMax(hit.bbox)
      : bboxFromCenter(hit.lon, hit.lat, 1.15);
    setAoi(next);
    const c = bboxCenter(next);
    setView({ longitude: c.lon, latitude: c.lat, zoom: 14 });
    setInteraction("pan");
    setGuideStep((s) => (s === 0 ? 1 : s));
  }, []);

  const loadOsm = useCallback(async (box: BBox) => {
    setOsmError(null);
    setCoolingBusy(true);
    setBuildingsBusy(true);
    const errs: string[] = [];
    try {
      const coolingData = await getCooling(box);
      setCooling(coolingData);
      if (coolingData.features?.length) setCoolingOn(true);
      if (coolingData.meta?.error && !coolingData.features?.length) errs.push(coolingData.meta.error);
    } catch (err) {
      errs.push(err instanceof Error ? err.message : "OSM cooling overlay failed");
    } finally {
      setCoolingBusy(false);
    }
    try {
      const buildingData = await getBuildings(box);
      setBuildings(buildingData);
      if (buildingData.features?.length) setShadeOn(true);
      if (buildingData.meta?.error && !buildingData.features?.length) errs.push(buildingData.meta.error);
    } catch (err) {
      errs.push(err instanceof Error ? err.message : "OSM shade overlay failed");
    } finally {
      setBuildingsBusy(false);
    }
    if (errs.length) setOsmError(errs[0] ?? "OSM overlay failed");
  }, []);

  const onAoiChange = useCallback((bbox: BBox) => {
    setAoi(bbox);
    setPlaceName("Drawn area");
    setError(null);
    setAnalysis(null);
    setEnrichment(null);
    setBuildings(null);
    setSvi(null);
    setSelectedSvi(null);
    setCooling(null);
    setWalkRoute(null);
    setWalkDest(null);
    setPlantedTrees([]);
    setPlantMode(false);
    setOsmError(null);
    setMobileTab("duration");
    setDockTab("duration");
    setGuideStep((s) => (s === 1 ? 2 : s));
  }, []);

  async function onAnalyze(time = startTime) {
    if (!aoi || busy === "analyze") return;
    stopHourPlay();
    if (!areaOk) {
      setError(
        area > MAX_AREA_MI2
          ? `Box is ${area.toFixed(1)} mi². Shrink below ${MAX_AREA_MI2} mi².`
          : "Draw a larger neighborhood box.",
      );
      return;
    }
    setBusy("analyze");
    setError(null);
    briefSeq.current += 1;
    setMemoBusy(false);
    try {
      const result = await analyzeDistrict({
        bbox: aoi,
        name: placeName,
        start_date: startDate,
        end_date: dateWindow.endDate,
        start_time: time,
        include_exceedance: true,
        include_persistence: true,
        canopy_delta_pct: canopyDelta,
        current_canopy_pct: currentCanopy,
      });
      setAnalysis(result);
      setStartTime(time);
      setEnrichment(null);
      setSvi(null);
      setSelectedSvi(null);
      setCooling(null);
      setWalkRoute(null);
      setWalkDest(null);
      setPlantedTrees([]);
      setPlantMode(false);
      setSviOn(true);
      setContoursOn(true);
      setShadeOn(true);
      setCoolingOn(true);
      setBusy(null);
      setDockOpen(true);
      setSheetOpen(true);
      setDockTab(dateWindow.days > 1 && dateMode === "range" ? "range" : "duration");
      setMobileTab(dateWindow.days > 1 && dateMode === "range" ? "range" : "duration");
      setGuideStep((s) => (s === 2 ? 3 : s));
      setSviBusy(true);
      void fetchSvi({
        bbox: aoi,
        heatmap: result.coverage_miss ? null : result.heatmap,
      })
        .then((data) => {
          setSvi(data);
          setSviOn(true);
        })
        .catch(() => setSvi(null))
        .finally(() => setSviBusy(false));
      const hot = result.hotspot;
      if (!result.coverage_miss && hot && hot.temperature_c != null) {
        const tempC = hot.temperature_c;
        setEnrichBusy(true);
        void enrichHotspot({
          lat: hot.lat,
          lon: hot.lon,
          temperature: tempC,
          date: startDate,
          time,
        })
          .then(setEnrichment)
          .catch((err: unknown) => {
            const raw = err instanceof Error ? err.message : "Enrich failed";
            const timedOut = /timeout|timed out|abort/i.test(raw);
            setEnrichment({
              lat: hot.lat,
              lon: hot.lon,
              temperature_c: tempC,
              env_params: null,
              satellite: null,
              streetview: null,
              heat_intelligence: null,
              errors: {
                enrich: timedOut
                  ? "Site enrich timed out. Heatmap and scorecard are still valid."
                  : raw,
              },
            });
          })
          .finally(() => setEnrichBusy(false));
      }
      setBuildingsBusy(true);
      setCoolingBusy(true);
      void loadOsm(aoi);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analyze failed");
      setBusy(null);
    }
  }

  function onDateMode(next: DateMode) {
    if (next === dateMode) return;
    stopHourPlay();
    setDateMode(next);
    setEndDate(startDate);
    if (next === "day") {
      setDockTab((tab) => (tab === "range" ? "duration" : tab));
      setMobileTab((tab) => (tab === "range" ? "duration" : tab));
    }
  }

  function onFromDate(next: string) {
    setStartDate(next);
    if (dateMode === "day") {
      setEndDate(next);
      return;
    }
    if (endDate < next) {
      setEndDate(next);
      return;
    }
    const capped = clampEndDate(next, endDate);
    if (capped !== endDate) setEndDate(capped);
  }

  function onToDate(next: string) {
    setEndDate(clampEndDate(startDate, next));
  }

  function onHourChange(time: string) {
    stopHourPlay();
    setStartTime(time);
  }

  function toggleHourPlay() {
    if (hourPlayRef.current != null) {
      stopHourPlay();
      return;
    }
    let idx = HOURS.indexOf(startTime);
    if (idx < 0 || idx >= HOURS.length - 1) idx = -1;
    setHourPlaying(true);
    const step = () => {
      idx += 1;
      if (idx >= HOURS.length) {
        stopHourPlay();
        return;
      }
      setStartTime(HOURS[idx]);
    };
    step();
    hourPlayRef.current = window.setInterval(step, 1200);
  }

  function onVolume(next: boolean) {
    setVolume(next);
    if (!next) setFlattenTick((n) => n + 1);
    if (next && aoi && !buildings) {
      void loadOsm(aoi);
    }
  }

  const rain = analysis?.rain ?? weather?.rain ?? null;
  const flood = analysis?.flood ?? weather?.flood ?? null;
  const scoring = busy === "analyze";
  const navQuery = aoi
    ? shareQuery(aoi, startDate, startTime, dateMode === "range" ? endDate : null)
    : "";
  const exportBundle = useMemo(() => {
    if (!analysis || !aoi) return null;
    return {
      placeName,
      bbox: aoi,
      date: startDate,
      endDate: dateWindow.endDate,
      time: startTime,
      analysis,
      enrichment,
      walk: walkRoute,
      walkDest,
      coolingCount: coolingSites.length,
    };
  }, [analysis, aoi, placeName, startDate, startTime, dateWindow.endDate, enrichment, walkRoute, walkDest, coolingSites.length]);

  function flashCopied(kind: "brief" | "link") {
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1600);
  }

  const walkMinutes =
    walkRoute?.duration_s != null ? Math.max(1, Math.round(walkRoute.duration_s / 60)) : null;

  const durationBody = (
    <div className="flex flex-col gap-2.5">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-slate-500">Selected</p>
        <h2 className="text-sm font-semibold text-slate-100">{placeName}</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
          {!aoi
            ? "Search a US neighborhood or click Draw area, then Score."
            : analysis
              ? durationHelper(dateWindow)
              : dateMode === "range"
                ? "Hours/streak use this window (max 7 days). Air tiles use From + Hour."
                : "Box ready. Click Score area for air tiles, hours, and streak."}
        </p>
      </div>
      {!aoi && !analysis && (
        <p className="rounded-lg border border-cyan-900/40 bg-[#0b0d10] px-3 py-3 text-sm leading-relaxed text-slate-200">
          Draw a box under 45 mi², or search a place. Coverage is the United States only. Use a historic summer date — coverage often misses “today”.
        </p>
      )}
      {scoring && !analysis && <SidebarSkeleton />}
      {analysis && (
        <Scorecard
          analysis={analysis}
          scenario={liveScenario}
          dateWindow={dateWindow}
          variant={showRangeTab ? "snapshot" : "full"}
        />
      )}
      <p className="pt-1 text-[10px] text-slate-600">Air tiles · duration product up to 7 days</p>
    </div>
  );

  const rangeBody = analysis ? (
    <div className="flex flex-col gap-2.5">
      {analysis.delta && analysis.delta.mean_delta != null && (
        <p className="text-[11px] leading-snug text-slate-300">
          Mean ΔT {analysis.delta.mean_delta.toFixed(1)} °C (To − From at {analysis.delta.hour ?? startTime}).
          Positive = hotter at the end of the window.
        </p>
      )}
      <Scorecard analysis={analysis} scenario={liveScenario} dateWindow={dateWindow} variant="range" />
    </div>
  ) : null;

  const placeBody = analysis ? (
    <div className="flex flex-col gap-2.5">
      <SviPanel svi={svi} busy={sviBusy} selected={selectedSvi} />
      <CoolingPanel
        sites={coolingSites}
        busy={coolingBusy}
        note={cooling?.meta?.note}
        error={osmError}
        walk={walkRoute}
        walkDest={walkDest}
        walkBusy={walkBusy}
      />
      <PlantPanel
        plantMode={plantMode}
        onPlantMode={(v) => {
          setPlantMode(v);
          if (v) {
            setInteraction("pan");
            setPlantHint(true);
          }
        }}
        treeCount={plantedTrees.length}
        onClear={() => setPlantedTrees([])}
        onSeedHottest={() => setPlantedTrees(hottestTreeSeeds(analysis.heatmap, 8))}
      />
      <ScenarioPanel
        canopyDelta={canopyDelta}
        onChange={setCanopyDelta}
        currentCanopy={currentCanopy}
        live={liveScenario}
      />
      <RainComfortRow
        rain={rain}
        flood={flood}
        elevationM={weather?.elevation_m}
        comfort={comfort}
        shade={shade?.meta ?? null}
        rangeDays={dateWindow.days}
      />
      <p className="pt-1 text-[10px] text-slate-600">CDC SVI 2022 · OSM · OSRM walk</p>
    </div>
  ) : null;

  const briefBody = analysis ? (
    <div className="flex flex-col gap-2.5">
      {(analysis.memo || memoBusy) && (
        <section className="rounded-lg border border-[#2a313c] bg-[#0b0d10] p-3 text-xs leading-relaxed text-slate-300">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3 className="text-[10px] uppercase tracking-wide text-cyan-400">Planner brief</h3>
            {analysis.memo && !analysis.memo.trim().startsWith("{") && (
              <button
                type="button"
                className="text-[10px] text-cyan-300/90 hover:underline"
                onClick={() => {
                  void copyText(analysis.memo).then((ok) => {
                    if (ok) flashCopied("brief");
                  });
                }}
              >
                {copied === "brief" ? "Copied" : "Copy"}
              </button>
            )}
          </div>
          {memoBusy && (
            <p className="mb-2 text-[10px] text-cyan-400/80">Updating with satellite and SVI…</p>
          )}
          {analysis.memo && !analysis.memo.trim().startsWith("{") ? analysis.memo : null}
        </section>
      )}
      <ConfidenceStrip analysis={analysis} />
      {analysis.hotspot && (
        <HotspotPanel hotspot={analysis.hotspot} enrichment={enrichment} busy={enrichBusy} />
      )}
    </div>
  ) : null;

  return (
    <div className="relative h-dvh overflow-hidden bg-[#0b0d10] text-[#e8edf4]">
      <HeatMap
        longitude={view.longitude}
        latitude={view.latitude}
        zoom={view.zoom}
        pitched={volume}
        volume={volume}
        interaction={interaction}
        aoi={aoi}
        analysis={analysis}
        buildings={buildings}
        svi={svi}
        sviVisible={sviOn && Boolean(svi?.features.length)}
        selectedSviFips={selectedSvi?.fips ?? null}
        overlayDeltaC={liveScenario?.estimated_delta_c || 0}
        resetViewTick={resetViewTick}
        flattenTick={flattenTick}
        contoursVisible={contoursOn}
        shadeVisible={shadeOn}
        shadeFc={shadeOn ? shade?.shadows ?? null : null}
        coolingVisible={coolingOn}
        coolingSites={coolingSites}
        walkCoords={walkRoute?.coordinates ?? null}
        walkVisible={walkOn && Boolean(walkRoute?.coordinates?.length)}
        walkDest={walkDest}
        plantedTrees={plantedTrees}
        plantMode={plantMode}
        panelOpen={dockOpen}
        showDeltaLayers={
          showRangeTab && Boolean(analysis?.delta?.heatmap?.features?.length)
        }
        onAoiChange={onAoiChange}
        onMapClick={(pt) => {
          if (!plantMode || !analysis) return;
          setPlantedTrees((cur) => (cur.length >= 24 ? cur : [...cur, pt]));
        }}
        onSviSelect={setSelectedSvi}
      />

      <header className="heatcast-glass pointer-events-auto absolute inset-x-4 top-4 z-20 flex flex-col gap-2 rounded-xl px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <SiteNav active="score" compact query={navQuery} />
          <div className="relative min-w-0 flex-1">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setHits([]);
              }}
              onBlur={() => {
                window.setTimeout(() => setHits([]), 180);
              }}
              placeholder="Search any US city or neighborhood"
              className="w-full rounded-lg border border-[#2a313c] bg-[#0b0d10] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400/60"
            />
            {hits.length > 0 && (
              <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-[#2a313c] bg-[#161a20] py-1 text-sm shadow-xl">
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
        </div>
        <div className="flex w-full min-w-0 items-end gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
            <div className="flex shrink-0 rounded-md bg-[#0b0d10] p-0.5" role="group" aria-label="Date mode">
              <button
                type="button"
                aria-pressed={dateMode === "day"}
                disabled={scoring}
                onClick={() => onDateMode("day")}
                className={`rounded px-2.5 py-1.5 text-[11px] font-medium ${
                  dateMode === "day" ? "bg-cyan-400 text-[#0b0d10]" : "text-slate-400 hover:text-cyan-100"
                }`}
              >
                Day
              </button>
              <button
                type="button"
                aria-pressed={dateMode === "range"}
                disabled={scoring}
                onClick={() => onDateMode("range")}
                className={`rounded px-2.5 py-1.5 text-[11px] font-medium ${
                  dateMode === "range" ? "bg-cyan-400 text-[#0b0d10]" : "text-slate-400 hover:text-cyan-100"
                }`}
              >
                Range
              </button>
            </div>
            <label
              className="text-[11px] text-slate-400"
              title="Snapshot day for air tiles, shade, and comfort. Historic US summers (e.g. 2024-07-15) usually have coverage."
            >
              {dateMode === "range" ? "From" : "Date"}
              <input
                type="date"
                value={startDate}
                disabled={scoring}
                onChange={(e) => onFromDate(e.target.value)}
                className="mt-0.5 block rounded-md border border-[#2a313c] bg-[#0b0d10] px-2 py-1.5 text-sm text-slate-100"
              />
            </label>
            {dateMode === "range" && (
              <label
                className="text-[11px] text-slate-400"
                title="Duration end. Independent of From. Up to 7 days uses the range-of-days product."
              >
                To
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  max={addDays(startDate, 6)}
                  disabled={scoring}
                  onChange={(e) => onToDate(e.target.value)}
                  className="mt-0.5 block rounded-md border border-[#2a313c] bg-[#0b0d10] px-2 py-1.5 text-sm text-slate-100"
                />
              </label>
            )}
            <label className="text-[11px] text-slate-400" title="Hour for air tiles, shade, and comfort. Duration uses the day or the To window.">
              Hour
              <select
                value={startTime}
                disabled={scoring}
                onChange={(e) => onHourChange(e.target.value)}
                className="mt-0.5 block rounded-md border border-[#2a313c] bg-[#0b0d10] px-2 py-1.5 text-sm text-slate-100"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
            {dateMode === "range" && (
              <div className="text-[11px] text-slate-400">
                <span className="block">Preview</span>
                <button
                  type="button"
                  disabled={scoring}
                  onClick={toggleHourPlay}
                  title="Cycles Hour only. Does not run Score."
                  className={`mt-0.5 block rounded-md px-2.5 py-1.5 text-sm font-medium ${
                    hourPlaying ? "bg-cyan-400 text-[#0b0d10]" : "border border-[#2a313c] bg-[#0b0d10] text-slate-300 hover:text-cyan-100"
                  }`}
                >
                  {hourPlaying ? "Pause" : "Play"}
                </button>
              </div>
            )}
            {hourStale && <p className="pb-1.5 text-[10px] leading-snug text-amber-200">Score to load this hour</p>}
          </div>
          <div className="flex shrink-0 items-end gap-2">
            <button
              type="button"
              disabled={!areaOk || scoring}
              onClick={() => void onAnalyze(startTime)}
              className="shrink-0 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-[#0b0d10] transition hover:bg-cyan-300 disabled:opacity-35"
            >
              {scoring ? "Scoring…" : "Score area"}
            </button>
            {analysis && exportBundle && (
              <ExportMenu
                hasTiles={Boolean(tilesFeatureCollection(analysis))}
                hasBrief={Boolean(analysis.memo && !analysis.memo.trim().startsWith("{"))}
                copied={copied}
                onScorecard={() => downloadScorecardJson(exportBundle)}
                onAoi={() => downloadAoiGeoJson(exportBundle)}
                onBrief={() => downloadPlannerBrief(exportBundle)}
                onTiles={() => downloadTilesGeoJson(exportBundle)}
                onCopyBrief={() => {
                  if (!analysis.memo) return;
                  void copyText(analysis.memo).then((ok) => {
                    if (ok) flashCopied("brief");
                  });
                }}
                onCopyLink={() => {
                  const url = `${window.location.origin}${sharePath(
                    exportBundle.bbox,
                    startDate,
                    startTime,
                    dateMode === "range" ? endDate : null,
                  )}`;
                  void copyText(url).then((ok) => {
                    if (ok) flashCopied("link");
                  });
                }}
              />
            )}
            {!dockOpen && (
              <button
                type="button"
                onClick={() => setDockOpen(true)}
                className="heatcast-glass hidden min-h-11 shrink-0 flex-col items-start justify-center rounded-lg px-3 py-1.5 text-left text-slate-200 hover:text-cyan-100 lg:flex"
                aria-expanded={false}
                aria-label="Show scorecard"
                title="Show scorecard"
              >
                <span className="text-xs font-semibold">Scorecard</span>
                {analysis ? (
                  <span className="text-[10px] font-normal leading-tight text-slate-400">
                    {dockTab === "range"
                      ? "Range"
                      : dockTab === "place"
                        ? "Place"
                        : dockTab === "brief"
                          ? "Brief"
                          : showRangeTab
                            ? "Day"
                            : "Duration"}
                  </span>
                ) : null}
              </button>
            )}
          </div>
        </div>
        {dateMode === "range" && (
          <p className="text-[10px] leading-snug text-slate-500">
            Hours/streak use this window (max 7 days). Air tiles use From + Hour. Preview hour — Score to fetch tiles.
            ΔT uses From vs To at the scored Hour. Play does not recompute ΔT.
          </p>
        )}
      </header>

      <div className="absolute left-4 top-40 z-20 flex w-[10.25rem] flex-col gap-2">
        <ToolRail
          interaction={interaction}
          onInteraction={(v) => {
            setInteraction(v);
            if (v === "draw") setPlantMode(false);
          }}
          volume={volume}
          onVolume={onVolume}
          onResetView={() => setResetViewTick((n) => n + 1)}
          sviAvailable={Boolean(svi?.features.length) || sviBusy}
          sviBusy={sviBusy}
          sviOn={sviOn}
          onSviOn={setSviOn}
          contoursAvailable={Boolean(analysis && !analysis.coverage_miss)}
          contoursOn={contoursOn}
          onContoursOn={setContoursOn}
          shadeAvailable={Boolean(analysis)}
          shadeBusy={buildingsBusy}
          shadeOn={shadeOn}
          onShadeOn={(v) => {
            setShadeOn(v);
            if (v && aoi && !buildings?.features?.length && !buildingsBusy) void loadOsm(aoi);
          }}
          coolingAvailable={Boolean(analysis)}
          coolingBusy={coolingBusy}
          coolingOn={coolingOn}
          onCoolingOn={(v) => {
            setCoolingOn(v);
            if (v && aoi && !coolingSites.length && !coolingBusy) void loadOsm(aoi);
          }}
          walkAvailable={Boolean(walkRoute?.coordinates?.length)}
          walkOn={walkOn}
          onWalkOn={setWalkOn}
          plantMode={plantMode}
          plantAvailable={Boolean(analysis && !analysis.coverage_miss)}
          onPlantMode={(v) => {
            setPlantMode(v);
            if (v) {
              setInteraction("pan");
              setPlantHint(true);
            }
          }}
          osmError={osmError}
          onRetryOsm={() => {
            if (aoi && !buildingsBusy && !coolingBusy) void loadOsm(aoi);
          }}
        />
        {aoi && (
          <div className="heatcast-glass flex flex-col gap-1 rounded-xl p-2">
            <p className="px-1 text-[10px] uppercase tracking-wide text-slate-500">Area</p>
            <p className={`px-1 font-mono text-xs ${area > MAX_AREA_MI2 ? "text-rose-300" : "text-slate-200"}`}>
              {area.toFixed(2)} mi²
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setAoi(expandBBox(aoi, 0.8))}
                className="flex-1 rounded-md bg-[#0b0d10] px-2 py-1 text-[11px] text-slate-300 hover:text-cyan-200"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => setAoi(expandBBox(aoi, 1.25))}
                className="flex-1 rounded-md bg-[#0b0d10] px-2 py-1 text-[11px] text-slate-300 hover:text-cyan-200"
              >
                +
              </button>
            </div>
            {area > MAX_AREA_MI2 && (
              <button
                type="button"
                onClick={() => setAoi(shrinkToMax(aoi))}
                className="rounded-md bg-cyan-400 px-2 py-1 text-[11px] font-medium text-[#0b0d10]"
              >
                Fit {MAX_AREA_MI2} mi²
              </button>
            )}
            {walkOn && walkDest && walkMinutes != null && walkRoute?.coordinates?.length ? (
              <p className="min-w-0 border-t border-[#2a313c] px-1 pt-1.5 text-[11px] leading-snug text-teal-100">
                <span className="block break-words">Hotspot → {walkDest.name}</span>
                <span className="text-teal-200/90">{walkMinutes} min</span>
              </p>
            ) : null}
          </div>
        )}
        <button
          type="button"
          onClick={() => setGuideStep(0)}
          className="heatcast-glass rounded-xl px-3 py-2 text-[11px] text-slate-300 hover:text-cyan-200"
        >
          How to
        </button>
        <p className="pointer-events-none px-1 text-[11px] leading-snug text-slate-500">
          {interaction === "draw"
            ? "Draw a box, then Score. Isolines sit on the heat; SVI is violet; the dashed line is a walk to indoor cool space."
            : plantMode
              ? "Click the map to plant a scenario tree on the hottest fabric. Not a new satellite run."
              : interaction === "orbit"
                ? "Drag to orbit. Scroll zooms. Toggle Isolines, SVI, Shade, Cooling, and Walk in Layers."
                : "Pan the map. Right-drag orbits. Plant trees or follow the walk after you score."}
        </p>
      </div>

      {error && (
        <p className="absolute left-1/2 top-36 z-20 max-w-md -translate-x-1/2 rounded-lg border border-rose-900 bg-rose-950/80 px-3 py-2 text-xs text-rose-100">
          {error}
        </p>
      )}

      {scoring && <AnalyzeOverlay hasHeat={Boolean(analysis)} />}

      {dockOpen && (
        <div className="pointer-events-none absolute bottom-4 right-4 top-40 z-20 hidden items-start lg:flex">
          <RightDrawer
            onHide={() => setDockOpen(false)}
            tab={analysis ? dockTab : "duration"}
            onTab={setDockTab}
            showTabs={Boolean(analysis)}
            showRangeTab={showRangeTab}
          >
            {(!analysis || dockTab === "duration") && durationBody}
            {analysis && showRangeTab && dockTab === "range" && rangeBody}
            {analysis && dockTab === "place" && placeBody}
            {analysis && dockTab === "brief" && briefBody}
          </RightDrawer>
        </div>
      )}

      {sheetOpen ? (
        <div className="heatcast-glass pointer-events-auto absolute bottom-4 left-4 right-4 z-20 flex max-h-[min(34rem,58dvh)] flex-col rounded-xl lg:hidden">
          <div className="flex items-center gap-2 border-b border-[#2a313c] px-2 py-1.5">
            <DockTabs
              tabs={
                analysis
                  ? [
                      ...(showRangeTab ? [{ id: "range" as const, label: "Range" }] : []),
                      { id: "duration" as const, label: showRangeTab ? "Day" : "Duration" },
                      { id: "place" as const, label: "Place" },
                      { id: "brief" as const, label: "Brief" },
                    ]
                  : [{ id: "duration" as const, label: "Duration" }]
              }
              value={analysis ? mobileTab : "duration"}
              onChange={(id) => {
                if (id === "place" || id === "brief" || id === "duration" || id === "range") setMobileTab(id);
              }}
            />
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              className="ml-auto shrink-0 px-2 text-xs text-slate-500 hover:text-slate-200"
            >
              Hide
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
            {mobileTab === "duration" && durationBody}
            {mobileTab === "range" && showRangeTab && rangeBody}
            {mobileTab === "place" && placeBody}
            {mobileTab === "brief" && briefBody}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="heatcast-glass absolute bottom-4 right-4 z-20 rounded-xl px-3 py-2 text-xs text-slate-200 lg:hidden"
        >
          Scorecard
        </button>
      )}

      {plantMode && plantHint && (
        <div className="heatcast-glass absolute bottom-16 left-1/2 z-30 flex w-[min(320px,calc(100%-2rem))] -translate-x-1/2 items-start gap-2 rounded-xl px-3 py-2 text-[11px] text-lime-100">
          <p className="flex-1 leading-snug">
            Click the map to sketch trees. Pins are visual; cooling still comes from the canopy slider.
          </p>
          <button
            type="button"
            className="shrink-0 text-slate-400 hover:text-slate-100"
            onClick={() => setPlantHint(false)}
          >
            Dismiss
          </button>
        </div>
      )}
      {guideStep != null && (
        <GuideCard
          step={guideStep}
          onNext={() => {
            if (guideStep === 1) setInteraction("draw");
            if (guideStep === 3) {
              setInteraction("orbit");
              setVolume(true);
            }
            if (guideStep >= GUIDE_STEPS.length - 1) {
              try {
                window.localStorage.setItem("heatcast-guide-v1", "done");
              } catch {
                /* ignore */
              }
              setGuideStep(null);
              return;
            }
            setGuideStep(guideStep + 1);
          }}
          onSkip={() => {
            try {
              window.localStorage.setItem("heatcast-guide-v1", "done");
            } catch {
              /* ignore */
            }
            setGuideStep(null);
          }}
        />
      )}
    </div>
  );
}

function RightDrawer({
  onHide,
  tab,
  onTab,
  showTabs,
  showRangeTab,
  children,
}: {
  onHide: () => void;
  tab: DockTab;
  onTab: (id: DockTab) => void;
  showTabs: boolean;
  showRangeTab: boolean;
  children?: ReactNode;
}) {
  return (
    <aside className="heatcast-glass pointer-events-auto flex h-full min-h-0 w-[21rem] flex-col rounded-xl">
      <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
        {showTabs ? (
          <DockTabs
            tabs={[
              ...(showRangeTab ? [{ id: "range" as const, label: "Range" }] : []),
              { id: "duration", label: showRangeTab ? "Day" : "Duration" },
              { id: "place", label: "Place" },
              { id: "brief", label: "Brief" },
            ]}
            value={tab}
            onChange={(id) => {
              if (id === "place" || id === "brief" || id === "duration" || id === "range") onTab(id);
            }}
          />
        ) : (
          <span className="flex-1 px-1 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">Duration</span>
        )}
        <button
          type="button"
          onClick={onHide}
          className="shrink-0 rounded-md p-1.5 text-slate-500 hover:text-slate-200"
          aria-expanded
          aria-label="Hide scorecard"
          title="Hide scorecard"
        >
          <Chevron open />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">{children}</div>
    </aside>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={`h-3 w-3 text-slate-500 transition-transform ${open ? "rotate-0" : "-rotate-90"}`}
      aria-hidden
    >
      <path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function DockTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 gap-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`flex-1 rounded-md px-2 py-1 text-[10px] font-medium uppercase tracking-wide ${
            value === tab.id ? "bg-cyan-400 text-[#0b0d10]" : "bg-[#0b0d10] text-slate-400 hover:text-cyan-100"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function GuideCard({
  step,
  onNext,
  onSkip,
}: {
  step: number;
  onNext: () => void;
  onSkip: () => void;
}) {
  const current = GUIDE_STEPS[step] ?? GUIDE_STEPS[0];
  const last = step >= GUIDE_STEPS.length - 1;
  return (
    <div className="heatcast-glass absolute bottom-16 left-1/2 z-40 w-[min(380px,calc(100%-2rem))] -translate-x-1/2 rounded-2xl p-4 shadow-2xl">
      <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-cyan-400">
        {step + 1} / {GUIDE_STEPS.length}
      </p>
      <h2 className="mt-1 text-base font-semibold text-slate-50">{current.title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-300">{current.body}</p>
      <div className="mt-4 flex items-center justify-between gap-2">
        <button type="button" onClick={onSkip} className="text-xs text-slate-500 hover:text-slate-200">
          Skip guide
        </button>
        <button
          type="button"
          onClick={onNext}
          className="rounded-lg bg-cyan-400 px-3 py-1.5 text-sm font-semibold text-[#0b0d10]"
        >
          {last ? "Start exploring" : "Next"}
        </button>
      </div>
    </div>
  );
}

function ToolRail({
  interaction,
  onInteraction,
  volume,
  onVolume,
  onResetView,
  sviAvailable,
  sviBusy,
  sviOn,
  onSviOn,
  contoursAvailable,
  contoursOn,
  onContoursOn,
  shadeAvailable,
  shadeBusy,
  shadeOn,
  onShadeOn,
  coolingAvailable,
  coolingBusy,
  coolingOn,
  onCoolingOn,
  walkAvailable,
  walkOn,
  onWalkOn,
  plantMode,
  plantAvailable,
  onPlantMode,
  osmError,
  onRetryOsm,
}: {
  interaction: Interaction;
  onInteraction: (v: Interaction) => void;
  volume: boolean;
  onVolume: (v: boolean) => void;
  onResetView: () => void;
  sviAvailable: boolean;
  sviBusy?: boolean;
  sviOn: boolean;
  onSviOn: (v: boolean) => void;
  contoursAvailable: boolean;
  contoursOn: boolean;
  onContoursOn: (v: boolean) => void;
  shadeAvailable: boolean;
  shadeBusy?: boolean;
  shadeOn: boolean;
  onShadeOn: (v: boolean) => void;
  coolingAvailable: boolean;
  coolingBusy?: boolean;
  coolingOn: boolean;
  onCoolingOn: (v: boolean) => void;
  walkAvailable: boolean;
  walkOn: boolean;
  onWalkOn: (v: boolean) => void;
  plantMode: boolean;
  plantAvailable: boolean;
  onPlantMode: (v: boolean) => void;
  osmError?: string | null;
  onRetryOsm?: () => void;
}) {
  const tool = (active: boolean) =>
    `rounded-md px-2 py-1.5 text-[11px] font-medium ${
      active ? "bg-cyan-400 text-[#0b0d10]" : "bg-[#0b0d10] text-slate-300 hover:text-cyan-100"
    }`;
  return (
    <div className="heatcast-glass flex w-[10.25rem] flex-col gap-2 rounded-xl p-2">
      <div>
        <p className="px-1 pb-1 text-[9px] font-medium uppercase tracking-[0.16em] text-slate-500">Tools</p>
        <div className="flex flex-col gap-1">
          <button type="button" className={tool(interaction === "pan")} onClick={() => onInteraction("pan")} title="Left-drag pans. Right-drag or Ctrl-drag orbits.">
            Pan
          </button>
          <button type="button" className={tool(interaction === "draw")} onClick={() => onInteraction("draw")} title="Left-drag draws a box. Scroll still zooms.">
            Draw area
          </button>
          <button type="button" className={tool(interaction === "orbit")} onClick={() => onInteraction("orbit")} title="Left-drag orbits around the scored area.">
            Orbit
          </button>
          <button
            type="button"
            className={`${tool(plantMode)} disabled:cursor-not-allowed disabled:opacity-40`}
            disabled={!plantAvailable}
            onClick={() => onPlantMode(!plantMode)}
            title={plantAvailable ? "Click the map to sketch trees. Scenario only." : "Score an area first"}
          >
            Plant trees
          </button>
          <button type="button" className={tool(false)} onClick={onResetView} title={volume ? "Fit the area and restore a 3D viewing angle." : "Fit the area from above (pitch 0)."}>
            Reset view
          </button>
        </div>
      </div>
      <div className="h-px bg-[#2a313c]" />
      <div>
        <p className="px-1 pb-1 text-[9px] font-medium uppercase tracking-[0.16em] text-slate-500">View</p>
        <div className="flex gap-1">
          <button type="button" className={`${tool(!volume)} flex-1`} onClick={() => onVolume(false)} title="Top-down. Pitch eases to 0.">
            Flat
          </button>
          <button type="button" className={`${tool(volume)} flex-1`} onClick={() => onVolume(true)}>
            3D heat
          </button>
        </div>
      </div>
      <div className="h-px bg-[#2a313c]" />
      <div>
        <p className="px-1 pb-1 text-[9px] font-medium uppercase tracking-[0.16em] text-slate-500">Layers</p>
        <LayerSwitch
          label="Isolines"
          hint="White temperature contours on the heat field"
          swatch="#e2e8f0"
          on={contoursOn}
          disabled={!contoursAvailable}
          disabledHint="Score an area first"
          onToggle={onContoursOn}
        />
        <LayerSwitch
          label={sviBusy && !sviAvailable ? "SVI…" : "SVI"}
          hint="CDC social vulnerability tracts"
          swatch="#818cf8"
          on={sviOn}
          disabled={!sviAvailable && !sviBusy}
          disabledHint="Score an area to load tracts"
          onToggle={onSviOn}
        />
        <LayerSwitch
          label={shadeBusy ? "Shade…" : "Shade"}
          hint="OSM building shadows at the scored hour"
          swatch="#94a3b8"
          on={shadeOn}
          disabled={!shadeAvailable}
          disabledHint="Score an area first"
          onToggle={onShadeOn}
        />
        <LayerSwitch
          label={coolingBusy ? "Cooling…" : "Cooling"}
          hint="OSM libraries and community centres — not an official registry"
          swatch="#2dd4bf"
          on={coolingOn}
          disabled={!coolingAvailable}
          disabledHint="Score an area first"
          onToggle={onCoolingOn}
        />
        <LayerSwitch
          label="Walk"
          hint="Walking line from the hotspot to the nearest library or community centre"
          swatch="#5eead4"
          on={walkOn}
          disabled={!walkAvailable}
          disabledHint="Needs a hotspot and an indoor site"
          onToggle={onWalkOn}
        />
        {osmError && (
          <button
            type="button"
            onClick={onRetryOsm}
            className="mt-1 w-full rounded-md px-2 py-1 text-left text-[10px] leading-snug text-amber-200 hover:bg-white/5"
            title={osmError}
          >
            OSM busy — tap to retry shade & cooling
          </button>
        )}
      </div>
    </div>
  );
}

function LayerSwitch({
  label,
  hint,
  swatch,
  on,
  disabled,
  disabledHint,
  onToggle,
}: {
  label: string;
  hint: string;
  swatch: string;
  on: boolean;
  disabled: boolean;
  disabledHint: string;
  onToggle: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      title={disabled ? disabledHint : hint}
      onClick={() => onToggle(!on)}
      className={`mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] ${
        disabled
          ? "cursor-not-allowed opacity-40"
          : on
            ? "bg-cyan-400/10 text-slate-100 ring-1 ring-inset ring-cyan-400/40"
            : "text-slate-400 hover:bg-white/5"
      }`}
    >
      <span
        className="relative h-4 w-7 shrink-0 rounded-full transition-colors"
        style={{ background: disabled ? "#2a313c" : on ? swatch : "#2a313c" }}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-[left] ${on && !disabled ? "left-3.5" : "left-0.5"}`}
        />
      </span>
      <span className="flex-1 leading-tight">{label}</span>
    </button>
  );
}

function AnalyzeOverlay({ hasHeat }: { hasHeat: boolean }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timers = ANALYZE_STEPS.slice(1).map((s, i) => window.setTimeout(() => setStep(i + 1), s.at));
    return () => timers.forEach(clearTimeout);
  }, []);

  const current = ANALYZE_STEPS[step] ?? ANALYZE_STEPS[0];

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {!hasHeat && <div className="absolute inset-0 bg-[#0b0d10]/20" />}
      <div className="absolute left-1/2 top-36 w-[min(360px,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-cyan-400/25 bg-[#161a20]/92 px-4 py-3 shadow-lg backdrop-blur-md">
        <p className="text-[11px] font-medium tracking-wide text-cyan-100">{current.label}</p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#2a313c]">
          <div className="heatcast-progress h-full rounded-full bg-cyan-400" style={{ width: `${current.pct}%` }} />
        </div>
        {hasHeat && <p className="mt-1.5 text-[10px] text-slate-500">Previous score stays on the map</p>}
      </div>
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <div className="space-y-2 rounded-lg border border-[#2a313c] bg-[#0b0d10] p-3">
      <div className="h-3 w-24 animate-pulse rounded bg-[#2a313c]" />
      <div className="grid grid-cols-2 gap-2">
        <div className="h-14 animate-pulse rounded-md bg-[#161a20]" />
        <div className="h-14 animate-pulse rounded-md bg-[#161a20]" />
      </div>
    </div>
  );
}

function RainComfortRow({
  rain,
  flood,
  elevationM,
  comfort,
  shade,
  rangeDays,
}: {
  rain: RainContext | null;
  flood?: { zone?: string | null; subtype?: string | null } | null;
  elevationM?: number | null;
  comfort: ComfortContext | null;
  shade: ShadeMeta | null;
  rangeDays?: number;
}) {
  const mm = rain?.daily_precip_mm;
  const hi = comfort?.heat_index_c;
  const cat = comfort?.category;
  return (
    <section className="rounded-lg border border-[#2a313c] bg-[#0b0d10] px-3 py-2 text-[11px] text-slate-300">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`font-mono ${mm != null && mm >= 1 ? "text-sky-100" : "text-slate-300"}`}>
          {mm == null ? "precip —" : `${mm} mm`}
        </span>
        {flood?.zone && <span className="text-slate-400">FEMA {flood.zone}</span>}
        {elevationM != null && <span className="font-mono text-slate-500">{Math.round(elevationM)} m</span>}
        {hi != null && (
          <span className="font-mono text-slate-100">
            {hi.toFixed(1)}°C NWS{cat ? ` · ${cat}` : ""}
          </span>
        )}
        {shade && (
          <span className="text-slate-400">
            {shade.night ? "no shade (night)" : `~${Math.round(shade.shadowM ?? 0)} m shade`}
          </span>
        )}
      </div>
      {rangeDays && rangeDays > 1 ? (
        <p className="mt-1 text-[10px] leading-snug text-slate-600">Precip is the From date, not the full window.</p>
      ) : null}
    </section>
  );
}

function ScenarioPanel({
  canopyDelta,
  onChange,
  currentCanopy,
  live,
}: {
  canopyDelta: number;
  onChange: (n: number) => void;
  currentCanopy: number | null;
  live: ReturnType<typeof estimateScenario> | null;
}) {
  const selectedDt = incrementDeltaC(canopyDelta, currentCanopy);
  return (
    <section className="space-y-2 rounded-lg border border-cyan-900/40 bg-[#0b0d10] p-3">
      <h3 className="text-[10px] uppercase tracking-wide text-cyan-400">Tree canopy (sketch)</h3>
      <p className="text-[11px] leading-snug text-slate-400">
        Literature overlay on the air tiles — the heatmap is not recomputed. LST cooling is much larger
        (Du 2024: air ~0.006 vs LST ~0.075 °C per 1% canopy); this slider uses air CE 0.015 °C per 1%
        (0.010–0.020).
        {currentCanopy != null ? ` Satellite canopy now ${currentCanopy.toFixed(0)}%.` : ""}
      </p>
      <div className="flex gap-2">
        {CANOPY_STEPS.map((n) => {
          const dt = incrementDeltaC(n, currentCanopy);
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs ${
                canopyDelta === n ? "bg-cyan-400 text-[#0b0d10]" : "bg-[#161a20]"
              }`}
            >
              <span className="block">{n === 0 ? "Baseline" : `+${n}%`}</span>
              <span className={`block font-mono text-[10px] ${canopyDelta === n ? "text-[#0b0d10]/80" : "text-slate-500"}`}>
                {dt > 0 ? `−${dt.toFixed(2)} °C` : "0.00 °C"}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-300">
        Selected {canopyDelta === 0 ? "baseline" : `+${canopyDelta}% canopy`}: estimated Δ{" "}
        <span className="font-mono text-cyan-100">
          {selectedDt > 0 ? `−${selectedDt.toFixed(2)}` : "0.00"} °C
        </span>
        {live && live.canopy_delta_pct > 0
          ? ` air (range −${live.estimated_delta_c_range.low.toFixed(2)} to −${live.estimated_delta_c_range.high.toFixed(2)} °C).`
          : " air."}{" "}
        Not LST.
      </p>
      {live && live.canopy_delta_pct > 0 && (
        <dl className="grid grid-cols-2 gap-2 text-center text-xs">
          <Stat label="Est. ΔT (air)" value={`−${live.estimated_delta_c.toFixed(2)} °C`} />
          <Stat
            label="Hours saved (est.)"
            value={live.estimated_hours_saved == null ? "—" : `${live.estimated_hours_saved} h`}
          />
        </dl>
      )}
      <p className="text-[10px] leading-snug text-slate-500">
        <a className="text-cyan-300/90 hover:underline" href={CITATIONS[0].url} target="_blank" rel="noreferrer">
          Du 2024
        </a>
        {" · "}
        <a className="text-cyan-300/90 hover:underline" href={CITATIONS[1].url} target="_blank" rel="noreferrer">
          Tacoma air
        </a>
        {" · "}
        <a className="text-cyan-300/90 hover:underline" href={CITATIONS[2].url} target="_blank" rel="noreferrer">
          Wang LST
        </a>
        {" · "}
        <a className="text-cyan-300/90 hover:underline" href={CITATIONS[3].url} target="_blank" rel="noreferrer">
          Yang LST
        </a>
        — LST cites unused.
      </p>
    </section>
  );
}

function Scorecard({
  analysis,
  scenario,
  dateWindow,
  variant,
}: {
  analysis: AnalyzeResponse;
  scenario: ReturnType<typeof estimateScenario> | null;
  dateWindow: ReturnType<typeof durationWindow>;
  variant: "full" | "snapshot" | "range";
}) {
  const s = analysis.scorecard;
  const meanShown =
    scenario && scenario.canopy_delta_pct > 0 && scenario.estimated_mean_c != null
      ? scenario.estimated_mean_c
      : s.mean_c;
  const sharePct = shareToPercent(s.share_above_threshold);
  const hasHours = s.mean_hours_above != null || s.max_hours_above != null;
  const hasStreak = s.mean_streak_hours != null || s.max_streak_hours != null;
  const showDurationBars = hasHours || hasStreak;
  const hourSamples = extractHours(analysis.exceedance?.heatmap?.features);
  const histKind = hourSamples.length ? "hours" : "temp";
  const histSamples = hourSamples.length ? hourSamples : extractTemps(analysis.heatmap?.features);
  const hotspotHours =
    histKind === "hours" ? hoursAtHotspot(analysis.exceedance?.heatmap?.features, analysis.hotspot) : null;
  const durationCaption =
    analysis.confidence.duration_note ||
    (dateWindow.filterType === 3
      ? "Duration is one day on this API."
      : `Duration is a ${dateWindow.days}-day window (range-of-days product).`);
  const rangeLabel = `${dateWindow.startDate} → ${dateWindow.endDate ?? dateWindow.startDate}`;

  if (variant === "snapshot") {
    return (
      <section className="space-y-2 rounded-lg border border-[#2a313c] bg-[#0b0d10] p-3">
        <h3 className="text-[10px] uppercase tracking-wide text-cyan-400">Scorecard</h3>
        {analysis.coverage_miss && <p className="text-xs text-amber-200">{analysis.warning}</p>}
        <dl className="grid grid-cols-2 gap-1.5 text-center text-[11px]">
          <Stat label={scenario && scenario.canopy_delta_pct > 0 ? "Mean °C (est.)" : "Mean °C"} value={num(meanShown, "°C")} />
          <Stat label="Max °C" value={num(s.max_c, "°C")} />
        </dl>
        <p className="text-[10px] leading-snug text-slate-500">
          Mean and max for From + Hour only. Hours, streak, and the histogram are on the Range tab.{" "}
          {analysis.aoi_area_mi2.toFixed(2)} mi².
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2 rounded-lg border border-[#2a313c] bg-[#0b0d10] p-3">
      <h3 className="text-[10px] uppercase tracking-wide text-cyan-400">
        {variant === "range" ? `Duration for ${rangeLabel}` : "Scorecard"}
      </h3>
      {variant === "range" && (
        <p className="text-[11px] leading-snug text-slate-400">
          API range-of-days product (max 7 days), not a custom multi-day analytic.
        </p>
      )}
      {analysis.coverage_miss && <p className="text-xs text-amber-200">{analysis.warning}</p>}
      {variant === "full" && (
        <dl className="grid grid-cols-2 gap-1.5 text-center text-[11px]">
          <Stat label={scenario && scenario.canopy_delta_pct > 0 ? "Mean °C (est.)" : "Mean °C"} value={num(meanShown, "°C")} />
          <Stat label="Max °C" value={num(s.max_c, "°C")} />
        </dl>
      )}
      {(sharePct != null || showDurationBars || histSamples.length > 0) && (
        <div className={`space-y-2 ${variant === "full" ? "border-t border-[#2a313c] pt-2" : ""}`}>
          {sharePct != null && (
            <ShareBar pct={sharePct} thresholdC={s.threshold_c} />
          )}
          {showDurationBars && (
            <DurationCompare
              hoursMean={s.mean_hours_above}
              hoursMax={s.max_hours_above}
              streakMean={s.mean_streak_hours}
              streakMax={s.max_streak_hours}
            />
          )}
          {histSamples.length > 0 && (
            <HoursHistogram
              values={histSamples}
              kind={histKind}
              meanHours={histKind === "hours" ? s.mean_hours_above : null}
              hotspotHours={hotspotHours}
            />
          )}
          <UnrelievedChip scorecard={s} />
        </div>
      )}
      {!(sharePct != null || showDurationBars || histSamples.length > 0) && <UnrelievedChip scorecard={s} />}
      <p className="text-[10px] leading-snug text-slate-500">
        Hours = total time above threshold. Streak = longest consecutive run. {analysis.aoi_area_mi2.toFixed(2)} mi².{" "}
        {variant === "range"
          ? "Hours/streak use this window (max 7 days). Air tiles use From + Hour."
          : durationCaption}
      </p>
    </section>
  );
}

function ShareBar({ pct, thresholdC }: { pct: number; thresholdC: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-sm text-cyan-100">{pct}%</p>
        <p className="text-[10px] uppercase tracking-wide text-slate-500">
          of tiles ≥ {compactNum(thresholdC)} °C
        </p>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-[#161a20]"
        role="img"
        aria-label={`${pct} percent of tiles at or above ${compactNum(thresholdC)} degrees C`}
      >
        <div className="h-full rounded-full bg-cyan-400" style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
      </div>
    </div>
  );
}

function DurationCompare({
  hoursMean,
  hoursMax,
  streakMean,
  streakMax,
}: {
  hoursMean: number | null | undefined;
  hoursMax: number | null | undefined;
  streakMean: number | null | undefined;
  streakMax: number | null | undefined;
}) {
  const peak = Math.max(hoursMean ?? 0, hoursMax ?? 0, streakMean ?? 0, streakMax ?? 0, 0.01);
  const h = hoursMean;
  const st = streakMean;
  const caption =
    h != null && st != null
      ? `${compactNum(h)} h total can still be a ${compactNum(st)} h streak.`
      : "Hours = total time above threshold; streak = longest consecutive run.";
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-3">
        <BarPair title="Hours above" mean={hoursMean} max={hoursMax} peak={peak} fill="#3dd6c6" />
        <BarPair title="Longest streak" mean={streakMean} max={streakMax} peak={peak} fill="#2dd4bf" />
      </div>
      <p className="text-[10px] leading-snug text-slate-500">{caption}</p>
    </div>
  );
}

function BarPair({
  title,
  mean,
  max,
  peak,
  fill,
}: {
  title: string;
  mean: number | null | undefined;
  max: number | null | undefined;
  peak: number;
  fill: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{title}</p>
      <MiniBar label="Mean" value={mean} peak={peak} fill={fill} />
      <MiniBar label="Max" value={max} peak={peak} fill={fill} dim />
    </div>
  );
}

function MiniBar({
  label,
  value,
  peak,
  fill,
  dim,
}: {
  label: string;
  value: number | null | undefined;
  peak: number;
  fill: string;
  dim?: boolean;
}) {
  const pct = value == null ? 0 : Math.max(2, Math.min(100, (value / peak) * 100));
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-8 shrink-0 text-[10px] uppercase text-slate-500">{label}</span>
      <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded bg-[#161a20]" aria-hidden={value == null}>
        {value != null && (
          <div
            className="h-full rounded"
            style={{ width: `${pct}%`, background: fill, opacity: dim ? 0.55 : 1 }}
          />
        )}
      </div>
      <span className="w-10 shrink-0 text-right font-mono text-[10px] text-slate-200">
        {value == null ? "—" : `${compactNum(value)} h`}
      </span>
    </div>
  );
}

function HoursHistogram({
  values,
  kind,
  meanHours,
  hotspotHours,
}: {
  values: number[];
  kind: "hours" | "temp";
  meanHours: number | null | undefined;
  hotspotHours: number | null;
}) {
  if (!values.length) return null;
  const bins = binValues(values, 8);
  if (!bins.length) return null;
  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const lo = bins[0].x0;
  const hi = bins[bins.length - 1].x1;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const span = hi - lo || 1;
  const unit = kind === "hours" ? "h" : "°C";
  const caption = iqrCaption(values, kind);
  const ticks: Array<{ at: number; label: string }> = [];
  const inRange = (v: number) => v >= lo - 1e-6 && v <= hi + 1e-6;
  if (kind === "hours" && meanHours != null && Number.isFinite(meanHours) && inRange(meanHours)) {
    ticks.push({ at: meanHours, label: "District mean" });
  }
  if (kind === "hours" && hotspotHours != null && Number.isFinite(hotspotHours) && inRange(hotspotHours)) {
    ticks.push({ at: hotspotHours, label: "Hotspot" });
  }
  const w = 280;
  const h = 88;
  const padL = 4;
  const padR = 4;
  const padT = 16;
  const padB = 16;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const gap = 2;
  const barW = Math.max(4, (innerW - gap * (bins.length - 1)) / bins.length);
  const xFor = (v: number) => padL + ((v - lo) / span) * innerW;
  const tickFallback = ticks
    .map((t) => `${t.label} ${compactNum(t.at)} ${unit}`)
    .join(" · ");
  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-auto w-full"
        role="img"
        aria-label={
          kind === "hours"
            ? `Hours-above histogram. ${tickFallback || caption || ""}`
            : `Temperature histogram. ${caption || ""}`
        }
      >
        {bins.map((bin, i) => {
          const bh = (bin.count / maxCount) * innerH;
          const x = padL + i * (barW + gap);
          const y = padT + innerH - bh;
          return (
            <rect
              key={`${bin.x0}:${bin.x1}`}
              x={x}
              y={y}
              width={barW}
              height={Math.max(bh, bin.count ? 1.5 : 0)}
              rx={1}
              fill="#3dd6c6"
              opacity={0.85}
            />
          );
        })}
        {ticks.map((tick, i) => {
          const x = Math.min(w - padR, Math.max(padL, xFor(tick.at)));
          const labelY = i === 1 && ticks.length === 2 && Math.abs(xFor(ticks[0].at) - x) < 48 ? 11 : 9;
          const anchor = x > w * 0.72 ? "end" : x < w * 0.28 ? "start" : "middle";
          return (
            <g key={tick.label}>
              <line x1={x} y1={padT - 2} x2={x} y2={padT + innerH} stroke="#e8edf4" strokeWidth={1} opacity={0.7} />
              <text x={x} y={labelY} textAnchor={anchor} fill="#94a3b8" fontSize={10}>
                {tick.label}
              </text>
            </g>
          );
        })}
        <text x={padL} y={h - 3} fill="#64748b" fontSize={9} fontFamily="ui-monospace, monospace">
          {compactNum(lo)}
        </text>
        <text x={w / 2} y={h - 3} textAnchor="middle" fill="#64748b" fontSize={9} fontFamily="ui-monospace, monospace">
          {kind === "hours" ? "h above" : "°C"}
        </text>
        <text x={w - padR} y={h - 3} textAnchor="end" fill="#64748b" fontSize={9} fontFamily="ui-monospace, monospace">
          {compactNum(hi)}
        </text>
      </svg>
      {tickFallback ? (
        <p className="font-mono text-[10px] text-slate-400">{tickFallback}</p>
      ) : null}
      {caption ? <p className="text-[10px] leading-snug text-slate-500">{caption}</p> : null}
    </div>
  );
}

function SviPanel({
  svi,
  busy,
  selected,
}: {
  svi: SviResponse | null;
  busy: boolean;
  selected: SviTract | null;
}) {
  const top = selected ?? svi?.top_priority?.[0] ?? null;
  const summary = svi?.summary;
  return (
    <section className="space-y-1.5 rounded-lg border border-indigo-900/40 bg-[#0b0d10] p-3">
      <h3 className="text-[10px] uppercase tracking-wide text-indigo-300">Heat × vulnerability</h3>
      {busy && !svi && <p className="text-xs text-slate-500">Loading CDC SVI 2022 tracts…</p>}
      {!busy && !svi && <p className="text-xs text-slate-500">SVI overlay unavailable for this box.</p>}
      {summary && (
        <>
          {top && (
            <p className="text-xs leading-snug text-slate-100">
              <span className="text-[10px] uppercase text-slate-500">
                {selected ? "Selected" : "Highest-priority tract"}
                {" · "}
              </span>
              {top.name}
              <span className="mt-0.5 block font-mono text-[11px] text-indigo-100">
                SVI {top.svi_pct}th
                {top.mean_c != null ? ` · ${top.mean_c.toFixed(1)}°C` : ""}
                {top.priority != null ? ` · priority ${top.priority.toFixed(2)}` : ""}
              </span>
            </p>
          )}
          <p className="text-[11px] leading-snug text-slate-300">{summary.planner_sentence}</p>
          <p className="text-[10px] leading-snug text-slate-500" title={summary.priority_formula}>
            Overlay from{" "}
            <a className="text-indigo-300 hover:underline" href={summary.source_url} target="_blank" rel="noreferrer">
              CDC/ATSDR SVI 2022
            </a>
            .
          </p>
        </>
      )}
    </section>
  );
}

function CoolingPanel({
  sites,
  busy,
  note,
  error,
  walk,
  walkDest,
  walkBusy,
}: {
  sites: CoolingSite[];
  busy: boolean;
  note?: string;
  error?: string | null;
  walk?: WalkRoute | null;
  walkDest?: CoolingSite | null;
  walkBusy?: boolean;
}) {
  const minutes = walk?.duration_s != null ? Math.max(1, Math.round(walk.duration_s / 60)) : null;
  const meters = walk?.distance_m != null ? Math.round(walk.distance_m) : null;
  const shown = sites.slice(0, 5);
  const extra = sites.length - shown.length;
  return (
    <section className="space-y-1.5 rounded-lg border border-teal-900/40 bg-[#0b0d10] p-3">
      <h3 className="text-[10px] uppercase tracking-wide text-teal-300">Indoor cool space</h3>
      {busy && !sites.length && <p className="text-xs text-slate-500">Looking up libraries and community centres…</p>}
      {error && <p className="text-xs text-amber-200">{error}</p>}
      {!busy && !sites.length && !error && (
        <p className="text-xs text-slate-500">No OSM libraries or community centres in this box.</p>
      )}
      {shown.length > 0 && (
        <ul className="space-y-1 text-xs text-slate-200">
          {shown.map((site) => (
            <li key={`${site.lon}:${site.lat}:${site.name}`}>
              <span className="text-teal-200">{site.kind}</span>
              {" · "}
              {site.name}
            </li>
          ))}
        </ul>
      )}
      {extra > 0 && <p className="text-[10px] text-slate-500">+{extra} more</p>}
      {walkBusy && <p className="text-[11px] text-slate-500">Routing a walk from the hotspot…</p>}
      {minutes != null && (
        <p className="text-[11px] text-teal-100">
          ~{minutes} min walk from the hotspot
          {meters != null ? ` · ${meters} m` : ""}
          {walkDest ? ` → ${walkDest.name}` : ""}
        </p>
      )}
      <p className="text-[10px] leading-snug text-slate-500">
        {note || "OpenStreetMap indoor public sites — not an official cooling-center list. Walk uses OSRM."}
      </p>
    </section>
  );
}

function PlantPanel({
  plantMode,
  onPlantMode,
  treeCount,
  onClear,
  onSeedHottest,
}: {
  plantMode: boolean;
  onPlantMode: (v: boolean) => void;
  treeCount: number;
  onClear: () => void;
  onSeedHottest: () => void;
}) {
  return (
    <section className="space-y-1.5 rounded-lg border border-lime-900/40 bg-[#0b0d10] p-3">
      <h3 className="text-[10px] uppercase tracking-wide text-lime-300">Plant trees (scenario)</h3>
      <p className="text-[11px] leading-snug text-slate-400">
        Sketch planting on the hottest tiles. Pins are visual; cooling still comes from the canopy slider, not a new heatmap.
      </p>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onPlantMode(!plantMode)}
          className={`flex-1 rounded-md px-2 py-1.5 text-xs ${
            plantMode ? "bg-lime-400 text-[#0b0d10]" : "bg-[#161a20] text-slate-200"
          }`}
        >
          {plantMode ? "Click map to plant" : "Start planting"}
        </button>
        <button
          type="button"
          onClick={onSeedHottest}
          className="rounded-md bg-[#161a20] px-2 py-1.5 text-xs text-slate-300 hover:text-lime-200"
        >
          Hottest tiles
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={!treeCount}
          className="rounded-md bg-[#161a20] px-2 py-1.5 text-xs text-slate-400 disabled:opacity-40"
        >
          Clear
        </button>
      </div>
      <p className="font-mono text-[11px] text-slate-400">{treeCount} trees sketched</p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[#161a20] px-1 py-2">
      <dt className="text-[10px] uppercase text-slate-500">{label}</dt>
      <dd className="font-mono text-slate-100">{value}</dd>
    </div>
  );
}

function ConfidenceStrip({ analysis }: { analysis: AnalyzeResponse }) {
  const c = analysis.confidence;
  return (
    <section className="rounded-lg border border-[#2a313c] bg-[#0b0d10] px-3 py-2 font-mono text-[11px] text-slate-400">
      <p className="mb-1 font-sans text-[10px] uppercase tracking-wide text-cyan-400">Coverage</p>
      <p>
        {c.cached ? "cached" : "live"} · {c.tile_count} tiles · {c.datetime}
        {c.duration_days != null && c.duration_days > 1 ? ` · ${c.duration_days}d duration` : ""}
      </p>
      <p className="mt-1 font-sans text-[10px] leading-snug text-slate-500">
        {c.duration_note ||
          "Tiles are ~100 m. Hours = total time above threshold; streak = longest consecutive run. Canopy pins are a sketch."}
      </p>
    </section>
  );
}

function blockingEnrichErrors(enrichment: EnrichResponse | null): Array<[string, string]> {
  if (!enrichment?.errors) return [];
  const hasCore = Boolean(enrichment.satellite || enrichment.env_params);
  return Object.entries(enrichment.errors).filter(([name]) => {
    if (name === "streetview" || name === "heat_intelligence") return false;
    if (name === "enrich" && hasCore) return false;
    return true;
  });
}

function HotspotPanel({
  hotspot,
  enrichment,
  busy,
}: {
  hotspot: NonNullable<AnalyzeResponse["hotspot"]>;
  enrichment: EnrichResponse | null;
  busy: boolean;
}) {
  const buckets = enrichment?.satellite?.buckets;
  const hot = enrichment?.env_params?.hot_hour || {};
  return (
    <section className="space-y-2 rounded-lg border border-[#2a313c] bg-[#0b0d10] p-3">
      <h3 className="text-[10px] uppercase tracking-wide text-cyan-400">Hottest tile</h3>
      <p className="font-mono text-xs">
        {hotspot.lat.toFixed(4)}, {hotspot.lon.toFixed(4)} ·{" "}
        {hotspot.temperature_c == null ? "no tile" : `${hotspot.temperature_c.toFixed(1)}°C`}
      </p>
      {busy && <p className="text-xs text-slate-500">Loading site context…</p>}
      {blockingEnrichErrors(enrichment).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {blockingEnrichErrors(enrichment).map(([name, msg]) => (
            <span key={name} className="rounded-full bg-rose-950/80 px-2 py-0.5 text-[10px] text-rose-100/90" title={msg}>
              {msg}
            </span>
          ))}
        </div>
      )}
      {enrichment?.env_params && (
        <div className="text-xs">
          <p className="text-slate-500">Apparent / wet-bulb (hot hour)</p>
          <p className="font-mono">
            {String(hot.apparent_temperature_celsius ?? "—")}°C apparent
            {" · "}
            {String(hot.wet_bulb_temperature_celsius ?? "—")}°C wet-bulb
          </p>
        </div>
      )}
      {buckets && (
        <div className="grid grid-cols-2 gap-2 text-center text-xs">
          <Stat label="Canopy (sat)" value={`${buckets.canopy_pct.toFixed(0)}%`} />
          <Stat label="Impervious (sat)" value={`${buckets.impervious_pct.toFixed(0)}%`} />
        </div>
      )}
      <SatelliteStack
        buckets={buckets}
        classes={enrichment?.satellite?.classes_percent}
      />
      {enrichment?.satellite && <ClassList title="Satellite classes" items={enrichment.satellite.classes_percent} />}
      {enrichment?.streetview && <ClassList title="Street view" items={enrichment.streetview.classes_percent} />}
      {enrichment?.heat_intelligence && (
        <a
          className="inline-block text-xs font-medium text-cyan-300 hover:underline"
          href={pdfUrl(enrichment.heat_intelligence.download_url)}
          target="_blank"
          rel="noreferrer"
        >
          Heat intelligence PDF
        </a>
      )}
    </section>
  );
}

function SatelliteStack({
  buckets,
  classes,
}: {
  buckets?: NonNullable<EnrichResponse["satellite"]>["buckets"] | null;
  classes?: Record<string, number> | null;
}) {
  const slices = satelliteMixSlices(buckets, classes);
  if (!slices.length) return null;
  const total = slices.reduce((sum, s) => sum + s.pct, 0) || 1;
  return (
    <div className="space-y-1">
      <div className="flex h-2.5 overflow-hidden rounded bg-[#161a20]" role="img" aria-label={slices.map((s) => `${s.label} ${s.pct.toFixed(0)}%`).join(", ")}>
        {slices.map((s) => (
          <div
            key={s.key}
            className="h-full"
            style={{ width: `${(s.pct / total) * 100}%`, background: s.color }}
            title={`${s.label} ${s.pct.toFixed(0)}%`}
          />
        ))}
      </div>
      <p className="font-mono text-[10px] leading-snug text-slate-300">
        {slices
          .filter((s) => s.key !== "other" || s.pct >= 1)
          .map((s) => `${s.label} ${s.pct.toFixed(0)}%`)
          .join(" · ")}
      </p>
      <p className="text-[10px] leading-snug text-slate-500">
        Satellite mix at the hotspot, not a district NLCD raster.
      </p>
    </div>
  );
}

function ClassList({ title, items }: { title: string; items: Record<string, number> }) {
  const rows = Object.entries(items).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <p className="text-xs text-slate-500">{title}</p>
      <ul className="mt-1 space-y-1">
        {rows.map(([name, pct]) => (
          <li key={name} className="text-[11px]">
            <div className="flex justify-between text-slate-300">
              <span>{name}</span>
              <span className="font-mono">{pct.toFixed(1)}%</span>
            </div>
            <div className="h-1 overflow-hidden rounded bg-[#161a20]">
              <div className="h-full bg-cyan-400" style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function num(value: number | null | undefined, suffix: string) {
  if (value == null || Number.isNaN(value)) return "—";
  const places = suffix.includes("h") ? 2 : 2;
  return `${Number(value.toFixed(places))}${suffix}`;
}

function hourFromDatetime(datetime: string): string | null {
  const m = datetime.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : null;
}

function ringCentroid(geom: GeoJSON.Geometry): { lon: number; lat: number } | null {
  let ring: number[][] | null = null;
  if (geom.type === "Polygon") ring = geom.coordinates[0] as number[][];
  else if (geom.type === "MultiPolygon") ring = geom.coordinates[0]?.[0] as number[][];
  else if (geom.type === "Point") {
    const [lon, lat] = geom.coordinates as [number, number];
    return { lon, lat };
  }
  if (!ring?.length) return null;
  const closed =
    ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const last = closed ? ring.length - 1 : ring.length;
  let x = 0;
  let y = 0;
  let n = 0;
  for (let i = 0; i < last; i += 1) {
    x += ring[i][0];
    y += ring[i][1];
    n += 1;
  }
  if (!n) return null;
  return { lon: x / n, lat: y / n };
}

function hottestTreeSeeds(heatmap: AnalyzeResponse["heatmap"] | undefined, n: number) {
  if (!heatmap?.features?.length) return [];
  const ranked = heatmap.features
    .map((ft) => {
      const temp = ft.properties?.temperature;
      if (temp == null || !ft.geometry) return null;
      const c = ringCentroid(ft.geometry as GeoJSON.Geometry);
      if (!c) return null;
      return { ...c, temp };
    })
    .filter((row): row is { lon: number; lat: number; temp: number } => row != null)
    .sort((a, b) => b.temp - a.temp)
    .slice(0, n);
  return ranked.map(({ lon, lat }) => ({ lon, lat }));
}

function nearestCoolingSite(from: { lon: number; lat: number }, sites: CoolingSite[]) {
  const indoor = sites.filter((site) => site.walkOk);
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
