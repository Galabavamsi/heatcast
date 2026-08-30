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
| **Last snapshot** | 31 Aug 2026 |

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

**As of 31 Aug 2026** (seven `/tools` routes on `main`; live web Vercel, API Railway)

HeatCast is a small US-only site: landing `/`, map `/app`, inferred tools `/tools`, method `/method`. The map scores a **drawn US AOI** on 2 m air tiles (TCM) plus **exceedance** (total hours) and **persistence** (longest consecutive streak), then an **unrelieved-heat ratio** (streak ÷ hours, HeatCast index 0–1), then overlays SVI / shade / indoor cool space / OSRM walk / a tree sketch, and a planner brief. **Tools** is a separate workspace (not scorecard tabs) with seven working inferences: Site hours, Peak hours, Compound hours, Shift window, Cooling plan, Walk exposure, District score. Open-Meteo / OSM fill pages before Score; FortyGuard fields populate after Score. No coming-soon cards. Client-side **Export** writes JSON / GeoJSON / brief `.txt` after Score (satellite omitted if still null). Share URLs restore bbox+date+end+time (`/app` and `/tools` share `west=&south=&east=&north=&date=&time=`); they do **not** auto-score tiles. FortyGuard is one measurement API, not the product name in every chip.

| Area | State |
|---|---|
| Site | Working. `/` product page (duration / indoor walk / planting beats + Score / Tools CTAs). `/app` is the map. `/tools` is the inferred-tools hub (`/tools/hours`, `/peak`, `/compound`, `/shift`, `/cooling`, `/walk`, `/district`). `/method` is honest layer notes (hours vs streak, unrelieved ratio, Range ΔT, OSRM walk, tools). Nav: Home · Score · Tools · Method. |
| Tools workspace | Working. Separate route (not scorecard tabs). All seven hub cards open a live tool. Site hours (Open-Meteo air/apparent/RH + cooling-demand proxy). Peak / compound as before. Shift window (coolest 4 h daylight from heat + GHI — not gCO2). Cooling plan sliders on Open-Meteo air, FG mean after Score. Walk lists OSM indoor sites + OSRM from box center; TCM samples after Score. District score 0–100 HeatCast index (mean T, exceedance, unrelieved; optional SVI). Share bbox/date/time with `/app`. Does not auto-score tiles. |
| Score / heatmap | Working. Canvas raster image source. Demo **From=To=`2024-07-15` 15:00**. |
| Date range | Working. Header **Day \| Range**. Day = one date. Range = From + To + Hour, cap **7 inclusive days**. Same day → duration `filter_type=3` (no `end_date`, existing caches). 2–7 days → `end_date` + `filter_type=4` (range-of-days product). TCM / shade / comfort still use **From + Hour**. Not a custom 3-day exceedance. |
| Range ΔT | Working when From ≠ To. Second TCM at **To + the scored Hour**. Map: **ΔT (range)** (To − From) and noisy **ΔT edges** (\|∇ΔT\|). **Play** cycles Hour only; it does not Score and does not recompute ΔT. |
| Draw / pan / orbit | Working. Custom orbit `easeTo({ around })`. Native `dragRotate` stays off. Query-param restore sets view **once**; AOI drag does not `flyTo`. |
| Layout | `/app` large screens: left Tools/View/Layers/Area (`w-[10.25rem]`); **one right drawer** (~21rem) overlays the map. After Score the drawer tabs are `Duration \| Place \| Brief`, or `Range \| Day \| Place \| Brief` when From ≠ To (default Duration/Day). Header is always `inset-x-4` (does not shrink when the drawer opens). When the drawer is hidden, a labeled **Scorecard** button sits in the **header next to Export** (not a floating `top-24 right-4` chevron). Last tab is component state. Narrow: same tabs in a bottom sheet; collapsed control is **Scorecard** at `bottom-4 right-4`. Place/Brief after Score. Area mi² lives in the left rail (no floating AOI mi² label on the map). Walk legend is a wrapping 2-line block **inside the Area card**; pan/draw hint sits **below How to** in the same stack (not a `left-20` map overlay). |
| Layers | Isolines (canvas), SVI (SVG), Shade (SVG), Cooling (**icon-only Markers**, text only on the walk destination; sports centres dimmer), **Walk (SVG polyline)**, **planted trees (Markers)**. Amenities within ~40px of the hotspot are nudged south. Toggles enabled whenever `analysis` exists. |
| Duration | Exceedance + persistence fetched **in parallel** with TCM. Map toggle: Air temperature / Hours above / Longest streak. Scorecard: share ≥ threshold **progress bar**, hours-vs-streak bars, hours histogram, **unrelieved-heat ratio** gauge (mean streak ÷ mean hours, 0–1). Split overlay: snapshot °C stays on Day; hours/streak/histogram move to Range when From ≠ To. Not a new heatmap. |
| Walk | Shipped. `GET /v1/walk` → OSRM walking (`overview=full`), US-only, fail-open. SVG polyline with A/B dots (MapLibre lines do not show). Hotspot → nearest OSM **library / community centre / social facility / town hall** (haversine). Sports centres stay on the map but are not walk destinations. Legend lives in the left-rail Area card: `Hotspot → {site}` + `{N} min` (wraps; not a wide map pill). |
| Tree sketch | Click-to-plant + “Hottest tiles” seed. Slider still does literature ΔT. Pins are visual, not a new heatmap. Dismissible plant hint. Escape closes plant mode / search hits. |
| Export | Client-only (`web/src/lib/export.ts`). Header menu next to Score area / Scorecard: scorecard JSON, AOI+hotspot GeoJSON, planner brief `.txt`, optional exceedance/TCM FeatureCollection. Copy brief + share link. No API keys. |
| Area | WGS84 metres-per-degree with **cos(lat)** on longitude (`web/src/lib/aoi.ts` = `api/app/geo.py`). Houston share-URL box ≈ **2.20 mi²**. Cap 45 mi². |
| Copy | User-facing chips say air tiles / SVI / OSM / OSRM. Cite FortyGuard once in coverage if needed. |
| Planner brief | Analyze writes a **template** immediately. Client calls `POST /v1/brief` after enrich + SVI (and cooling/shade if ready). DeepSeek `deepseek-v4-flash` if `LLM_*` is set. Null layers are stripped so the model cannot refuse EPA/i-Tree just because flood is missing. Lives in the right-drawer **Brief** tab (not Duration). |
| Enrich | Satellite + env first (~45 s), streetview/PDF extra (~12 s), pool `shutdown(wait=False)`. Browser abort **80 s**. Streetview timeouts are not a red banner if satellite/env arrived. Hottest-tile satellite stack stays in Brief. |
| OSM | Sequential cooling then buildings. Overpass fail-open + disk cache. |
| LLM | Server-only. Model **`deepseek-v4-flash`** (this key also has `deepseek-v4-pro`; no `deepseek-chat`). |
| Public deploy | **Live.** Web: https://web-pearl-ten-99.vercel.app (Vercel rebuilds from `main`). API: https://heatcast-api-production.up.railway.app. `render.yaml` Blueprint remains on `main` as an alternate. CORS = localhost + `CORS_ORIGINS` + onrender regex. |
| Judging caches | **Not frozen.** EaDo / Museum / Phoenix `2024-07-15` should be cached before demo day. One-day duration cache keys are unchanged. |
| Video + 500-word summary | **Not started.** Deadline **30 Aug 2026**. |

