"use client";

import {
  resolveUnrelieved,
  unrelievedSentence,
  UNRELIEVED_CITATION_TITLE,
  UNRELIEVED_FORMULA,
  type ScorecardHours,
} from "@/lib/unrelieved";

function UnrelievedGauge({ ratio }: { ratio: number }) {
  const r = 20;
  const cx = 28;
  const cy = 28;
  const polar = (t: number) => {
    const theta = Math.PI * (1 - Math.min(1, Math.max(0, t)));
    return { x: cx + r * Math.cos(theta), y: cy - r * Math.sin(theta) };
  };
  const left = polar(0);
  const right = polar(1);
  const tip = polar(ratio);
  return (
    <svg viewBox="0 0 56 36" className="h-9 w-14 shrink-0" role="img" aria-label={`Unrelieved-heat ratio ${ratio.toFixed(2)}`}>
      <path
        d={`M ${left.x} ${left.y} A ${r} ${r} 0 0 1 ${right.x} ${right.y}`}
        fill="none"
        stroke="#161a20"
        strokeWidth={5}
        strokeLinecap="round"
      />
      {ratio > 0 && (
        <path
          d={`M ${left.x} ${left.y} A ${r} ${r} 0 0 1 ${tip.x} ${tip.y}`}
          fill="none"
          stroke="#3dd6c6"
          strokeWidth={5}
          strokeLinecap="round"
        />
      )}
      <text x={cx} y={34} textAnchor="middle" fill="#e8edf4" fontSize={9} fontFamily="ui-monospace, monospace">
        {ratio.toFixed(2)}
      </text>
    </svg>
  );
}

/** Compact scorecard chip. Works on page.tsx or app/page.tsx scorecards. */
export default function UnrelievedChip({ scorecard }: { scorecard: ScorecardHours }) {
  const metric = resolveUnrelieved(scorecard);
  if (!metric) return null;
  const sentence = unrelievedSentence(
    metric.ratio,
    scorecard.mean_streak_hours,
    scorecard.mean_hours_above,
    scorecard.threshold_c,
  );
  const href = metric.citation_url;
  const title = metric.citation_title || UNRELIEVED_CITATION_TITLE;
  return (
    <div className="space-y-1 border-t border-[#2a313c] pt-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide text-cyan-400/80">Unrelieved-heat ratio</p>
        <UnrelievedGauge ratio={metric.ratio} />
      </div>
      <p className="text-[11px] leading-snug text-slate-300">{sentence}</p>
      <p className="text-[10px] leading-snug text-slate-500">
        {metric.formula || UNRELIEVED_FORMULA}. HeatCast index, not a work/rest table.{" "}
        {href ? (
          <a className="text-cyan-400/80 hover:underline" href={href} target="_blank" rel="noreferrer">
            {title}
          </a>
        ) : (
          title
        )}
      </p>
    </div>
  );
}
