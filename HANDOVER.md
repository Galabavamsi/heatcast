# HeatCast handover (living)

This is the **team working doc**. Two people maintain it: whoever is on the keyboard today, and the other developer.  
Product README (clone-and-run): [README.md](./README.md).

| | |
|---|---|
| **Repo** | https://github.com/Galabavamsi/heatcast (`origin/main`) |
| **Disk** | `D:\fortyguard\heatlens` |
| **Team** | HumanSlop · FG-141 · Track 1 urban planning |
| **Deadline** | **30 Aug 2026** |
| **Collaborator** | GitHub user **Hackathon-FG** (write) |
| **Last snapshot** | 21 Aug 2026 |

**Secrets stay out of git.** `FORTYGUARD_API_KEY` and `LLM_API_KEY` live only in gitignored `api/.env`. Do not paste keys into this file, PRs, or chat logs you will commit.

---

## How both of us keep this file current

Overwrite the **Snapshot** block when the truth changes. **Append** the changelog and decision log — do not rewrite history.

1. Date every edit (`YYYY-MM-DD`) and put your name or GitHub handle in the changelog row.
2. If you ship code, add a changelog row **in the same PR/commit** when you can. If you forget, add it in the next commit — stale handover is worse than a late row.
3. If you change a product rule (track, date, overlay formula, “do not build X”), add a **Decision** row and update Snapshot. Do not silently contradict RESEARCH-*.md; either update research or say “handover wins until research is patched.”
4. Open work is a checklist. Move items to **Done** with a date; do not delete them.
5. Hard-won map bugs are **do not regress**. If you fix one for real, move it to Done and leave a one-line “why it was real.”
6. Never commit `.env`, cache dumps with PII, or API keys. `api/.env.example` may document variable *names* only.

Suggested commit trailers (optional): `Handover: snapshot + changelog`.

---

## Snapshot — overwrite this block

**As of 21 Aug 2026**

HeatCast scores a **drawn US AOI** on FortyGuard TCM + exceedance, then overlays SVI / shade / cooling and a planner brief.

| Area | State |
|---|---|
| Score / heatmap | Working. Canvas raster image source. Demo date `2024-07-15 15:00`. |
| Draw / pan / orbit | Working. Custom orbit `easeTo({ around })`. Native `dragRotate` stays off. |
| Layers | Isolines (canvas), SVI (SVG), Shade (SVG), Cooling (Markers). Toggles enabled whenever `analysis` exists; labels show `Shade…` / `Cooling…` while OSM loads. |
| Planner brief | Analyze writes a **template** immediately. Client calls `POST /v1/brief` after enrich + SVI (and cooling/shade if ready). DeepSeek `deepseek-v4-flash` if `LLM_*` is set. Null layers are stripped so the model cannot refuse EPA/i-Tree just because flood is missing. |
| Enrich | Satellite + env first (~45 s), streetview/PDF extra (~12 s), pool `shutdown(wait=False)`. Browser abort **80 s**. Streetview timeouts are not a red banner if satellite/env arrived. |
| OSM | Sequential cooling then buildings. Overpass fail-open + disk cache. |
| LLM | Server-only. Model **`deepseek-v4-flash`** (this key also has `deepseek-v4-pro`; no `deepseek-chat`). |
| Public deploy | **Not shipped.** CORS is localhost-only. Render needs `0.0.0.0:$PORT`, server env keys, CORS + `NEXT_PUBLIC_API_URL`. |
| Judging caches | **Not frozen.** EaDo / Museum / Phoenix `2024-07-15` should be cached before demo day. |
| Video + 500-word summary | **Not started.** |

**Do not start:** UTCI, NWS HeatRisk, deck.gl, India, walking/OSRM, bus-stop clones, a second product.

---

## Changelog (append at the top)

| Date | Who | What |
|---|---|---|
| 2026-08-21 | Vamsi / agent | README: screenshots + East Downtown worked example (who it’s for, every control, real 15:00 numbers). Images in `docs/images/`. |
| 2026-08-21 | Vamsi / agent | Brief after enrich: `POST /v1/brief`, compact LLM context, enrich two-phase + 80 s client timeout, FEMA 8 s, `HANDOVER.md` + README living docs. |
| 2026-08-21 | Vamsi / agent | DeepSeek brief path (`thinking` disabled, 40 s). OSM fail-open, sequential load, shade SunCalc **degrees**. Search dropdown `skipGeocode`. GitHub `Galabavamsi/heatcast`. Status-poll **403 retry** in `api/fortyguard/client.py`. |
| 2026-08-20 | Vamsi / agent | Initial HeatCast FastAPI + Next/MapLibre: AOI draw, TCM + exceedance, SVI, scenario overlay, 3D orbit. |

---

## Open work (move to Done, don’t delete)

### Must before 30 Aug

