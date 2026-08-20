"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeDistrict,
  enrichHotspot,
  fetchSvi,
  getBuildings,
  getCooling,
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
  MAX_AREA_MI2,
  shrinkToMax,
  type BBox,
} from "@/lib/aoi";
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
    body: "Press Score area. You get ~100 m air temperature tiles, a hotspot, and hours above threshold.",
  },
  {
    title: "Inspect in 3D",
    body: "Turn on 3D heat. Right-drag or Ctrl-drag to orbit the scored block, or use Orbit for left-drag inspect. Reset view frames the area.",
  },
];

type Interaction = "pan" | "draw" | "orbit";

export default function Home() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [placeName, setPlaceName] = useState("United States");
  const [aoi, setAoi] = useState<BBox | null>(null);
  const [view, setView] = useState({ longitude: -98.35, latitude: 39.5, zoom: 4.1 });
  const [startDate, setStartDate] = useState("2024-07-15");
  const [startTime, setStartTime] = useState("15:00");
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
  const [buildingsBusy, setBuildingsBusy] = useState(false);
  const [osmError, setOsmError] = useState<string | null>(null);
  const [selectedSvi, setSelectedSvi] = useState<SviTract | null>(null);
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [guideStep, setGuideStep] = useState<number | null>(0);
  const [memoBusy, setMemoBusy] = useState(false);
  const skipGeocode = useRef(false);
  const briefSeq = useRef(0);

  useEffect(() => {
    try {
      if (window.localStorage.getItem("heatcast-guide-v1") === "done") setGuideStep(null);
    } catch {
      /* ignore */
    }
  }, []);

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
      const props = (ft.properties || {}) as { name?: string; kind?: string };
      out.push({
        name: props.name || "Cooling site",
        kind: props.kind || "Site",
        lon,
        lat,
      });
    }
    return out;
  }, [cooling]);

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
    setOsmError(null);
    setGuideStep((s) => (s === 1 ? 2 : s));
  }, []);

  async function onAnalyze(time = startTime) {
    if (!aoi || busy === "analyze") return;
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
        start_time: time,
        include_exceedance: true,
        canopy_delta_pct: canopyDelta,
        current_canopy_pct: currentCanopy,
      });
      setAnalysis(result);
      setStartTime(time);
      setEnrichment(null);
      setSvi(null);
      setSelectedSvi(null);
      setCooling(null);
      setSviOn(true);
      setContoursOn(true);
      setShadeOn(true);
      setCoolingOn(true);
      setBusy(null);
      setPanelOpen(true);
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

  async function onHourChange(time: string) {
    setStartTime(time);
    if (analysis && busy !== "analyze" && aoi) await onAnalyze(time);
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
        onAoiChange={onAoiChange}
        onSviSelect={setSelectedSvi}
      />

      <header className="heatcast-glass pointer-events-auto absolute left-4 right-4 top-4 z-20 flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 lg:right-[22rem]">
        <div className="min-w-[9rem]">
          <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-cyan-400">HeatCast</p>
          <h1 className="text-sm font-semibold tracking-tight">Neighborhood heat</h1>
        </div>
        <div className="relative min-w-[16rem] flex-1">
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
        <label className="text-[11px] text-slate-400">
          Date
          <input
            type="date"
            value={startDate}
            disabled={scoring}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-0.5 block rounded-md border border-[#2a313c] bg-[#0b0d10] px-2 py-1.5 text-sm text-slate-100"
          />
        </label>
        <label className="text-[11px] text-slate-400">
          Hour
          <select
            value={startTime}
            disabled={scoring}
            onChange={(e) => void onHourChange(e.target.value)}
            className="mt-0.5 block rounded-md border border-[#2a313c] bg-[#0b0d10] px-2 py-1.5 text-sm text-slate-100"
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!areaOk || scoring}
          onClick={() => void onAnalyze(startTime)}
          className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-[#0b0d10] transition hover:bg-cyan-300 disabled:opacity-35"
        >
          {scoring ? "Scoring…" : "Score area"}
        </button>
      </header>

      <div className="absolute left-4 top-24 z-20 flex flex-col gap-2">
        <ToolRail
          interaction={interaction}
          onInteraction={setInteraction}
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
          </div>
        )}
        <button
          type="button"
          onClick={() => setGuideStep(0)}
          className="heatcast-glass rounded-xl px-3 py-2 text-[11px] text-slate-300 hover:text-cyan-200"
        >
          How to
        </button>
      </div>

      {error && (
        <p className="absolute left-1/2 top-[5.75rem] z-20 max-w-md -translate-x-1/2 rounded-lg border border-rose-900 bg-rose-950/80 px-3 py-2 text-xs text-rose-100">
          {error}
        </p>
      )}

      {scoring && <AnalyzeOverlay hasHeat={Boolean(analysis)} />}

      {panelOpen ? (
        <aside className="heatcast-glass absolute bottom-4 right-4 top-4 z-20 flex min-h-0 w-[min(22rem,calc(100%-2rem))] flex-col gap-2.5 overflow-y-auto overscroll-contain rounded-xl p-4 lg:top-[5.5rem]">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Selected</p>
              <h2 className="text-sm font-semibold text-slate-100">{placeName}</h2>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                Search a place or drag a box. Cool the neighborhood with the canopy model after you score.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              className="text-xs text-slate-500 hover:text-slate-200"
            >
              Hide
            </button>
          </div>
          <RainChip rain={rain} flood={flood} elevationM={weather?.elevation_m} />
          <ComfortChip comfort={comfort} hotspotC={analysis?.hotspot?.temperature_c ?? null} shade={shade?.meta ?? null} />
          {scoring && !analysis && <SidebarSkeleton />}
          {analysis && <Scorecard analysis={analysis} scenario={liveScenario} />}
          {analysis && (
            <SviPanel
              svi={svi}
              busy={sviBusy}
              selected={selectedSvi}
            />
          )}
          {analysis && (
            <CoolingPanel sites={coolingSites} busy={coolingBusy} note={cooling?.meta?.note} error={osmError} />
          )}
          {analysis && (
            <ScenarioPanel
              canopyDelta={canopyDelta}
              onChange={setCanopyDelta}
              currentCanopy={currentCanopy}
              live={liveScenario}
            />
          )}
          {(analysis?.memo || memoBusy) && (
            <section className="rounded-lg border border-[#2a313c] bg-[#0b0d10] p-3 text-xs leading-relaxed text-slate-300">
              <h3 className="mb-1 text-[10px] uppercase tracking-wide text-cyan-400">Planner brief</h3>
              {memoBusy && (
                <p className="mb-2 text-[10px] text-cyan-400/80">Updating with satellite and SVI…</p>
              )}
              {analysis?.memo && !analysis.memo.trim().startsWith("{") ? analysis.memo : null}
            </section>
          )}
          {analysis && <ConfidenceStrip analysis={analysis} />}
          {analysis?.hotspot && (
            <HotspotPanel hotspot={analysis.hotspot} enrichment={enrichment} busy={enrichBusy} />
          )}
          <p className="pt-1 text-[10px] text-slate-600">Temperature: FortyGuard · Vulnerability: CDC/ATSDR SVI 2022</p>
        </aside>
      ) : (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="heatcast-glass absolute right-4 top-24 z-20 rounded-xl px-3 py-2 text-xs text-slate-200"
        >
          Scorecard
        </button>
      )}

      <p className="pointer-events-none absolute bottom-4 left-20 z-10 max-w-sm text-[11px] text-slate-500">
        {interaction === "draw"
          ? "Draw a box, then Score. Isolines sit on the heat; SVI is violet; Shade and Cooling are OSM."
          : interaction === "orbit"
            ? "Drag to orbit. Scroll zooms. Toggle Isolines, SVI, Shade, and Cooling in Layers."
            : "Pan the map. Right-drag orbits. Layers: Isolines, SVI, Shade, Cooling."}
      </p>
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
      <div className="absolute left-1/2 top-24 w-[min(360px,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-cyan-400/25 bg-[#161a20]/92 px-4 py-3 shadow-lg backdrop-blur-md">
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

