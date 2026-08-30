"use client";

import { useEffect } from "react";
import { BackToHub, Kpi, RunRow, SourcePills, ToolIntro } from "@/components/tools/ToolBits";
import { useTools } from "@/components/tools/ToolsProvider";

export default function PeakHoursPage() {
  const { hours, analysis, shareQ, runHours, runScore, hoursBusy, scoreBusy, error, threshold, ready } = useTools();

  useEffect(() => {
    if (!ready || hours || hoursBusy) return;
    void runHours();
  }, [hours, hoursBusy, ready, runHours]);

  const peak = hours?.peak;
  const maxLoad = Math.max(1, ...(peak?.hours.map((h) => h.heat_load) || [0]));
  const maxGhi = Math.max(1, ...(peak?.hours.map((h) => h.ghi_wm2 || 0) || [0]));
  const hasGhi = Boolean(peak?.hours.some((h) => h.ghi_wm2 != null && h.ghi_wm2 > 0));

  return (
    <div>
      <BackToHub query={shareQ} />
      <ToolIntro
        title="Peak hours"
        lede="Neighborhood heat-load hours: degree-hours above the local threshold from Open-Meteo 2 m air. After you score tiles, FortyGuard duration (hours / streak / unrelieved ratio) sits beside it. This is not transformer overload or a duck curve."
      >
        <div className="mt-3">
          <SourcePills
            items={[
              "Open-Meteo 2 m air + GHI",
              "FortyGuard duration after Score",
              `${threshold} °C threshold`,
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

      {peak ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            <Kpi
              label="Hottest hour"
              value={peak.hottest ? `${peak.hottest.temp_c.toFixed(1)} °C` : "—"}
              note={peak.hottest?.hour || "Open-Meteo air"}
            />
            <Kpi
              label="Hours ≥ threshold"
              value={`${peak.hours_above} h`}
              note="Open-Meteo clock hours"
            />
            <Kpi
              label="Unrelieved streak"
              value={`${peak.unrelieved_streak_h} h`}
              note={
                peak.unrelieved_window
                  ? `${peak.unrelieved_window.start}–${peak.unrelieved_window.end}`
                  : "Consecutive Open-Meteo hours"
              }
            />
            <Kpi
              label="Heat-load sum"
              value={`${peak.heat_load_sum.toFixed(1)}`}
              note="Degree-hours, not MW"
            />
          </div>

          {analysis ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Kpi
                label="FG mean hours ≥ threshold"
                value={
                  analysis.scorecard.mean_hours_above != null
                    ? `${analysis.scorecard.mean_hours_above.toFixed(2)} h`
                    : "—"
                }
                note="Tile duration layer"
              />
              <Kpi
                label="FG longest streak"
                value={
                  analysis.scorecard.max_streak_hours != null
                    ? `${analysis.scorecard.max_streak_hours.toFixed(2)} h`
                    : "—"
                }
                note="Persistence layer"
              />
              <Kpi
                label="Unrelieved ratio"
                value={
                  analysis.scorecard.unrelieved_heat_ratio != null
                    ? analysis.scorecard.unrelieved_heat_ratio.toFixed(2)
                    : "—"
                }
                note="HeatCast index, streak ÷ hours"
              />
            </div>
          ) : (
            <p className="mt-4 text-[12px] text-slate-500">
              Score neighborhood tiles to add FortyGuard hours / streak next to this Open-Meteo series.
            </p>
          )}

          <section className="mt-6 rounded-xl border border-[#2a313c] bg-[#161a20] p-5">
            <h2 className="text-sm font-medium text-slate-100">Hourly heat-load proxy</h2>
            <p className="mt-1 text-[12px] text-slate-500">{peak.label}</p>
            <div className="mt-4 flex h-32 items-end gap-0.5">
              {peak.hours.map((row) => (
                <div
                  key={row.hour}
                  className="flex-1 rounded-t"
                  style={{
                    height: `${Math.max(6, (row.heat_load / maxLoad) * 100)}%`,
                    background: row.above_threshold ? "#fbbf24" : "#334155",
                  }}
                  title={`${row.hour} · ${row.temp_c ?? "—"} °C · load ${row.heat_load}`}
                />
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-slate-600">
              <span>00:00</span>
              <span>12:00</span>
              <span>23:00</span>
            </div>
          </section>

          {hasGhi ? (
            <section className="mt-6 rounded-xl border border-[#2a313c] bg-[#161a20] p-5">
              <h2 className="text-sm font-medium text-slate-100">Solar vs heat hours</h2>
              <p className="mt-1 text-[12px] text-slate-500">
                Open-Meteo shortwave GHI plus the same Open-Meteo air. Not EIA, not a utility duck curve.
                {peak.solar_peak
                  ? ` Peak GHI ${peak.solar_peak.ghi_wm2} W/m² at ${peak.solar_peak.hour}.`
                  : ""}
              </p>
              <div className="mt-4 flex h-28 items-end gap-0.5">
                {peak.hours.map((row) => (
                  <div
                    key={`ghi-${row.hour}`}
                    className="flex-1 rounded-t bg-emerald-400/70"
                    style={{ height: `${Math.max(4, ((row.ghi_wm2 || 0) / maxGhi) * 100)}%` }}
                    title={`${row.hour} · GHI ${row.ghi_wm2 ?? "—"}`}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <p className="mt-6 text-sm text-slate-400">Loading Open-Meteo hourly context…</p>
      )}
    </div>
  );
}
