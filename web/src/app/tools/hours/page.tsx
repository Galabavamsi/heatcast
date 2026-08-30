"use client";

import { BackToHub, Kpi, RunRow, SourcePills, ToolIntro } from "@/components/tools/ToolBits";
import { useTools } from "@/components/tools/ToolsProvider";

export default function SiteHoursPage() {
  const { hours, analysis, shareQ, runHours, runScore, hoursBusy, scoreBusy, error, threshold, time } =
    useTools();
  const site = hours?.site_hours;
  const rows = site?.hours || [];
  const maxLoad = Math.max(1, ...rows.map((r) => r.heat_load));
  const fgMean = analysis?.scorecard.mean_c;
  const selected = rows.find((r) => r.hour === time);

  return (
    <div>
      <BackToHub query={shareQ} />
      <ToolIntro
        title="Site hours"
        lede="Hour-by-hour Open-Meteo air, apparent temperature, humidity, and a cooling-demand proxy (degree-hours above threshold). After you score tiles, the FortyGuard neighborhood mean sits next to the selected hour. This is not data-center PUE and not a cached diurnal TCM."
      >
        <div className="mt-3">
          <SourcePills
            items={[
              "Open-Meteo 2 m air + apparent + RH",
              "Cooling-demand proxy = degree-hours",
              analysis ? "FortyGuard mean after Score" : "Score tiles for FG mean",
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

      {site ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            <Kpi
              label="Mean air"
              value={site.mean_air_c != null ? `${site.mean_air_c.toFixed(1)} °C` : "—"}
              note="Open-Meteo daily mean"
            />
            <Kpi
              label="Mean apparent"
              value={site.mean_apparent_c != null ? `${site.mean_apparent_c.toFixed(1)} °C` : "—"}
              note="Feels-like, same grid"
            />
            <Kpi label="Hours ≥ threshold" value={`${site.hours_above} h`} note={`${threshold} °C cut`} />
            <Kpi
              label="Cooling-demand sum"
              value={`${site.heat_load_sum.toFixed(1)}`}
              note="Degree-hours, not PUE"
            />
          </div>

          {analysis ? (
            <p className="mt-4 text-sm text-slate-300">
              FortyGuard snapshot at {time}: mean{" "}
              {fgMean != null ? `${fgMean.toFixed(1)} °C` : "—"}
              {analysis.scorecard.mean_hours_above != null
                ? ` · ${analysis.scorecard.mean_hours_above.toFixed(2)} h above threshold`
                : ""}
              {selected?.air_c != null ? ` · Open-Meteo air at this hour ${selected.air_c.toFixed(1)} °C` : ""}.
              Tile TCM is one hour, not a 24 h grid.
            </p>
          ) : (
            <p className="mt-4 text-[12px] text-slate-500">
              Score neighborhood tiles to place the FortyGuard mean next to this Open-Meteo table.
            </p>
          )}

          <section className="mt-6 rounded-xl border border-[#2a313c] bg-[#161a20] p-5">
            <h2 className="text-sm font-medium text-slate-100">Cooling-demand proxy</h2>
            <p className="mt-1 text-[12px] text-slate-500">{site.label}</p>
            <div className="mt-4 flex h-28 items-end gap-0.5">
              {rows.map((row) => (
                <div
                  key={row.hour}
                  className="flex-1 rounded-t"
                  style={{
                    height: `${Math.max(6, (row.heat_load / maxLoad) * 100)}%`,
                    background: row.hour === time ? "#22d3ee" : row.above_threshold ? "#fbbf24" : "#334155",
                  }}
                  title={`${row.hour} · air ${row.air_c ?? "—"} · load ${row.heat_load}`}
                />
              ))}
            </div>
          </section>

          <section className="mt-6 overflow-x-auto rounded-xl border border-[#2a313c] bg-[#161a20] p-5">
            <h2 className="text-sm font-medium text-slate-100">Hour table</h2>
            <table className="mt-4 w-full text-left text-[12px] text-slate-300">
              <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="pb-2 pr-3">Hour</th>
                  <th className="pb-2 pr-3">Air °C</th>
                  <th className="pb-2 pr-3">Apparent °C</th>
                  <th className="pb-2 pr-3">RH %</th>
                  <th className="pb-2 pr-3">Demand</th>
                  <th className="pb-2">GHI</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.hour} className={row.hour === time ? "text-cyan-100" : row.above_threshold ? "text-amber-100" : ""}>
                    <td className="py-1 pr-3 font-mono">{row.hour}</td>
                    <td className="py-1 pr-3 font-mono">{row.air_c ?? "—"}</td>
                    <td className="py-1 pr-3 font-mono">{row.apparent_c ?? "—"}</td>
                    <td className="py-1 pr-3 font-mono">{row.rh_pct ?? "—"}</td>
                    <td className="py-1 pr-3 font-mono">{row.heat_load.toFixed(1)}</td>
                    <td className="py-1 font-mono">{row.ghi_wm2 ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : (
        <p className="mt-6 text-sm text-slate-400">
          {hoursBusy ? "Loading Open-Meteo hourly table…" : "Hourly context has not loaded yet."}
        </p>
      )}
    </div>
  );
}