function RainChip({
  rain,
  flood,
  elevationM,
}: {
  rain: RainContext | null;
  flood?: { zone?: string | null; subtype?: string | null } | null;
  elevationM?: number | null;
}) {
  const mm = rain?.daily_precip_mm;
  const wet = mm != null && mm >= 1;
  return (
    <section className="rounded-lg border border-[#2a313c] bg-[#0b0d10] p-3 text-xs">
      <h3 className="mb-2 text-[10px] uppercase tracking-wide text-cyan-400">Rain context</h3>
      <div className="flex flex-wrap gap-2">
        <span className={`rounded-full px-2 py-1 font-mono ${wet ? "bg-sky-950 text-sky-100" : "bg-[#161a20] text-slate-300"}`}>
          {mm == null ? "precip —" : `${mm} mm`}
        </span>
        {rain?.hour_precip_mm != null && (
          <span className="rounded-full bg-[#161a20] px-2 py-1 font-mono text-slate-300">
            this hour {rain.hour_precip_mm} mm
          </span>
        )}
        {flood?.zone && <span className="rounded-full bg-[#161a20] px-2 py-1 text-slate-300">FEMA {flood.zone}</span>}
        {elevationM != null && (
          <span className="rounded-full bg-[#161a20] px-2 py-1 font-mono text-slate-400">{Math.round(elevationM)} m</span>
        )}
      </div>
      <p className="mt-2 text-[10px] leading-snug text-slate-500">Nearby weather context, not a hydrology model.</p>
    </section>
  );
}

