"use client";

import { useEffect } from "react";
import { BackToHub, Kpi, RunRow, SourcePills, ToolIntro } from "@/components/tools/ToolBits";
import { useTools } from "@/components/tools/ToolsProvider";

export default function CompoundHoursPage() {
  const { hours, analysis, shareQ, runHours, runScore, hoursBusy, scoreBusy, error, threshold, ready } = useTools();

  useEffect(() => {
    if (!ready || hours || hoursBusy) return;
    void runHours();
  }, [hours, hoursBusy, ready, runHours]);

  const compound = hours?.compound;
  const aqiOk = Boolean(compound?.has_us_aqi);

  return (
    <div>
      <BackToHub query={shareQ} />
      <ToolIntro
        title="Compound hours"
        lede="Hours when neighborhood heat and poor air or high humidity coincide. Air quality is Open-Meteo US AQI when the free series lands. FortyGuard env_params on this app does not request AQI, and we do not draw CO2 or methane."
      >
        <div className="mt-3">
          <SourcePills
            items={[
              "Open-Meteo 2 m air + RH",
              aqiOk ? "Open-Meteo US AQI" : "US AQI pending / missing",
              "No CO2 / methane",
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

      {compound ? (
        <>
          {!aqiOk ? (
            <div className="mt-4 rounded-xl border border-dashed border-[#2a313c] p-4 text-sm text-slate-400">
              Needs env AQI — not in this FortyGuard enrich path. Showing heat + humidity hours
              {compound.aqi_note ? ` · ${compound.aqi_note}` : "."}
            </div>
          ) : null}

          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            <Kpi
              label="Compound hours"
              value={`${compound.compound_hours} h`}
              note={aqiOk ? "Heat and US AQI ≥ 100" : "Heat and RH ≥ 60%"}
              warn={compound.compound_hours > 0}
            />
            <Kpi
              label="Heat + humidity"
              value={`${compound.humidity_compound_hours} h`}
              note={`RH cut ${compound.rh_cut}%`}
            />
            <Kpi
              label="Heat + US AQI"
              value={aqiOk ? `${compound.aqi_compound_hours} h` : "—"}
              note={aqiOk ? `AQI cut ${compound.aqi_cut}` : "Not available"}
            />
            <Kpi label="Threshold" value={`${threshold} °C`} note="Same Houston 35 / Phoenix 38 rule" />
          </div>

          <section className="mt-6 overflow-x-auto rounded-xl border border-[#2a313c] bg-[#161a20] p-5">
            <h2 className="text-sm font-medium text-slate-100">Hour table</h2>
            <p className="mt-1 text-[12px] text-slate-500">{compound.label}</p>
            <table className="mt-4 w-full text-left text-[12px] text-slate-300">
              <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="pb-2 pr-3">Hour</th>
                  <th className="pb-2 pr-3">Air °C</th>
                  <th className="pb-2 pr-3">RH %</th>
                  <th className="pb-2 pr-3">US AQI</th>
                  <th className="pb-2">Flag</th>
                </tr>
              </thead>
              <tbody>
                {compound.hours.map((row) => (
                  <tr key={row.hour} className={row.compound ? "text-amber-100" : ""}>
                    <td className="py-1 pr-3 font-mono">{row.hour}</td>
                    <td className="py-1 pr-3 font-mono">{row.temp_c ?? "—"}</td>
                    <td className="py-1 pr-3 font-mono">{row.rh_pct ?? "—"}</td>
                    <td className="py-1 pr-3 font-mono">{row.us_aqi ?? "—"}</td>
                    <td className="py-1">
                      {row.aqi_compound
                        ? "heat + AQI"
                        : row.humidity_compound
                          ? "heat + humidity"
                          : row.hot
                            ? "heat"
                            : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : (
        <p className="mt-6 text-sm text-slate-400">Loading hourly context…</p>
      )}
    </div>
  );
}
