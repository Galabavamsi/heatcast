import Link from "next/link";
import type { ReactNode } from "react";

export function SourcePills({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full border border-[#2a313c] px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

export function Kpi({
  label,
  value,
  note,
  warn,
}: {
  label: string;
  value: string;
  note?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#2a313c] bg-[#161a20] p-4">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${warn ? "text-amber-200" : "text-slate-50"}`}>{value}</p>
      {note ? <p className="mt-1 text-[11px] text-slate-500">{note}</p> : null}
    </div>
  );
}

export function BarRow({
  label,
  value,
  max,
  color,
  suffix,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  suffix?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-[12px] text-slate-300">
        <span>{label}</span>
        <span className="font-mono text-slate-400">
          {value.toFixed(2)}
          {suffix}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#0b0d10]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export function RunRow({
  onHours,
  onScore,
  hoursBusy,
  scoreBusy,
  hoursReady,
  scoreReady,
}: {
  onHours: () => void;
  onScore: () => void;
  hoursBusy: boolean;
  scoreBusy: boolean;
  hoursReady: boolean;
  scoreReady: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onHours}
        disabled={hoursBusy}
        className="rounded-lg border border-[#2a313c] px-3 py-1.5 text-[12px] text-slate-200 hover:border-cyan-400/50 disabled:opacity-50"
      >
        {hoursBusy ? "Loading hours…" : hoursReady ? "Refresh hourly" : "Load hourly context"}
      </button>
      <button
        type="button"
        onClick={onScore}
        disabled={scoreBusy}
        className="rounded-lg bg-cyan-400 px-3 py-1.5 text-[12px] font-semibold text-[#0b0d10] hover:bg-cyan-300 disabled:opacity-50"
      >
        {scoreBusy ? "Scoring neighborhood…" : scoreReady ? "Re-score tiles" : "Score neighborhood tiles"}
      </button>
    </div>
  );
}

export function ToolIntro({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6">
      <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-cyan-400">HeatCast tools</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-50">{title}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">{lede}</p>
      {children}
    </div>
  );
}

export function BackToHub({ query }: { query: string }) {
  return (
    <Link href={`/tools${query}`} className="text-[12px] text-cyan-400 hover:text-cyan-200">
      ← All tools
    </Link>
  );
}
