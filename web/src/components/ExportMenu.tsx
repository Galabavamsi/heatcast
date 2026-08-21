"use client";

import type { MouseEvent } from "react";

type Props = {
  hasTiles?: boolean;
  hasBrief?: boolean;
  onScorecard: () => void;
  onAoi: () => void;
  onBrief: () => void;
  onTiles: () => void;
  onCopyBrief: () => void;
  onCopyLink: () => void;
  copied?: "brief" | "link" | null;
};

function closeMenu(e: MouseEvent<HTMLButtonElement>) {
  const details = e.currentTarget.closest("details");
  if (details) details.removeAttribute("open");
}

export default function ExportMenu({
  hasTiles,
  hasBrief,
  onScorecard,
  onAoi,
  onBrief,
  onTiles,
  onCopyBrief,
  onCopyLink,
  copied,
}: Props) {
  const item =
    "block w-full px-3 py-2 text-left text-[12px] text-slate-200 hover:bg-cyan-400/10 disabled:opacity-40";
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-lg border border-[#2a313c] bg-[#0b0d10] px-3 py-2 text-sm text-slate-100 marker:content-none [&::-webkit-details-marker]:hidden">
        Export
      </summary>
      <div className="absolute right-0 z-40 mt-1 w-52 overflow-hidden rounded-lg border border-[#2a313c] bg-[#161a20] py-1 shadow-xl">
        <button
          type="button"
          className={item}
          onClick={(e) => {
            closeMenu(e);
            onScorecard();
          }}
        >
          Scorecard JSON
        </button>
        <button
          type="button"
          className={item}
          onClick={(e) => {
            closeMenu(e);
            onAoi();
          }}
        >
          AOI + hotspot GeoJSON
        </button>
        <button
          type="button"
          className={item}
          disabled={!hasBrief}
          onClick={(e) => {
            closeMenu(e);
            onBrief();
          }}
        >
          Planner brief (.txt)
        </button>
        <button
          type="button"
          className={item}
          disabled={!hasTiles}
          onClick={(e) => {
            closeMenu(e);
            onTiles();
          }}
        >
          Hours / TCM GeoJSON
        </button>
        <div className="my-1 h-px bg-[#2a313c]" />
        <button
          type="button"
          className={item}
          disabled={!hasBrief}
          onClick={(e) => {
            closeMenu(e);
            onCopyBrief();
          }}
        >
          {copied === "brief" ? "Brief copied" : "Copy brief"}
        </button>
        <button
          type="button"
          className={item}
          onClick={(e) => {
            closeMenu(e);
            onCopyLink();
          }}
        >
          {copied === "link" ? "Link copied" : "Copy share link"}
        </button>
      </div>
    </details>
  );
}
