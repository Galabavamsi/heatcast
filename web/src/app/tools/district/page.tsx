"use client";

import { useMemo, useState } from "react";
import { BackToHub, BarRow, Kpi, RunRow, SourcePills, ToolIntro } from "@/components/tools/ToolBits";
import { useTools } from "@/components/tools/ToolsProvider";
import { fetchSvi } from "@/lib/api";
import { districtHeatcastIndex } from "@/lib/tools/district";

export default function DistrictScorePage() {
  const { hours, analysis, shareQ, runHours, runScore, hoursBusy, scoreBusy, error, threshold, bbox } =
    useTools();
  const [meanSvi, setMeanSvi] = useState<number | null>(null);
  const [sviBusy, setSviBusy] = useState(false);
  const [sviNote, setSviNote] = useState<string | null>(null);

  const preview = useMemo(() => {
    const site = hours?.site_hours;
    const peak = hours?.peak;
    return districtHeatcastIndex({
      meanC: site?.mean_air_c ?? hours?.district_preview?.mean_c ?? null,
      thresholdC: threshold,
      meanHoursAbove: site?.hours_above ?? peak?.hours_above ?? null,
      meanStreakHours: peak?.unrelieved_streak_h ?? null,
      source: "open-meteo",
    });
  }, [hours, threshold]);

  const scored = useMemo(() => {
    if (!analysis) return null;
    return districtHeatcastIndex({
      meanC: analysis.scorecard.mean_c,
      thresholdC: analysis.scorecard.threshold_c || threshold,
      meanHoursAbove: analysis.scorecard.mean_hours_above,
      meanStreakHours: analysis.scorecard.mean_streak_hours,
      unrelievedRatio: analysis.scorecard.unrelieved_heat_ratio,
      meanSvi,
      source: meanSvi != null ? "fortyguard+svi" : "fortyguard",
    });
  }, [analysis, meanSvi, threshold]);

  const index = scored || preview;
  const sourceLabel = analysis
    ? meanSvi != null
      ? "FortyGuard tiles + CDC SVI"
      : "FortyGuard tiles"
    : "Open-Meteo preview";

  async function joinSvi() {
    setSviBusy(true);
    setSviNote(null);
    try {
      const doc = await fetchSvi({ bbox, heatmap: analysis?.heatmap });
      const raw = doc.summary.mean_svi;
      if (raw == null) {
        setSviNote("SVI tracts returned without a mean. Overlay omitted.");
        return;
      }
      const pct = raw > 1 ? raw / 100 : raw;
      setMeanSvi(pct);
      setSviNote(doc.summary.planner_sentence || `Mean SVI ${pct.toFixed(2)} (0–1).`);
    } catch (err) {
      setSviNote(err instanceof Error ? err.message : "SVI join failed");
    } finally {
      setSviBusy(false);
    }
  }

  const maxComp = 1;
  const comps = [
    { key: "intensity", label: "Intensity (mean vs threshold)", tone: "#fbbf24" },
    { key: "exceedance", label: "Exceedance hours", tone: "#fb7185" },
    { key: "unrelieved", label: "Unrelieved streak", tone: "#22d3ee" },
    { key: "svi", label: "SVI overlay", tone: "#c084fc" },
  ] as const;

  return (
    <div>
      <BackToHub query={shareQ} />
      <ToolIntro
        title="District score"
        lede="A 0–100 HeatCast index from the same scorecard math used on /app: mean air, hours above threshold, and unrelieved streak. Open-Meteo fills the page before Score. Optional CDC SVI is a vulnerability overlay — not insurance, not a FICO of heat, not a parametric payout."
      >
        <div className="mt-3">
          <SourcePills items={[sourceLabel, `${threshold} °C threshold`, "Not insurance / parametric"]} />
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

      {index.ok && index.index != null ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            <Kpi
              label="HeatCast index"
              value={String(index.index)}
              note={`${index.band || "—"} · 0–100`}
              warn={index.index >= 50}
            />
            <Kpi
              label="Mean air"
              value={index.mean_c != null ? `${index.mean_c.toFixed(1)} °C` : "—"}
              note={analysis ? "FortyGuard TCM mean" : "Open-Meteo daily mean"}
            />
            <Kpi
              label="Hours ≥ threshold"
              value={index.mean_hours_above != null ? `${index.mean_hours_above}` : "—"}
              note={analysis ? "Tile exceedance mean" : "Open-Meteo clock hours"}
            />
            <Kpi
              label="Unrelieved"
              value={index.unrelieved_ratio != null ? index.unrelieved_ratio.toFixed(2) : "—"}
              note="Streak ÷ hours"
            />
          </div>

          <section className="mt-6 rounded-xl border border-[#2a313c] bg-[#161a20] p-5">
            <h2 className="text-sm font-medium text-slate-100">What goes into the index</h2>
            <p className="mt-1 text-[12px] text-slate-500">{index.note}</p>
            <div className="mt-4 space-y-3">
              {comps.map((row) => {
                const value = index.components[row.key];
                if (value == null) return null;
                return (
                  <BarRow
                    key={row.key}
                    label={`${row.label} · w ${index.weights[row.key] ?? "—"}`}
                    value={value}
                    max={maxComp}
                    color={row.tone}
                  />
                );
              })}
            </div>
            <p className="mt-4 font-mono text-[11px] text-slate-500">{index.formula}</p>
          </section>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void joinSvi()}
              disabled={sviBusy || !analysis}
              className="rounded-lg border border-[#2a313c] px-3 py-1.5 text-[12px] text-slate-200 hover:border-cyan-400/50 disabled:opacity-50"
            >
              {sviBusy ? "Joining SVI…" : meanSvi != null ? "Refresh SVI overlay" : "Join CDC SVI"}
            </button>
            {!analysis ? (
              <span className="text-[12px] text-slate-500">Score tiles before joining SVI to the box.</span>
            ) : null}
          </div>
          {sviNote ? <p className="mt-2 text-[12px] text-slate-400">{sviNote}</p> : null}
          {!analysis && index.mean_c != null && index.mean_c < threshold ? (
            <p className="mt-3 text-[12px] text-slate-500">
              Open-Meteo km-scale mean ({index.mean_c.toFixed(1)} °C) is below the {threshold} °C tile
              threshold, so the preview index stays modest. Score neighborhood tiles for the 100 m
              HeatCast index.
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-6 text-sm text-slate-400">
          {hoursBusy ? "Loading Open-Meteo preview…" : index.missing || "Index needs hourly context or a Score."}
        </p>
      )}
    </div>
  );
}