- [ ] Freeze **EaDo + Museum District** (optional Phoenix) TCM + exceedance + OSM caches for **2024-07-15 15:00** so judging is not a live credit lottery.
- [ ] Public **Render** (or similar) demo: API + web, no login. Bind `0.0.0.0:$PORT`. Keys in server env. CORS for the web origin. `NEXT_PUBLIC_API_URL` at web **build** time.
- [ ] Confirm **Hackathon-FG** still has write on github.com/Galabavamsi/heatcast.
- [ ] **~3 min video** + **~500 word** summary. Pitch: hours above threshold on a real district, greener control tract same day, slider that does **not** pretend to be FortyGuard. Keep activity_ids on the confidence strip.

### Nice if time

- [ ] Persistence layer on the scorecard: longest *consecutive* hours ≥ 35 °C (fork notebooks; exceedance already exists as total hours).
- [ ] Cause-tagged recs already start in the brief when satellite buckets exist (EPA cool pavement / USDA i-Tree). Tighten copy once Houston satellite numbers are on a frozen cache.
- [ ] Optional second LLM pass is already gated by layer keys; watch DeepSeek spend if cooling/shade retrigger brief too often.

### Done

- [x] 2026-08-21 — Planner brief no longer runs at analyze with all-null satellite/SVI.
- [x] 2026-08-21 — Enrich does not block the HTTP response on timed-out FortyGuard workers (`shutdown(wait=False)`).
- [x] 2026-08-20/21 — Draw AOI, canvas heat, SVI SVG, OSM shade/cooling, custom orbit, US-only geocode.

---

## Decision log (append only)

| Date | Decision | Why |
|---|---|---|
| 2026-08 | Track **1** HeatCast, not HeatHall / Track 3 | RESEARCH-3D-URBAN.md overrides RESEARCH-PIVOT.md on product. Keep pivot’s FG calling rules. |
| 2026-08 | No walking routes / OSRM | Official Track 1 examples already include Cool Route Planner. |
| 2026-08 | US only, demo **2024-07-15 15:00** | FG heatmap coverage; Phoenix 2026-08-17 empty-success billing trap. |
| 2026-08 | Canopy slider = **air** CE ~0.015 °C / 1%, cap 2 °C, not LST | FortyGuard is 2 m air. Du et al. 2024. |
| 2026-08 | Analyze must not wait on enrich, OSM, or LLM | Heatmap is the product; extras fail-open. |
| 2026-08-21 | LLM brief **after** satellite + SVI | First brief with nulls refused EPA/i-Tree recs. |
| 2026-08-21 | DeepSeek **flash**, not `deepseek-chat` | This key only lists `deepseek-v4-flash` and `deepseek-v4-pro`. |

---

## What this is / is not

**Is:** Track 1 urban-planner simulator. Score a US district on FortyGuard **2 m air** tiles, then estimate extra tree canopy with a **labeled literature overlay**. 2D is the scorecard. 3D is pitched OSM massing + heat. UI name HeatCast; folder `heatlens`.

**Is not:**

| Tempting | Why not |
|---|---|
| Walking / cool routes / A→B | Not our product |
| India / non-US AOIs | FG heatmap is US-only |
| “FortyGuard simulated adding trees” | No what-if heatmap. Slider does not recall FG |
| HeatHall / data-center flood screener | Superseded pivot |
| Photoreal shade / facade CFD | OSM boxes + SunCalc ≠ FG-measured shade |
| Official cooling-center map | OSM amenities only |

---

## Demo cities and dates

Presets in `api/app/cities.py`:

| District | `city_id` | Date / time | Threshold | Notes |
|---|---|---|---|---|
| Houston EaDo | `houston-eado` | **2024-07-15 15:00** | 35 °C | Default story: hotter fabric / outdoor work |
| Houston Museum District | `houston-museum` | same | 35 °C | Greener contrast, same day |
| Phoenix Downtown | `phoenix-downtown` | **2024-07-15 15:00** | 38 °C | Historic summer only |

**Phoenix `2026-08-17`:** 0 tiles + still billed. Coverage miss, never 0 °C.

AOI: closed polygon, **≤ 45 mi²**, centroid in the US. Granularity **100 m**.

---

## Architecture (where to edit)

```
api/app/main.py          routes
api/app/memo.py          template + DeepSeek brief, compact_context
api/app/scenario.py      canopy overlay (air CE)
api/app/svi.py           CDC SVI 2022
api/app/buildings.py     OSM footprints
api/app/cooling.py       OSM cooling-ish sites
api/app/overpass.py      mirrors, caps
api/app/cache.py         disk cache (gitignored)
api/app/fg.py            heatmap wrap, class percents
api/fortyguard/client.py vendored SDK + 403 status retry
web/src/app/page.tsx     Score, brief refresh, layer chrome
web/src/components/HeatMap.tsx   map (fragile)
web/src/lib/shade.ts     SunCalc degrees
web/src/lib/api.ts       fetch timeouts
```

`D:\fortyguard\temperature-api-quickstart` is **reference only**. Do not point the UI at it.

Disk: `api/cache/*.json`, `api/outputs/` — local only; Render disk is ephemeral.

---

## Endpoints