**Do not start:** UTCI, NWS HeatRisk, deck.gl, India, bus-stop clones, a citywide cool-route app, claiming the tree pins are a new satellite/heatmap run. Walk/OSRM to indoor public space is **already shipped** — do not rip it out because older RESEARCH files said “no walking”.

---

## Changelog (append at the top)

| Date | Who | What |
|---|---|---|
| 2026-08-31 | Vamsi / agent | All `/tools` hub cards are live: Site hours, Peak, Compound, Shift window (heat+GHI, not carbon), Cooling plan (Open-Meteo preview), Walk (OSM+OSRM before Score), District score (0–100 HeatCast index). Tests for site/shift + district index. |
| 2026-08-31 | Vamsi / agent | Tools workspace `/tools`: Cooling plan, Walk exposure, Peak hours, Compound hours. Separate route (not scorecard tabs). Literature roof/pavement + Open-Meteo hourly/GHI/US AQI. Tests for cooling-plan, hours-infer, walk-exposure. |
| 2026-08-30 | Vamsi / agent | Render Blueprint (`render.yaml`): heatcast-api + heatcast-web, `0.0.0.0:$PORT`, CORS env + onrender regex. Public URLs pending Dashboard apply (MCP/CLI had no workspace). |
| 2026-08-21 | Vamsi / agent | README + HANDOVER: docs match shipped Day\|Range, ΔT tiles, unrelieved ratio, OSRM walk, duration charts, Scorecard next to Export, Houston URL box ≈ 2.20 mi². Dropped “do not start walking/OSRM”. |
| 2026-08-21 | Vamsi / agent | Range ΔT: second TCM at To + scored Hour; map toggles ΔT (range) / ΔT edges; Play does not recompute ΔT. |
| 2026-08-21 | Vamsi / agent | Scorecard collapse: labeled **Scorecard** button (`top-24 right-4`); header stays `inset-x-4` so toggling the drawer no longer jumps search/dates (`lg:right-[22rem]` removed). |
| 2026-08-21 | Vamsi / agent | Walk legend + pan hint moved into the left rail (Area card / below How to) so they no longer overlay Area at `left-20`. |
| 2026-08-21 | Vamsi / agent | Unclutter `/app`: one right drawer, icon-only cooling pins, no overlapping hotspot/area labels. |
| 2026-08-21 | Vamsi / agent | Date range (From/To + Hour) mapped honestly to FG: same day `filter_type=3`, 2–7 days `end_date` + `filter_type=4` range-of-days product, cap 7 days. Split `/app` into Duration / Place / Brief docks (tabs on narrow). Unrelieved gauge + share progress bar. |
| 2026-08-21 | Vamsi / agent | AOI area uses WGS84 metres-per-degree with cos(lat) on longitude (not Web Mercator). Houston share-URL box ≈ 2.20 mi²; SVG label and API agree. Regression: `api/tests/test_geo_area.py`. |
| 2026-08-21 | Vamsi / agent | Unrelieved-heat ratio (HeatCast index: mean streak ÷ mean hours, 0–1) on the `/app` scorecard + `/method`. NIOSH 2017-127 / OSHA proposed rest-break cite. No new FG call. |
| 2026-08-21 | Vamsi / agent | Product site: landing `/`, map moved to `/app`, `/method`. Client exports (JSON, AOI GeoJSON, brief, tiles). Share URL restores box (no auto-score). Walk legend, plant hint, Escape, copy brief. |
| 2026-08-21 | Vamsi / agent | Sidebar duration charts from data already fetched (share ≥ threshold, hours vs streak, hours histogram + hotspot tick, satellite stacked bar). Not new heatmaps. |
| 2026-08-21 | Vamsi / agent | Walk: prefer library/community centre over OSM sports_centre; OSRM `overview=full`; SVG A→B endpoints. Houston screenshot loop was a real short OSRM detour to Metropolitan Multi-Services Center, not isolines. |
| 2026-08-21 | Vamsi / agent | Persistence layer + OSRM walk-to-indoor (SVG) + click-to-plant tree sketch. Quieter UI copy (FG is one API). US-only. |
| 2026-08-21 | Vamsi / agent | GitHub README: replace SVG diagrams with mermaid (GitHub was showing broken-image alts). PNG screenshots stay. |
| 2026-08-21 | Vamsi / agent | Brief after enrich: `POST /v1/brief`, compact LLM context, enrich two-phase + 80 s client timeout, FEMA 8 s, `HANDOVER.md` + README living docs. |
| 2026-08-21 | Vamsi / agent | DeepSeek brief path (`thinking` disabled, 40 s). OSM fail-open, sequential load, shade SunCalc **degrees**. Search dropdown `skipGeocode`. GitHub `Galabavamsi/heatcast`. Status-poll **403 retry** in `api/fortyguard/client.py`. |
| 2026-08-20 | Vamsi / agent | Initial HeatCast FastAPI + Next/MapLibre: AOI draw, TCM + exceedance, SVI, scenario overlay, 3D orbit. |

