"use client";

import { BackToHub, Kpi, RunRow, SourcePills, ToolIntro } from "@/components/tools/ToolBits";
import { useTools } from "@/components/tools/ToolsProvider";

export default function WalkExposurePage() {
  const {
    analysis,
    walkDest,
    walkRoute,
    walkExposure,
    shareQ,
    runScore,
    runHours,
    scoreBusy,
    hoursBusy,
    hours,
    error,
    threshold,
  } = useTools();
  const mins =
    walkRoute?.duration_s != null ? Math.round(walkRoute.duration_s / 60) : null;
  const km =
    walkRoute?.distance_m != null ? (walkRoute.distance_m / 1000).toFixed(2) : null;
  const temps = walkExposure?.samples.map((s) => s.temp_c).filter((t): t is number => t != null) ?? [];
  const maxT = temps.length ? Math.max(...temps) : 0;
  const minT = temps.length ? Math.min(...temps) : 0;

  return (
    <div>
      <BackToHub query={shareQ} />
      <ToolIntro
        title="Walk exposure"
        lede="A neighborhood walk from the hottest tile to the nearest OSM library or community centre. Temperatures are the nearest FortyGuard 2 m air tile along the OSRM line — not cargo, vaccines, or worker WBGT."
      >
        <div className="mt-3">
          <SourcePills items={["FortyGuard TCM tiles", "OSM indoor site", "OSRM walking"]} />
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

      {!analysis ? (
        <p className="mt-6 text-sm text-slate-400">Score the neighborhood to get a hotspot, indoor site, and walk.</p>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            <Kpi
              label="Walk"
              value={km ? `${km} km` : "—"}
              note={mins != null ? `${mins} min walking` : "No OSRM line yet"}
            />
            <Kpi
              label="Destination"
              value={walkDest?.name || "None in box"}
              note={walkDest ? walkDest.kind : "Libraries / community centres only"}
            />
            <Kpi
              label="Hottest sample"
              value={walkExposure?.max_c != null ? `${walkExposure.max_c.toFixed(1)} °C` : "—"}
              note={`Threshold ${threshold} °C`}
              warn={walkExposure?.max_c != null && walkExposure.max_c >= threshold}
            />
            <Kpi
              label="Share ≥ threshold"
              value={
                walkExposure?.share_above != null
                  ? `${Math.round(walkExposure.share_above * 100)}%`
                  : "—"
              }
              note="Of sampled vertices, not sidewalk CFD"
            />
          </div>

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
              {walkExposure?.note ||
                "No walk samples. Need an indoor OSM site in the box and a FortyGuard heatmap."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
