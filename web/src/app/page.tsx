import Link from "next/link";
import { SiteFooter, SiteNav } from "@/components/SiteNav";

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-[#0b0d10] text-[#e8edf4]">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <SiteNav active="home" />
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 pb-16 pt-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-cyan-400">United States</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-slate-50 sm:text-5xl">
          A neighborhood heat scorecard for US planners.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-400">
          Draw a district. See how long the air stays hot, how far the hotspot is from indoor public space, and where a planting sketch would land. Then export the brief.
        </p>
        <div className="mt-8">
          <Link
            href="/app"
            className="inline-flex rounded-lg bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-[#0b0d10] transition hover:bg-cyan-300"
          >
            Score a neighborhood
          </Link>
        </div>

        <ul className="mt-16 grid gap-8 sm:grid-cols-3">
          <li>
            <p className="text-[10px] uppercase tracking-wide text-cyan-400">Duration</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Hours above a heat threshold versus the longest consecutive streak — summarized as an unrelieved-heat ratio (streak ÷ hours) on the same ~100 m air tiles, not a second product.
            </p>
          </li>
          <li>
            <p className="text-[10px] uppercase tracking-wide text-cyan-400">Indoor access</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              A walk from the hotspot to the nearest OSM library or community centre. Not an official cooling-center network.
            </p>
          </li>
          <li>
            <p className="text-[10px] uppercase tracking-wide text-cyan-400">Planting sketch</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Pins on hottest fabric plus a literature canopy slider. Labeled as a sketch — not a new satellite heatmap.
            </p>
          </li>
        </ul>
      </main>

      <SiteFooter />
    </div>
  );
}