---

## Open work (move to Done, don’t delete)

### Must before 30 Aug

- [ ] Freeze **EaDo + Museum District** (optional Phoenix) TCM + exceedance + OSM caches for **2024-07-15 15:00** so judging is not a live credit lottery.
- [ ] Public **Render** demo: Blueprint is on `main`. Still need Dashboard **Apply** + env vars, then paste the two public URLs here.
- [ ] Confirm **Hackathon-FG** still has write on github.com/Galabavamsi/heatcast.
- [ ] **~3 min video** + **~500 word** summary. Pitch: hours vs longest streak **as one unrelieved-heat ratio**, walk to indoor cool space, tree sketch that does **not** pretend to be a new heatmap.

### Nice if time

- [ ] Cause-tagged recs already start in the brief when satellite buckets exist (EPA cool pavement / USDA i-Tree). Tighten copy once Houston satellite numbers are on a frozen cache.
- [ ] Optional second LLM pass is already gated by layer keys; watch DeepSeek spend if cooling/shade retrigger brief too often.

### Done

- [x] 2026-08-31 — All seven `/tools` inferences working (site hours, peak, compound, shift window, cooling, walk, district score). Open-Meteo/OSM preview before Score. No coming-soon stubs. Not insurance / not gCO2.
- [x] 2026-08-31 — Tools hub + 4 grounded inferences on `/tools*` (not scorecard tabs). Cooling plan / walk exposure / peak hours / compound hours. Honest labels; no OSHA/WBGT/vaccine/CO2 claims.
- [x] 2026-08-21 — AOI mi² uses WGS84 cos(lat) on longitude; Houston share-URL box locked at ≈ 2.20 mi² (not 2.59). `api/tests/test_geo_area.py`.
- [x] 2026-08-21 — Date range (honest FG day vs range-of-days) + Duration/Place/Brief docks + extra SVG meters.
- [x] 2026-08-21 — Product pages (`/`, `/app`, `/method`) + client exports + share-URL restore (no auto-score).
- [x] 2026-08-21 — Unrelieved-heat ratio (streak ÷ hours) as a labeled HeatCast index on the scorecard and method page.
- [x] 2026-08-21 — Scorecard duration charts (share, grouped bars, hours histogram) + hotspot satellite stacked bar; no extra FG heatmap calls.
- [x] 2026-08-21 — Walk SVG A→B endpoints; prefer library/community centre over sports_centre; OSRM full geometry.
- [x] 2026-08-21 — Persistence duration layer, OSRM walk SVG, tree-planting sketch, quieter product copy.
- [x] 2026-08-21 — Planner brief no longer runs at analyze with all-null satellite/SVI.
- [x] 2026-08-21 — Enrich does not block the HTTP response on timed-out FortyGuard workers (`shutdown(wait=False)`).
- [x] 2026-08-20/21 — Draw AOI, canvas heat, SVI SVG, OSM shade/cooling, custom orbit, US-only geocode.

