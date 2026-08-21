import Link from "next/link";

export type SiteSection = "home" | "score" | "method";

export function SiteNav({
  active,
  compact = false,
}: {
  active: SiteSection;
  compact?: boolean;
}) {
  const links: Array<{ href: string; id: SiteSection; label: string }> = [
    { href: "/app", id: "score", label: "Score" },
    { href: "/method", id: "method", label: "Method" },
  ];
  return (
    <nav className={compact ? "flex min-w-0 flex-col gap-1" : "flex items-center gap-6"}>
      <Link
        href="/"
        aria-current={active === "home" ? "page" : undefined}
        className={
          compact
            ? "text-[10px] font-medium uppercase tracking-[0.28em] text-cyan-400"
            : "text-[11px] font-medium uppercase tracking-[0.28em] text-cyan-400"
        }
      >
        HeatCast
      </Link>
      <div
        className={
          compact
            ? "flex items-center gap-2 text-[11px] text-slate-400"
            : "flex items-center gap-4 text-sm text-slate-400"
        }
      >
        {compact && (
          <Link href="/" className="hover:text-cyan-200">
            Home
          </Link>
        )}
        {links.map((link) => {
          const on = active === link.id;
          return (
            <Link
              key={link.id}
              href={link.href}
              aria-current={on ? "page" : undefined}
              className={on ? "text-slate-100" : "hover:text-cyan-200"}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-[#2a313c] px-6 py-6 text-[11px] text-slate-500">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2">
        <p>Air tiles · CDC SVI · OSM · OSRM</p>
        <p>United States only</p>
      </div>
    </footer>
  );
}