function ComfortChip({
  comfort,
  hotspotC,
  shade,
}: {
  comfort: ComfortContext | null;
  hotspotC: number | null;
  shade: ShadeMeta | null;
}) {
  if (!comfort && !shade) return null;
  const hi = comfort?.heat_index_c;
  const cat = comfort?.category;
  return (
    <section className="rounded-lg border border-[#2a313c] bg-[#0b0d10] p-3 text-xs">
      <h3 className="mb-2 text-[10px] uppercase tracking-wide text-cyan-400">Heat index · shade</h3>
      {hi != null && (
        <p className="font-mono text-slate-100">
          {hi.toFixed(1)}°C NWS
          {cat ? ` · ${cat}` : ""}
          {comfort?.rh_pct != null ? ` · RH ${Math.round(comfort.rh_pct)}%` : ""}
          {comfort?.wind_ms != null ? ` · ${comfort.wind_ms.toFixed(1)} m/s` : ""}
        </p>
      )}
      {hotspotC != null && (
        <p className="mt-1 font-mono text-[11px] text-slate-400">FortyGuard hotspot {hotspotC.toFixed(1)}°C</p>
      )}
      {shade && (
        <p className="mt-1 text-[11px] text-slate-300">
          {shade.night
            ? "Sun below horizon — no building shade at this hour."
            : `Sun ${Math.round(shade.altitudeDeg)}° · ~${Math.round(shade.shadowM ?? 0)} m shadows from OSM massing`}
        </p>
      )}
      <p className="mt-2 text-[10px] leading-snug text-slate-500">
        Heat index uses Open-Meteo T+RH (km-scale). Shade is building geometry at the scored hour, not a new FortyGuard run. Not UTCI (needs mean radiant temperature).
      </p>
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
      <h3 className="text-[10px] uppercase tracking-wide text-cyan-400">Tree canopy (air-temp model)</h3>
      <p className="text-[11px] leading-snug text-slate-400">
        Air-temperature overlay on FortyGuard tiles — not a new heatmap. LST cooling is much larger
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
}: {
  analysis: AnalyzeResponse;
  scenario: ReturnType<typeof estimateScenario> | null;
}) {
  const s = analysis.scorecard;
  const meanShown =
    scenario && scenario.canopy_delta_pct > 0 && scenario.estimated_mean_c != null
      ? scenario.estimated_mean_c
      : s.mean_c;
  const hoursShown =
    scenario && scenario.canopy_delta_pct > 0 && s.mean_hours_above != null && scenario.estimated_hours_saved != null
      ? Math.max(0, s.mean_hours_above - scenario.estimated_hours_saved)
      : s.mean_hours_above;
  return (
    <section className="space-y-2 rounded-lg border border-[#2a313c] bg-[#0b0d10] p-3">
      <h3 className="text-[10px] uppercase tracking-wide text-cyan-400">Scorecard</h3>
      {analysis.coverage_miss && <p className="text-xs text-amber-200">{analysis.warning}</p>}
      <dl className="grid grid-cols-2 gap-2 text-center text-xs">
        <Stat label={`Hours ≥ ${s.threshold_c}°C (mean)`} value={num(hoursShown, " h")} />
        <Stat label="Max hours" value={num(s.max_hours_above, " h")} />
        <Stat label={scenario && scenario.canopy_delta_pct > 0 ? "Mean °C (est.)" : "Mean °C"} value={num(meanShown, "°C")} />
        <Stat label="Max °C" value={num(s.max_c, "°C")} />
      </dl>
      <p className="text-[10px] text-slate-500">{analysis.aoi_area_mi2.toFixed(2)} mi²</p>
    </section>
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
            — not a FortyGuard product.
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
}: {
  sites: CoolingSite[];
  busy: boolean;
  note?: string;
  error?: string | null;
}) {
  return (
    <section className="space-y-1.5 rounded-lg border border-teal-900/40 bg-[#0b0d10] p-3">
      <h3 className="text-[10px] uppercase tracking-wide text-teal-300">Cooling sites (OSM)</h3>
      {busy && !sites.length && <p className="text-xs text-slate-500">Looking up libraries and community centres…</p>}
      {error && <p className="text-xs text-amber-200">{error}</p>}
      {!busy && !sites.length && !error && (
        <p className="text-xs text-slate-500">No OSM libraries or community centres in this box.</p>
      )}
      {sites.length > 0 && (
        <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-slate-200">
          {sites.slice(0, 8).map((site) => (
            <li key={`${site.lon}:${site.lat}:${site.name}`}>
              <span className="text-teal-200">{site.kind}</span>
              {" · "}
              {site.name}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] leading-snug text-slate-500">
        {note || "OpenStreetMap indoor public sites — not an official cooling-center list, not FortyGuard."}
      </p>
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
      </p>
      <p className="mt-1 font-sans text-[10px] leading-snug text-slate-500">
        Tiles are ~100 m. Canopy changes are a model overlay, not a new satellite run. SVI is CDC/ATSDR 2022.
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