---

## Decision log (append only)

| Date | Decision | Why |
|---|---|---|
| 2026-08-31 | Remaining hub cards are real tools: Site hours, Shift window (not carbon), District score (not insurance) | No free US grid-carbon API. Open-Meteo heat+GHI is labeled a shift window. Index uses existing scorecard math + optional SVI. |
| 2026-08-31 | Inferred tools live on `/tools`, not inside `/app` Range\|Day\|Place\|Brief | Scorecard stays the district score. Webinar-style suite is a separate workspace. HeatCast names only; FortyGuard is one API. |
| 2026-08-21 | Range ΔT = To − From TCM at the same clock hour; |∇ΔT| is “edges of change,” not a flux | Day-to-day ΔT at one hour shows which fabric stored heat. CAPA Heat Watch maps morning/afternoon/evening separately. Do not animate N deltas on Play. |
| 2026-08-21 | From/To date picker; duration is one day or up to 7 days via `filter_type` 3 vs 4 | FG `create_heatmap` documents 4 as range of days with `end_date`, not a calendar-week lock and not a custom N-day product. TCM/shade/comfort stay on From+Hour. Cap 7 days. Demo stays `2024-07-15`. |
| 2026-08-21 | `/app` two right docks (Duration + Place) with Brief as a Duration tab | One 22rem scroller of 12 cards was unusable. Place hidden until scored. Narrow screens use Duration/Place/Brief tabs. |
| 2026-08-21 | Share URL restores bbox+date+end+time; Score stays a click | Avoid surprise FortyGuard credits on paste/refresh. |
| 2026-08 | Track **1** HeatCast, not HeatHall / Track 3 | RESEARCH-3D-URBAN.md overrides RESEARCH-PIVOT.md on product. Keep pivot’s FG calling rules. |
| 2026-08-21 | Unrelieved-heat ratio = mean streak ÷ mean exceedance hours (clip 0–1) | Unique vs CAPA/Tree Equity snapshot choropleths. Uses duration layers already fetched. Labeled HeatCast index; cite NIOSH work/rest + OSHA proposed 15-min/2 h rest. Not a WBGT prescription. |
| 2026-08-21 | Walk targets indoor OSM amenities only; sports_centre is mapped not routed | OSM `leisure=sports_centre` can be outdoor courts. US cooling-center literature uses libraries / community / senior centers. Screenshot Houston walk was 34 m euclidean to a community centre with an 848 m OSRM sidewalk detour that looked like a loop. |
| 2026-08-21 | Persistence + walk-to-cool + tree sketch; quieter FG copy | US cities actually run heat as **duration + access + planting**. User asked for a second product-like layer. Walk is SVG, not MapLibre line. Tree pins are fake/visual. |
| 2026-08 | No walking routes / OSRM | **Superseded 2026-08-21.** Official Track 1 examples already include Cool Route Planner; we now ship a thin hotspot→indoor walk, not a citywide cool-route app. |
| 2026-08 | US only, demo **2024-07-15 15:00** | FG heatmap coverage; Phoenix 2026-08-17 empty-success billing trap. |
| 2026-08 | Canopy slider = **air** CE ~0.015 °C / 1%, cap 2 °C, not LST | FortyGuard is 2 m air. Du et al. 2024. |
| 2026-08 | Analyze must not wait on enrich, OSM, or LLM | Heatmap is the product; extras fail-open. |
| 2026-08-21 | LLM brief **after** satellite + SVI | First brief with nulls refused EPA/i-Tree recs. |
| 2026-08-21 | DeepSeek **flash**, not `deepseek-chat` | This key only lists `deepseek-v4-flash` and `deepseek-v4-pro`. |