HeatCast FastAPI:

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | |
| GET | `/v1/cities` | |
| GET | `/v1/geocode` | Nominatim US |
| POST | `/v1/analyze` | TCM + exceedance + **template** memo (`use_llm=False`) |
| POST | `/v1/brief` | LLM after layers land |
| POST | `/v1/enrich` | Core satellite+env 45 s; extras 12 s; do not `wait=True` on the pool |
| POST | `/v1/svi` | |
| GET | `/v1/buildings` `/v1/cooling` `/v1/osm` | Empty FC + `meta.error` on failure |
| GET | `/v1/weather` | Open-Meteo + FEMA + elevation |
| POST | `/v1/scenario` | Overlay math only |
| GET | `/v1/credits` | |
| GET | `/v1/outputs/{file}` | PDF |

FortyGuard: `tcm` snapshot °C (`average_temperature` often, mapped to `temperature`); `exceedance` hours in `properties.value`; `environmental_parameters` ~1 km; `satellite_segmentation` class mix at **hotspot centroid** (not a district NLCD raster); streetview often times out; heat_intelligence PDF.

Client timeouts (`web/src/lib/api.ts`): enrich **80 s**, brief **50 s**, cooling **55 s**, buildings **70 s**.

---

## Tree slider

`api/app/scenario.py` + `web/src/lib/scenario.ts`:

- +10% / +20% canopy (percentage points); current + added capped at 80%; extra capped at 40 points.
- ΔT **0.10–0.20 °C per +10%**, central **0.015 °C per 1%**, **cap 2 °C**.
- Map overlay = existing GeoJSON °C minus ΔT. **Not a new FG heatmap.**
- Hours saved is a fraction of exceedance hours, not a second FG run.

---

## Map interaction (current)

- **Pan:** left-drag pan; right/Ctrl-drag orbit around AOI.
- **Draw:** left-drag box; Space pans; scroll zooms.
- **Orbit:** left-drag orbit; Space/middle pan.
- **Flat vs 3D heat:** 3D extrudes OSM buildings when loaded.
- Search: selecting a hit must **not** re-geocode (`skipGeocode`). Escape/blur closes the list.

SunCalc **v2** returns **degrees**, azimuth clockwise from north. Houston 15:00 15 Jul ≈ sun altitude **~68°**, shadows **~4 m**. Treating that as radians produced `Sun 3871°` and negative lengths.

---

## Do not regress (hard-won)

1. Heat fill = canvas raster → MapLibre **image** source `heatcast-raster`. Never redraw heat polygons on every `render`.
2. Do not `flyTo` on every AOI drag. Scroll zoom always on. Draw = left-drag. Space pans.
3. Cyan AOI mask = **SVG quad** from four `map.project` corners.
4. MapLibre fill/line layers do **not** reliably show. SVI and shade = **SVG**. Isolines **burned into** the heat canvas. Cooling = **Marker**.
5. Native `dragRotate` slides heat off-screen. Orbit with `easeTo({ around })`. `jumpTo` **ignores** `around`.
6. OSM layer switches stay **enabled** when `analysis` exists even if Overpass is empty; show ellipsis while loading. Overpass **502 → empty FC**, not a failed Score.
7. Do not put `FORTYGUARD_API_KEY` or `LLM_API_KEY` in the frontend.
8. First `/v1/status` **403** after create_heatmap can mean “not ready” — retry like the official quickstart (`api/fortyguard/client.py`).
9. TCM property is often `average_temperature`, not `temperature`. Exceedance hours are `value`, not °C.
10. 0 tiles + completed `activity_id` = coverage miss, not 0 °C.
11. Do not wait on streetview / heat-intelligence for the enrich HTTP response to return satellite buckets.

Older note (partially superseded): legend vs blank MapLibre **fill** was fixed by abandoning fill layers for heat and using the canvas raster. If heat is blank again, check the image source, not a GeoJSON fill under buildings.

---

## How to run

```powershell
cd D:\fortyguard\heatlens
.\.venv\Scripts\activate
cd api
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

```powershell
cd D:\fortyguard\heatlens\web
npm run dev
```

`api/.env`: `FORTYGUARD_API_KEY`, optional DeepSeek:

```
LLM_API_KEY=...
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-v4-flash
```

Tests: `python -m unittest discover -s tests -v` from `api/` with the venv.

---

## Judging rubric

[Hackathon’26](https://www.fortyguard.com/hackathon26): Impact 40 · Tech 35 · Innovation 15 · Communication 10.

Live demo, no login. Cache the demo AOIs. Video ~3 min. Summary ~500 words. FortyGuard **central** (activity_ids). Overlay honestly labeled.

---

## Links

- API docs: https://docs-api.fortyguard.com
- Heatmap: https://docs-api.fortyguard.com/docs/create-heatmap
- Limits / billing: https://docs-api.fortyguard.com/docs/limitations
- Hackathon: https://www.fortyguard.com/hackathon26
- Slack: **fortyguardhackthon26** (invite spelling)
- GitHub: https://github.com/Galabavamsi/heatcast

---

## Research files

| File | Role |
|---|---|
| `RESEARCH-3D-URBAN.md` | Current product lock |
| `RESEARCH-SIMULATOR.md` | API + scenario formula |
| `RESEARCH-PIVOT.md` | Superseded HeatHall hero; keep FG date/cache rules |

If handover and research disagree, **fix research or add a Decision row** — do not leave two truths.
