import type { Metadata } from "next";
import { SiteFooter, SiteNav } from "@/components/SiteNav";
import {
  UNRELIEVED_CITATION_TITLE,
  UNRELIEVED_CITATION_URL,
  UNRELIEVED_FORMULA,
  UNRELIEVED_METHOD_BLURB,
  UNRELIEVED_OSHA_URL,
} from "@/lib/unrelieved";

export const metadata: Metadata = {
  title: "Method",
  description: "What HeatCast layers are, and what they are not. United States only.",
};

export default function MethodPage() {
  return (
    <div className="method-page flex min-h-dvh flex-col bg-[#0b0d10] text-[#e8edf4]">
      <header className="no-print mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-6">
        <SiteNav active="method" />
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pb-16 pt-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-cyan-400">United States only</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-50">Method</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          HeatCast scores a drawn neighborhood. Each overlay is a separate public source. FortyGuard is the air and duration API among them — not the name on every chip.
        </p>

        <section className="mt-10 space-y-6 text-sm leading-relaxed text-slate-300">
          <h2 className="text-[10px] uppercase tracking-wide text-cyan-400">What each layer is</h2>
          <dl className="space-y-5">
            <div>
              <dt className="font-medium text-slate-100">2 m air tiles</dt>
              <dd className="mt-1 text-slate-400">
                ~100 m tiles of 2 m air temperature for the hour you pick. Mean, max, and share of tiles above a threshold come from this snapshot.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-100">Hours vs streak</dt>
              <dd className="mt-1 text-slate-400">
                Exceedance is total hours above the threshold. Persistence is the longest consecutive run. Both are duration layers on the same grid — not a new heatmap recipe. Pick From = To for one day, or a window up to 7 days. The duration API is one day or a range-of-days product — not a custom 3-day exceedance. Air tiles, shade, and comfort still use From + Hour.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-100">Unrelieved-heat ratio</dt>
              <dd className="mt-1 text-slate-400">
                {UNRELIEVED_METHOD_BLURB} Formula:{" "}
                <span className="font-mono text-[11px] text-slate-300">{UNRELIEVED_FORMULA}</span>.{" "}
                <a
                  className="text-cyan-400/80 hover:underline"
                  href={UNRELIEVED_CITATION_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  {UNRELIEVED_CITATION_TITLE}
                </a>
                {" · "}
                <a
                  className="text-cyan-400/80 hover:underline"
                  href={UNRELIEVED_OSHA_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  OSHA proposed heat standard
                </a>
                .
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-100">Range ΔT</dt>
              <dd className="mt-1 text-slate-400">
                When From ≠ To, Score fetches a second 2 m air snapshot at To + the same Hour and subtracts From. Positive tiles got hotter. ΔT edges is a crude |∇ΔT| on the 100 m grid — park-vs-parking-lot boundaries, noisy, not a heat flux. Play only previews Hour; it does not recompute ΔT.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-100">CDC SVI</dt>
              <dd className="mt-1 text-slate-400">
                Census tracts from CDC/ATSDR Social Vulnerability Index 2022, drawn as an SVG overlay and joined to tiles in the box.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-100">OSM indoor pins</dt>
              <dd className="mt-1 text-slate-400">
                OpenStreetMap libraries, community centres, social facilities, and town halls in the box. Sports centres can appear on the map but are not walk destinations.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-100">OSRM walk</dt>
              <dd className="mt-1 text-slate-400">
                Walking geometry from the hotspot to the nearest indoor OSM site. A thin access check — not a citywide cool-route optimizer.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-100">SunCalc shade</dt>
              <dd className="mt-1 text-slate-400">
                OSM building footprints plus sun altitude/azimuth for the chosen hour. Approximate umbra length, not measured shade or tree canopies.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-100">Literature canopy</dt>
              <dd className="mt-1 text-slate-400">
                A slider that estimates a small air-temperature change from added canopy (about 0.015 °C per 1%, capped). Pins you plant are visual. Neither is a new satellite or heatmap run.
              </dd>
            </div>
          </dl>
        </section>

        <section className="mt-12 space-y-4 text-sm leading-relaxed text-slate-300">
          <h2 className="text-[10px] uppercase tracking-wide text-cyan-400">What it is not</h2>
          <ul className="list-disc space-y-2 pl-5 text-slate-400">
            <li>An official cooling-center network or scraped city list.</li>
            <li>UTCI, NWS HeatRisk, or a comfort index treated as the score.</li>
            <li>A new heatmap generated from trees or land-surface temperature cooling.</li>
            <li>An animated ΔT movie. Range ΔT is two TCM snapshots at the scored Hour (To − From); Play does not recompute it.</li>
            <li>Coverage outside the United States.</li>
          </ul>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
