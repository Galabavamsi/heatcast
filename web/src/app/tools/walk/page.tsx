"use client";

import { useEffect } from "react";
import { BackToHub, Kpi, RunRow, SourcePills, ToolIntro } from "@/components/tools/ToolBits";
import { useTools } from "@/components/tools/ToolsProvider";
import { omAirAt } from "@/lib/tools/hours";

export default function WalkExposurePage() {
  const {
    analysis,
    hours,
    sites,
    walkDest,
    walkRoute,
    walkExposure,
    walkFrom,
    shareQ,
    runScore,
    runHours,
    runPlaces,
    scoreBusy,
    hoursBusy,
    placesBusy,
    error,
    threshold,
    time,
    ready,
  } = useTools();

  useEffect(() => {
    if (!ready) return;
    void runPlaces();
  }, [ready, runPlaces]);

  const mins =
    walkRoute?.duration_s != null ? Math.round(walkRoute.duration_s / 60) : null;
  const km =
    walkRoute?.distance_m != null ? (walkRoute.distance_m / 1000).toFixed(2) : null;
  const temps = walkExposure?.samples.map((s) => s.temp_c).filter((t): t is number => t != null) ?? [];
  const maxT = temps.length ? Math.max(...temps) : 0;
  const minT = temps.length ? Math.min(...temps) : 0;
  const previewAir = omAirAt(hours, time);
  const originLabel =
    walkFrom === "hotspot" ? "Hottest tile" : walkFrom === "center" ? "Neighborhood center" : "Origin pending";

  return (
    <div>
      <BackToHub query={shareQ} />
      <ToolIntro
        title="Walk exposure"
        lede="A neighborhood walk to the nearest OSM library or community centre. Before Score the origin is the box center and air is Open-Meteo at the selected hour. After Score, the origin is the hottest tile and samples are nearest FortyGuard 2 m air. Not cargo, vaccines, or worker WBGT."
      >
        <div className="mt-3">
          <SourcePills
            items={[
              walkFrom === "hotspot" ? "FortyGuard TCM tiles" : "Open-Meteo point air",
              "OSM indoor site",
              "OSRM walking",
            ]}
          />
        </div>
      </ToolIntro>
      <RunRow
        onHours={runHours}
        onScore={runScore}
        hoursBusy={hoursBusy}
        scoreBusy={scoreBusy}
        hoursReady={Boolean(hours)}
        scoreReady={Boolean(analysis)}
      />
      {error ? <p className="mt-3 text-sm text-amber-200">{error}</p> : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        <Kpi
          label="Walk"
          value={km ? `${km} km` : placesBusy ? "…" : "—"}
          note={mins != null ? `${mins} min · ${originLabel}` : placesBusy ? "Loading indoor sites…" : "No OSRM line yet"}
        />
        <Kpi
          label="Destination"
          value={walkDest?.name || (placesBusy ? "Looking…" : "None in box")}
          note={walkDest ? walkDest.kind : "Libraries / community centres only"}
        />
        <Kpi
          label={walkExposure?.max_c != null ? "Hottest sample" : "Air at hour"}
          value={
            walkExposure?.max_c != null
              ? `${walkExposure.max_c.toFixed(1)} °C`
              : previewAir != null
                ? `${previewAir.toFixed(1)} °C`
                : "—"
          }
          note={walkExposure?.max_c != null ? `Threshold ${threshold} °C` : `Open-Meteo at ${time}`}
          warn={
            (walkExposure?.max_c != null && walkExposure.max_c >= threshold) ||
            (walkExposure?.max_c == null && previewAir != null && previewAir >= threshold)
          }
        />
        <Kpi
          label="Share ≥ threshold"
          value={
            walkExposure?.share_above != null
              ? `${Math.round(walkExposure.share_above * 100)}%`
              : "—"
          }
          note={walkExposure ? "Of sampled vertices" : "Score tiles to sample the walk"}
        />
      </div>

      {sites.length ? (
        <section className="mt-6 rounded-xl border border-[#2a313c] bg-[#161a20] p-5">
          <h2 className="text-sm font-medium text-slate-100">Indoor OSM sites in the box</h2>
          <p className="mt-1 text-[12px] text-slate-500">
            Overpass amenities — not an official cooling-center scrape.
          </p>
          <ul className="mt-3 max-h-40 space-y-1 overflow-auto text-[12px] text-slate-300">
            {sites.map((site) => (
              <li key={`${site.lon}:${site.lat}:${site.name}`} className="flex justify-between gap-4">
                <span>
                  {site.name}
                  {walkDest?.name === site.name ? " · walk target" : ""}
                </span>
                <span className="text-slate-500">{site.kind}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="mt-6 text-sm text-slate-500">
          {placesBusy ? "Loading OSM indoor sites…" : "No indoor OSM sites in this box yet."}
        </p>
      )}

      {walkExposure?.hottest_stretch ? (
        <p className="mt-4 text-sm text-slate-300">
          Hottest stretch: {walkExposure.hottest_stretch.mean_c.toFixed(1)} °C mean
          {walkExposure.hottest_stretch.from_m != null
            ? ` between ${Math.round(walkExposure.hottest_stretch.from_m)}–${Math.round(walkExposure.hottest_stretch.to_m || 0)} m`
            : ""}
          .
        </p>
      ) : null}

      {temps.length > 0 ? (
        <section className="mt-6 rounded-xl border border-[#2a313c] bg-[#161a20] p-5">
          <h2 className="text-sm font-medium text-slate-100">Air along the walk</h2>
          <p className="mt-1 text-[12px] text-slate-500">
            {walkExposure?.label || "Nearest tile temperature at sampled vertices."}
          </p>
          <div className="mt-4 flex h-28 items-end gap-1">
            {walkExposure?.samples.map((s, i) => {
              const t = s.temp_c;
              const h = t == null || maxT === minT ? 20 : 16 + ((t - minT) / (maxT - minT)) * 84;
              const hot = t != null && t >= threshold;
              return (
                <div
                  key={`${s.along_m}-${i}`}
                  className="flex-1 rounded-t"
                  style={{ height: `${h}%`, background: hot ? "#fbbf24" : "#22d3ee" }}
                  title={`${s.along_m} m · ${t ?? "—"} °C`}
                />
              );
            })}
          </div>
          <ul className="mt-4 max-h-56 space-y-1 overflow-auto text-[12px] text-slate-400">
            {walkExposure?.samples.map((s, i) => (
              <li key={`row-${s.along_m}-${i}`} className="flex justify-between gap-4">
                <span>{Math.round(s.along_m)} m</span>
                <span className="font-mono">{s.temp_c != null ? `${s.temp_c.toFixed(1)} °C` : "—"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="mt-6 text-sm text-slate-500">
          {analysis
            ? walkExposure?.note ||
              "No walk samples. Need an indoor OSM site in the box and a FortyGuard heatmap."
            : "Score neighborhood tiles to sample FortyGuard air along this walk. Distance and destination above are already live from OSM + OSRM."}
        </p>
      )}
    </div>
  );
}
