"use client";

import { useMemo, useState } from "react";
import { BackToHub, BarRow, Kpi, RunRow, SourcePills, ToolIntro } from "@/components/tools/ToolBits";
import { useTools } from "@/components/tools/ToolsProvider";
import { satelliteMixSlices } from "@/lib/landcover";
import { estimateCoolingPlan } from "@/lib/tools/cooling";

export default function CoolingPlanPage() {
  const { analysis, enrichment, threshold, shareQ, runScore, runHours, scoreBusy, hoursBusy, hours, error } =
    useTools();
  const [canopy, setCanopy] = useState(10);
  const [roof, setRoof] = useState(0);
  const [pave, setPave] = useState(0);
  const currentCanopy = enrichment?.satellite?.buckets?.canopy_pct ?? null;
  const plan = useMemo(() => {
    if (!analysis) return null;
    return estimateCoolingPlan({
      canopyDeltaPct: canopy,
      roofDeltaPct: roof,
      pavementDeltaPct: pave,
      currentCanopyPct: currentCanopy,
      meanC: analysis.scorecard.mean_c,
      meanHours: analysis.scorecard.mean_hours_above,
      thresholdC: analysis.scorecard.threshold_c || threshold,
    });
  }, [analysis, canopy, currentCanopy, pave, roof, threshold]);
  const mix = satelliteMixSlices(
    enrichment?.satellite?.buckets,
    enrichment?.satellite?.classes_percent,
  );
  const maxBar = Math.max(0.15, ...(plan?.attribution.map((a) => a.delta_c) || [0]));

  return (
    <div>
      <BackToHub query={shareQ} />
      <ToolIntro
        title="Cooling plan"
        lede="Literature air-temperature overlay on the neighborhood you already scored. Tree canopy uses HeatCast’s published air CE. Cool roofs and pavement are smaller district-scale estimates — not a FortyGuard re-run."
      >
        <div className="mt-3">
          <SourcePills items={["FortyGuard 2 m air (mean)", "Literature overlay", "Satellite mix if enrich lands"]} />
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
        <p className="mt-6 text-sm text-slate-400">
          Score the neighborhood first so the sliders sit on a real FortyGuard mean — not an invented baseline.
        </p>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            <Kpi
              label="Baseline mean"
              value={analysis.scorecard.mean_c != null ? `${analysis.scorecard.mean_c.toFixed(1)} °C` : "—"}
              note="FortyGuard TCM mean"
            />
            <Kpi
              label="Projected ΔT"
              value={plan ? `−${plan.estimated_delta_c.toFixed(2)} °C` : "—"}
              note="Sum of levers, cap 2 °C"
            />
            <Kpi
              label="New mean"
              value={plan?.estimated_mean_c != null ? `${plan.estimated_mean_c.toFixed(2)} °C` : "—"}
              note={`${plan?.estimated_delta_c_range.low.toFixed(2)}–${plan?.estimated_delta_c_range.high.toFixed(2)} °C band`}
            />
            <Kpi
              label="Hours saved (est.)"
              value={plan?.estimated_hours_saved != null ? `${plan.estimated_hours_saved.toFixed(2)} h` : "—"}
              note="Same hours-saved sketch as the scorecard slider"
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-[#2a313c] bg-[#161a20] p-5">
              <h2 className="text-sm font-medium text-slate-100">What-if levers</h2>
              <p className="mt-1 text-[12px] text-slate-500">
                Canopy: ~0.015 °C air per 1% (0.10–0.20 °C per +10 points). Roofs ~0.008 °C / 1%. Pavement
                ~0.005 °C / 1%. Literature estimates, not a new heatmap.
              </p>
              <Lever label={`Tree canopy +${canopy}%`} value={canopy} onChange={setCanopy} />
              <Lever label={`Cool / reflective roofs +${roof}%`} value={roof} onChange={setRoof} />
              <Lever label={`Cool / permeable pavement +${pave}%`} value={pave} onChange={setPave} />
              {currentCanopy != null ? (
                <p className="mt-3 text-[11px] text-slate-500">
                  Current hotspot canopy from satellite buckets: {currentCanopy.toFixed(1)}%. Slider cannot push
                  total canopy past 80%.
                </p>
              ) : (
                <p className="mt-3 text-[11px] text-slate-500">
                  Satellite mix still loading or unavailable — canopy room is uncapped except the +40% slider limit.
                </p>
              )}
            </section>

            <section className="rounded-xl border border-[#2a313c] bg-[#161a20] p-5">
              <h2 className="text-sm font-medium text-slate-100">Where the cooling comes from</h2>
              <p className="mt-1 text-[12px] text-slate-500">Attribution of the projected air ΔT. Not LST CE.</p>
              <div className="mt-4 space-y-3">
                {plan?.attribution.map((row) => (
                  <BarRow
                    key={row.lever}
                    label={row.lever}
                    value={row.delta_c}
                    max={maxBar}
                    color={row.tone}
                    suffix=" °C"
                  />
                ))}
              </div>
            </section>
          </div>

          <section className="mt-6 rounded-xl border border-[#2a313c] bg-[#161a20] p-5">
            <h2 className="text-sm font-medium text-slate-100">Hotspot land cover</h2>
            {mix.length ? (
              <>
                <p className="mt-1 text-[12px] text-slate-500">
                  FortyGuard satellite buckets at the hotspot — not a district NLCD raster, not invented building
                  shares.
                </p>
                <div className="mt-3 flex h-3 overflow-hidden rounded-full">
                  {mix.map((slice) => (
                    <div key={slice.key} style={{ width: `${slice.pct}%`, background: slice.color }} title={slice.label} />
                  ))}
                </div>
                <ul className="mt-3 flex flex-wrap gap-3 text-[12px] text-slate-400">
                  {mix.map((slice) => (
                    <li key={slice.key}>
                      <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: slice.color }} />
                      {slice.label} {slice.pct.toFixed(1)}%
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-500">
                No satellite mix yet for this hotspot. Composition is omitted rather than invented.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Lever({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="mt-4 block text-[12px] text-slate-300">
      {label}
      <input
        type="range"
        min={0}
        max={40}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-cyan-400"
      />
    </label>
  );
}
