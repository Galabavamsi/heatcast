"use client";

import Link from "next/link";
import { useTools } from "@/components/tools/ToolsProvider";
import { SourcePills } from "@/components/tools/ToolBits";

const TOOLS = [
  {
    href: "hours",
    title: "Site hours",
    tag: "Hour table",
    infer: "Hour-by-hour Open-Meteo air, apparent temperature, humidity, and a cooling-demand proxy. After Score, FortyGuard mean sits beside the selected hour.",
    not: "Not data-center PUE. Not a cached diurnal TCM grid.",
  },
  {
    href: "peak",
    title: "Peak hours",
    tag: "Duration",
    infer: "Hour-by-hour heat-load proxy and unrelieved streak from Open-Meteo, plus FortyGuard hours/streak after Score.",
    not: "Not transformer MW, duck curve, or EIA. Solar GHI is Open-Meteo if present.",
  },
  {
    href: "compound",
    title: "Compound hours",
    tag: "Air + heat",
    infer: "Hours when heat coincides with high humidity and/or Open-Meteo US AQI.",
    not: "Not FortyGuard env AQI. No CO2 or methane charts.",
  },
  {
    href: "shift",
    title: "Shift window",
    tag: "When to move",
    infer: "Best cool / low-demand daylight hours from Open-Meteo heat + GHI. A 4-hour block to prefer, and the hottest block to avoid.",
    not: "Not grid carbon, gCO2/kWh, Electricity Maps, or EIA.",
  },
  {
    href: "cooling",
    title: "Cooling plan",
    tag: "Neighborhood",
    infer: "What-if canopy, cool-roof, and pavement sliders on Open-Meteo air now, FortyGuard mean after Score. Attribution of projected ΔT.",
    not: "Not a new FortyGuard heatmap. Roof and pavement are literature air estimates.",
  },
  {
    href: "walk",
    title: "Walk exposure",
    tag: "Access",
    infer: "OSRM walk from the neighborhood center (or hotspot after Score) to the nearest indoor OSM site. Tile air after Score.",
    not: "Not cargo, vaccines, WBGT, or OSHA. Not a citywide cool-route planner.",
  },
  {
    href: "district",
    title: "District score",
    tag: "HeatCast index",
    infer: "0–100 HeatCast index from mean air, exceedance hours, and unrelieved streak. Optional CDC SVI overlay after Score.",
    not: "Not insurance, not a FICO of heat, not a parametric payout.",
  },
] as const;

export default function ToolsHubPage() {
  const { shareQ, placeName, date, time, threshold, analysis, hours } = useTools();
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-cyan-400">Inferred analysis</p>
      <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-slate-50">
        Tools on the same neighborhood score.
      </h1>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-400">
        HeatCast stays HeatCast. FortyGuard is the 2 m air and duration API. These views infer from
        Open-Meteo and OSM immediately, then add tiles you score — they do not clone other product names.
      </p>
      <div className="mt-4">
        <SourcePills
          items={[
            `${placeName}`,
            date,
            time,
            `${threshold} °C threshold`,
            analysis ? "tiles scored" : "tiles not scored yet",
            hours ? "hourly loaded" : "hourly pending",
          ]}
        />
      </div>

      <ul className="mt-10 grid gap-4 sm:grid-cols-2">
        {TOOLS.map((tool) => (
          <li key={tool.href}>
            <Link
              href={`/tools/${tool.href}${shareQ}`}
              className="flex h-full flex-col rounded-xl border border-[#2a313c] bg-[#161a20] p-5 transition hover:border-cyan-400/40"
            >
              <p className="text-[10px] uppercase tracking-wide text-cyan-400">{tool.tag}</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-50">{tool.title}</h2>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-400">{tool.infer}</p>
              <p className="mt-3 text-[12px] text-slate-500">{tool.not}</p>
              <span className="mt-4 text-[12px] text-cyan-400">Open tool →</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