---

## What this is / is not

**Is:** Track 1 urban-planner simulator. Score a US district on **2 m air** tiles, hours above threshold, longest hot streak, **unrelieved-heat ratio** (streak ÷ hours), walk to nearby indoor space, and a labeled tree-planting sketch. **`/tools`** adds seven grounded inferences (site hours, peak, compound, shift window, cooling plan, walk exposure, district score) in a separate workspace. FortyGuard is the air/duration API among several. 2D is the scorecard. 3D is pitched OSM massing + heat. UI name HeatCast; folder `heatlens`.

**Is not:**

| Tempting | Why not |
|---|---|
| Walking / cool routes / A→B | **Now a thin product:** hotspot → nearest OSM indoor via OSRM. Not a citywide cool-commute map. |
| India / non-US AOIs | Heatmap coverage is US-only |
| “Simulated adding trees as a new heatmap” | No what-if heatmap. Pins + slider are a sketch / literature overlay |
| HeatHall / data-center flood screener | Superseded pivot |
| Photoreal shade / facade CFD | OSM boxes + SunCalc ≠ FG-measured shade |
| Official cooling-center map | OSM amenities only |
| Grid carbon / gCO2/kWh | No free US carbon API from this stack. Shift window is Open-Meteo heat + GHI. |
| Insurance / FICO of heat | District score is a labeled HeatCast 0–100 index from existing scorecard math. |

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
api/app/unrelieved.py    Unrelieved-heat ratio (streak ÷ hours)
api/app/hours_infer.py   Peak / compound / site hours / shift window
api/app/district_index.py 0–100 HeatCast district index
api/app/delta.py         Range same-hour TCM ΔT + crude |∇ΔT| edges
api/app/buildings.py     OSM footprints
api/app/cooling.py       OSM cooling-ish sites
api/app/overpass.py      mirrors, caps
api/app/cache.py         disk cache (gitignored)
api/app/fg.py            heatmap wrap, class percents
api/fortyguard/client.py vendored SDK + 403 status retry
web/src/app/page.tsx     Landing
web/src/app/app/page.tsx Map route → ScoreApp
web/src/app/method/page.tsx Honest method page
web/src/components/ScoreApp.tsx  Score, brief, layers, duration charts, export
web/src/components/UnrelievedChip.tsx  Scorecard chip
web/src/components/HeatMap.tsx   map (fragile)
web/src/lib/export.ts    Client Blob downloads
web/src/lib/share.ts     `/app?west=&south=&east=&north=&date=&end=&time=`
web/src/lib/unrelieved.ts Client formula + method blurb
web/src/lib/histogram.ts hours bins + hotspot-tile join
web/src/lib/landcover.ts satellite stacked-bar slices
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
| POST | `/v1/analyze` | TCM + exceedance + **persistence** + **template** memo (`use_llm=False`) |
| GET | `/v1/walk` | OSRM walking, US-only, fail-open |
| POST | `/v1/brief` | LLM after layers land |
| POST | `/v1/enrich` | Core satellite+env 45 s; extras 12 s; do not `wait=True` on the pool |
| POST | `/v1/svi` | |
| GET | `/v1/buildings` `/v1/cooling` `/v1/osm` | Empty FC + `meta.error` on failure |
| GET | `/v1/weather` | Open-Meteo + FEMA + elevation |
| GET | `/v1/tools/hours` | Peak + compound + site hours + shift + district preview |
| POST | `/v1/tools/cooling` | Literature cooling-plan math |
| POST | `/v1/tools/walk-exposure` | Sample TCM along OSRM |
| POST | `/v1/tools/district-index` | 0–100 HeatCast index |
| POST | `/v1/scenario` | Overlay math only |
| GET | `/v1/credits` | |
| GET | `/v1/outputs/{file}` | PDF |

