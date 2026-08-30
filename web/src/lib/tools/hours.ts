import type { HoursResponse } from "@/lib/types";

export function omAirAt(hours: HoursResponse | null, time: string): number | null {
  if (!hours) return null;
  const clock = time.slice(0, 5);
  const peak = hours.peak?.hours.find((h) => h.hour === clock);
  if (peak?.temp_c != null) return peak.temp_c;
  const site = hours.site_hours?.hours.find((h) => h.hour === clock);
  if (site?.air_c != null) return site.air_c;
  const idx = hours.hourly?.times.findIndex((t) => t.startsWith(clock.slice(0, 2)));
  if (idx != null && idx >= 0) {
    const t = hours.hourly?.temp_c[idx];
    if (t != null) return t;
  }
  return hours.comfort?.temp_c ?? null;
}

export function omApparentAt(hours: HoursResponse | null, time: string): number | null {
  if (!hours) return null;
  const clock = time.slice(0, 5);
  const site = hours.site_hours?.hours.find((h) => h.hour === clock);
  if (site?.apparent_c != null) return site.apparent_c;
  const idx = hours.hourly?.times.findIndex((t) => t.startsWith(clock.slice(0, 2)));
  if (idx != null && idx >= 0) {
    const t = hours.hourly?.apparent_c[idx];
    if (t != null) return t;
  }
  return hours.comfort?.apparent_c ?? null;
}

export function omHoursAbove(hours: HoursResponse | null): number | null {
  if (!hours) return null;
  if (hours.site_hours?.hours_above != null) return hours.site_hours.hours_above;
  if (hours.peak?.hours_above != null) return hours.peak.hours_above;
  return null;
}
