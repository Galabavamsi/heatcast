"use client";

import { BackToHub, Kpi, RunRow, SourcePills, ToolIntro } from "@/components/tools/ToolBits";
import { useTools } from "@/components/tools/ToolsProvider";

export default function ShiftWindowPage() {
  const { hours, analysis, shareQ, runHours, runScore, hoursBusy, scoreBusy, error } = useTools();
  const shift = hours?.shift_window;
  const rec = shift?.recommend;
  const avoid = shift?.avoid;
  const maxLoad = Math.max(1, ...(shift?.hours.map((h) => h.heat_load) || [0]));
  const recSet = new Set(rec?.hours || []);
  const avoidSet = new Set(avoid?.hours || []);

  return (
    <div>
      <BackToHub query={shareQ} />
      <ToolIntro
        title="Shift window"
        lede="Best cool / low-demand daylight hours from Open-Meteo 2 m air and shortwave GHI. Use this to move outdoor or heat-exposed work toward a cooler 4-hour block. This is not grid carbon intensity and not gCO2/kWh — Electricity Maps and EIA are not called."
      >
        <div className="mt-3">
          <SourcePills items={["Open-Meteo air + GHI", "4 h daylight block", "Not carbon / methane / EIA"]} />
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

      {shift ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            <Kpi
              label="Prefer"
              value={rec ? `${rec.start}–${rec.end}` : "—"}
              note={rec?.mean_temp_c != null ? `${rec.mean_temp_c.toFixed(1)} °C mean air` : "Coolest daylight block"}
            />
            <Kpi
              label="Avoid"
              value={avoid ? `${avoid.start}–${avoid.end}` : "—"}
              note={
                avoid?.mean_temp_c != null ? `${avoid.mean_temp_c.toFixed(1)} °C mean air` : "Hottest 4 h block"
              }
              warn
            />
            <Kpi
              label="Prefer demand"
              value={rec ? rec.mean_heat_load.toFixed(1) : "—"}
              note="Mean degree-hours in the window"
            />
            <Kpi
              label="Prefer GHI"
              value={rec?.mean_ghi_wm2 != null ? `${Math.round(rec.mean_ghi_wm2)}` : "—"}
              note="W/m² Open-Meteo shortwave"
            />
          </div>

          <p className="mt-4 text-sm text-slate-400">{shift.note || shift.label}</p>

          <section className="mt-6 rounded-xl border border-[#2a313c] bg-[#161a20] p-5">
            <h2 className="text-sm font-medium text-slate-100">Hourly demand vs daylight</h2>
            <p className="mt-1 text-[12px] text-slate-500">
              Cyan = recommended block. Amber = avoid. Grey = other hours.
            </p>
            <div className="mt-4 flex h-32 items-end gap-0.5">
              {shift.hours.map((row) => {
                const tone = recSet.has(row.hour)
                  ? "#22d3ee"
                  : avoidSet.has(row.hour)
                    ? "#fbbf24"
                    : row.daylight
                      ? "#475569"
                      : "#1e293b";
                return (
                  <div
                    key={row.hour}
                    className="flex-1 rounded-t"
                    style={{
                      height: `${Math.max(6, (row.heat_load / maxLoad) * 100)}%`,
                      background: tone,
                    }}
                    title={`${row.hour} · ${row.temp_c ?? "—"} °C · load ${row.heat_load} · GHI ${row.ghi_wm2 ?? "—"}`}
                  />
                );
              })}
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-slate-600">
              <span>00:00</span>
              <span>12:00</span>
              <span>23:00</span>
            </div>
          </section>

          {shift.coolest_daylight.length ? (
            <section className="mt-6 rounded-xl border border-[#2a313c] bg-[#161a20] p-5">
              <h2 className="text-sm font-medium text-slate-100">Coolest daylight hours</h2>
              <ul className="mt-3 space-y-1 text-[12px] text-slate-300">
                {shift.coolest_daylight.map((row) => (
                  <li key={row.hour} className="flex justify-between gap-4 font-mono">
                    <span>{row.hour}</span>
                    <span>
                      {row.temp_c ?? "—"} °C · load {row.heat_load} · GHI {row.ghi_wm2 ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : (
        <p className="mt-6 text-sm text-slate-400">
          {hoursBusy ? "Loading Open-Meteo shift window…" : "Hourly context has not loaded yet."}
        </p>
      )}
    </div>
  );
}