FortyGuard: `tcm` snapshot °C (`average_temperature` often, mapped to `temperature`); `exceedance` hours in `properties.value`; `persistence` longest consecutive hours in the same `value` field; `environmental_parameters` ~1 km; `satellite_segmentation` class mix at **hotspot centroid** (not a district NLCD raster); streetview often times out; heat_intelligence PDF.

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
4. MapLibre fill/line layers do **not** reliably show. SVI and shade = **SVG**. Isolines **burned into** the heat canvas. Cooling = **Marker**. Walk = **SVG polyline**. Trees = **Marker**.
5. Native `dragRotate` slides heat off-screen. Orbit with `easeTo({ around })`. `jumpTo` **ignores** `around`.
6. OSM layer switches stay **enabled** when `analysis` exists even if Overpass is empty; show ellipsis while loading. Overpass **502 → empty FC**, not a failed Score.
7. Do not put `FORTYGUARD_API_KEY` or `LLM_API_KEY` in the frontend.
8. First `/v1/status` **403** after create_heatmap can mean “not ready” — retry like the official quickstart (`api/fortyguard/client.py`).
9. TCM property is often `average_temperature`, not `temperature`. Exceedance **and** persistence hours are `value`, not °C. Exceedance = total hours; persistence = longest consecutive streak.
10. 0 tiles + completed `activity_id` = coverage miss, not 0 °C.
11. Do not wait on streetview / heat-intelligence for the enrich HTTP response to return satellite buckets.
12. AOI mi² = WGS84 mid-lat rectangle with **cos(lat)** on longitude (`web/src/lib/aoi.ts` `areaMi2` = `api/app/geo.py` `polygon_area_mi2`). Not EPSG:3857. Houston `west=-95.40236&south=29.73387&east=-95.37434&north=29.75282` is **≈ 2.20 mi²**, not 2.59.
13. `/app` header is always `inset-x-4`. Do **not** add `lg:right-[22rem]` when the scorecard is open — that shrinks search/dates. Drawer overlays the map. Collapsed **Scorecard** lives in the **header next to Export** (large screens), not a floating `top-24 right-4` chevron. Narrow collapsed control stays `bottom-4 right-4`.

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

Open http://localhost:3000 (landing) then **Score a neighborhood** → http://localhost:3000/app. Method is `/method`.

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
