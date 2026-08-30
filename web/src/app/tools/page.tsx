"use client";

import Link from "next/link";
import { useTools } from "@/components/tools/ToolsProvider";
import { SourcePills } from "@/components/tools/ToolBits";

const TOOLS = [
  {
    href: "cooling",
    title: "Cooling plan",
    tag: "Neighborhood",
    infer: "What-if canopy, cool-roof, and pavement sliders on the scored mean. Attribution of projected ΔT.",
    not: "Not a new FortyGuard heatmap. Roof and pavement are literature air estimates.",
  },
  {
    href: "walk",
    title: "Walk exposure",
    tag: "Access",
    infer: "OSRM walk from the hotspot to the nearest indoor OSM site, sampled on nearest 2 m air tiles.",
    not: "Not cargo, vaccines, WBGT, or OSHA. Not a citywide cool-route planner.",
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
] as const;

const SOON = [
  { title: "Site hour table", note: "Tile-by-tile hour grid once we cache a full diurnal TCM — not faked." },
  { title: "Carbon-aware window", note: "Needs a real grid-carbon series. Not invented kgCO2." },
  { title: "Insurance heat score", note: "A portfolio index would be a new product. Not on this path." },
];

export default function ToolsHubPage() {
  const { shareQ, placeName, date, time, threshold, analysis, hours } = useTools();
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-cyan-400">Inferred analysis</p>
      <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-slate-50">
        Tools on the same neighborhood score.
      </h1>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-400">
        HeatCast stays HeatCast. FortyGuard is the 2 m air and duration API. These views infer from tiles you
        already score, plus Open-Meteo and OSRM — they do not clone other product names.
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

      <section className="mt-12">
        <h2 className="text-[10px] uppercase tracking-wide text-slate-500">Coming later — not faked</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-3">
          {SOON.map((item) => (
            <li key={item.title} className="rounded-xl border border-dashed border-[#2a313c] p-4">
              <p className="text-sm font-medium text-slate-300">{item.title}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-500">{item.note}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
